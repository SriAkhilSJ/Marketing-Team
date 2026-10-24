const express = require("express");
const cors = require("cors");
const path = require("path");
const { loadState, saveState, updateSettings, OUTPUT_DIR } = require("./src/config");
const { POPULAR_VELONA_MODELS, checkVelonaCredits } = require("./src/velonaClient");
const { discoverFacebookAndLinkedInstagram, publishReelCrossPlatform } = require("./src/metaGraphClient");
const { analyzeProfileAndPlanActions } = require("./src/profileAnalyzer");
const { VIDEO_STYLES, generateCodeToVideoReel } = require("./src/codeVideoEngine");
const { EDGE_TTS_VOICES, isEdgeTtsAvailable } = require("./src/ttsEngine");
const { buildUiConfigSchema } = require("./src/uiSchema");
const { runFullAutopilotCycle, processPendingCommentActions } = require("./src/autopilotDaemon");
const {
  loadMemoryStore,
  retrieveContextFromRag,
  addKnowledgeDocument,
  deleteKnowledgeDocument
} = require("./src/memoryRagEngine");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/output", express.static(OUTPUT_DIR));
app.use(express.static(path.join(__dirname, "public")));

// GET full dashboard state
app.get("/api/state", async (req, res) => {
  try {
    const state = loadState();
    if (!state.analysisReport) {
      await analyzeProfileAndPlanActions(state);
      saveState(state);
    }

    const velonaStatus = await checkVelonaCredits(state.settings);
    const metaStatus = await discoverFacebookAndLinkedInstagram(state.settings);
    const memoryStore = loadMemoryStore();

    // Mask sensitive tokens for display while indicating if they are set
    const safeSettings = {
      ...state.settings,
      hasVelonaKey: Boolean((state.settings.velonaApiKey || "").trim()),
      velonaKeyPreview: state.settings.velonaApiKey
        ? `${state.settings.velonaApiKey.slice(0, 7)}...${state.settings.velonaApiKey.slice(-4)}`
        : "",
      hasFbToken: Boolean((state.settings.fbPageAccessToken || "").trim()),
      fbTokenPreview: state.settings.fbPageAccessToken
        ? `${state.settings.fbPageAccessToken.slice(0, 8)}...`
        : ""
    };

    res.json({
      ok: true,
      uiConfig: buildUiConfigSchema(state.settings),
      settings: safeSettings,
      velonaStatus,
      metaStatus,
      popularModels: POPULAR_VELONA_MODELS,
      videoStyles: Object.values(VIDEO_STYLES),
      profileSnapshot: state.profileSnapshot,
      analysisReport: state.analysisReport,
      contentQueue: state.contentQueue || [],
      actionHistory: state.actionHistory || [],
      memoryStore
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET dynamic UI configuration & schema (eliminates static HTML hardcoding)
app.get("/api/config", (req, res) => {
  try {
    const state = loadState();
    res.json({
      ok: true,
      ...buildUiConfigSchema(state.settings)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET available TTS voices
app.get("/api/voices", (req, res) => {
  const state = loadState();
  res.json({
    ok: true,
    ttsAvailable: isEdgeTtsAvailable(),
    voices: EDGE_TTS_VOICES,
    currentVoice: process.env.TTS_VOICE || state.settings.ttsVoice || "en-US-ChristopherNeural"
  });
});

app.post("/api/settings", async (req, res) => {

  try {
    const incoming = req.body || {};
    const state = loadState();
    const updated = { ...state.settings };

    const allowedFields = [
      "velonaApiKey",
      "velonaBaseUrl",
      "velonaGatewayUrl",
      "llmModel",
      "fbPageAccessToken",
      "fbPageId",
      "igBusinessAccountId",
      "publicVideoBaseUrl",
      "profileHandle",
      "niche",
      "targetAudience",
      "brandVoice",
      "monetizationOffer",
      "monetizationUrl",
      "dmTriggerKeyword",
      "automationMode",
      "autoPublishToInstagram",
      "autoPublishToFacebook",
      "autoReplyComments",
      "autoDmLeads",
      "preferredVideoStyle",
      "ttsVoice"
    ];

    for (const key of allowedFields) {
      if (incoming[key] !== undefined) {
        // Don't overwrite existing secrets if user left secret input blank
        if ((key === "velonaApiKey" || key === "fbPageAccessToken") && incoming[key] === "__KEEP__") {
          continue;
        }
        updated[key] = incoming[key];
      }
    }

    if (updated.ttsVoice) {
      process.env.TTS_VOICE = updated.ttsVoice;
    }

    // If FB Page token was updated, auto-discover FB Page ID & Linked Instagram Business Account ID
    const discovery = await discoverFacebookAndLinkedInstagram(updated);
    if (discovery.connected) {
      if (discovery.fbPage?.id) updated.fbPageId = discovery.fbPage.id;
      if (discovery.igAccount?.id) updated.igBusinessAccountId = discovery.igAccount.id;
      if (discovery.resolvedPageAccessToken) updated.fbPageAccessToken = discovery.resolvedPageAccessToken;
    }

    updateSettings(updated);
    const velonaStatus = await checkVelonaCredits(updated);

    res.json({
      ok: true,
      message: "Configuration saved!",
      velonaStatus,
      metaStatus: discovery
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST analyze profile content & generate action plan
app.post("/api/analyze", async (req, res) => {
  try {
    const state = loadState();
    const report = await analyzeProfileAndPlanActions(state);
    saveState(state);
    res.json({
      ok: true,
      analysisReport: report,
      profileSnapshot: state.profileSnapshot
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST generate a Code-to-Video Reel + Carousel
app.post("/api/generate-reel", async (req, res) => {
  try {
    const { customTopic = "", preferredStyle = "", ttsVoice = "" } = req.body || {};
    const state = loadState();
    if (!state.analysisReport) {
      await analyzeProfileAndPlanActions(state);
    }
    // Override TTS_VOICE for this request if the caller sent one
    if (ttsVoice) process.env.TTS_VOICE = ttsVoice;

    const reelItem = await generateCodeToVideoReel({
      settings: state.settings,
      analysisReport: state.analysisReport,
      customTopic,
      preferredStyle
    });

    state.contentQueue = [reelItem, ...(state.contentQueue || [])].slice(0, 15);
    state.actionHistory = [
      {
        id: `gen_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "GENERATE_CODE_TO_VIDEO_REEL",
        reelId: reelItem.id,
        reelTitle: reelItem.title,
        steps: [
          {
            step: "Claude Code-to-Video Renderer",
            status: "COMPLETED",
            detail: `Rendered 9:16 MP4 (${reelItem.videoUrl}) + Remotion .tsx code + 4 Carousel PNGs.`
          }
        ]
      },
      ...(state.actionHistory || [])
    ].slice(0, 30);

    saveState(state);
    res.json({
      ok: true,
      reelItem,
      contentQueue: state.contentQueue
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST run full autonomous cycle (Analyze -> Reply/DM -> Render Code Reel -> Auto-Publish)
app.post("/api/run-autopilot", async (req, res) => {
  try {
    const { customTopic = "", preferredStyle = "", forcePublish = true, ttsVoice = "" } = req.body || {};
    if (ttsVoice) process.env.TTS_VOICE = ttsVoice;
    const result = await runFullAutopilotCycle({
      customTopic,
      preferredStyle,
      forcePublish
    });
    res.json({
      ok: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST publish a queued Reel to Linked Instagram + Facebook Page
app.post("/api/publish/:reelId", async (req, res) => {
  try {
    const { reelId } = req.params;
    const state = loadState();
    const item = (state.contentQueue || []).find((r) => r.id === reelId);
    if (!item) {
      return res.status(404).json({ ok: false, error: "Reel not found in queue" });
    }

    const pubResult = await publishReelCrossPlatform({
      settings: state.settings,
      reelItem: item,
      localMp4Path: item.localMp4Path
    });

    item.status = "PUBLISHED";
    item.publishedAt = new Date().toISOString();
    item.publishResult = pubResult;

    state.actionHistory = [
      {
        id: `pub_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "CROSS_PLATFORM_PUBLISH",
        reelId: item.id,
        reelTitle: item.title,
        steps: [
          {
            step: "Published via Single Facebook Token -> IG + FB",
            status: "PUBLISHED",
            detail: `Instagram: ${pubResult.instagram.message} | Facebook: ${pubResult.facebook.message}`
          }
        ]
      },
      ...(state.actionHistory || [])
    ].slice(0, 30);

    saveState(state);
    res.json({
      ok: true,
      reelItem: item,
      publishResult: pubResult
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST process pending comments & Auto-DM leads (or simulate a new incoming comment first)
app.post("/api/process-comments", async (req, res) => {
  try {
    const { simulateComment } = req.body || {};
    const state = loadState();

    if (simulateComment && simulateComment.text) {
      const firstPost = state.profileSnapshot?.recentPosts?.[0];
      if (firstPost) {
        firstPost.topComments = [
          {
            id: `c_sim_${Date.now()}`,
            user: simulateComment.user || "@new_creator_in",
            text: simulateComment.text,
            platform: simulateComment.platform || "instagram",
            replied: false,
            dmSent: false
          },
          ...(firstPost.topComments || [])
        ];
        firstPost.metrics.comments = (firstPost.metrics.comments || 0) + 1;
      }
    }

    const dmResult = await processPendingCommentActions(state);
    await analyzeProfileAndPlanActions(state);
    saveState(state);

    res.json({
      ok: true,
      dmResult,
      profileSnapshot: state.profileSnapshot,
      analysisReport: state.analysisReport
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET Memory & RAG Knowledge Vault
app.get("/api/memory", (req, res) => {
  try {
    const store = loadMemoryStore();
    res.json({ ok: true, memoryStore: store });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST add a new RAG Knowledge Base document
app.post("/api/memory/knowledge", (req, res) => {
  try {
    const { title, category, content } = req.body || {};
    if (!content || !String(content).trim()) {
      return res.status(400).json({ ok: false, error: "Knowledge content is required" });
    }
    const doc = addKnowledgeDocument({ title, category, content });
    const memoryStore = loadMemoryStore();
    res.json({ ok: true, doc, memoryStore });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE a RAG Knowledge Base document
app.delete("/api/memory/knowledge/:id", (req, res) => {
  try {
    deleteKnowledgeDocument(req.params.id);
    const memoryStore = loadMemoryStore();
    res.json({ ok: true, memoryStore });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST run a live RAG Semantic Retrieval + Anti-Duplicate Memory Check
app.post("/api/memory/query", (req, res) => {
  try {
    const { query = "" } = req.body || {};
    const ragResult = retrieveContextFromRag(query, 4);
    const memoryStore = loadMemoryStore();
    res.json({ ok: true, ragResult, memoryStore });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function bootstrapInitialContent() {
  const state = loadState();
  if (!state.analysisReport) {
    await analyzeProfileAndPlanActions(state);
    saveState(state);
  }
  if (!state.contentQueue || state.contentQueue.length === 0) {
    console.log("Bootstrapping initial Code-to-Video Reel (.mp4) + 4 Carousel Slides...");
    await runFullAutopilotCycle({ forcePublish: false });
    console.log("Initial Code-to-Video Reel ready!");
  }
}

bootstrapInitialContent()
  .catch((err) => console.error("Bootstrap warning:", err.message))
  .finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Autonomous AI Reels & Posts Studio running on http://0.0.0.0:${PORT}`);
    });
  });
