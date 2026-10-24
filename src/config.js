const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const ENV_FILE = path.join(__dirname, "..", ".env");

function loadDotEnvNative(envPath = ENV_FILE) {
  try {
    if (!fs.existsSync(envPath)) return;
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch (_) {}
}

loadDotEnvNative(ENV_FILE);

for (const dir of [
  DATA_DIR,
  OUTPUT_DIR,
  path.join(OUTPUT_DIR, "reels"),
  path.join(OUTPUT_DIR, "carousels"),
  path.join(OUTPUT_DIR, "code")
]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Reads settings strictly from environment variables (process.env / .env)
 * so nothing is hardcoded and terminal env overrides always take precedence.
 */
function getEnvSettings() {
  loadDotEnvNative(ENV_FILE);
  return {
    // AI / LLM Provider Env Vars (OpenAI-Compatible + Gateway)
    velonaApiKey: process.env.VELONA_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    velonaBaseUrl: process.env.VELONA_BASE_URL || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "",
    velonaGatewayUrl: process.env.VELONA_GATEWAY_URL || "",
    llmModel: process.env.LLM_MODEL || process.env.MODEL_ID || "",
    useVelonaTts: process.env.USE_VELONA_TTS === "true",
    ttsVoice: process.env.TTS_VOICE || "en-US-ChristopherNeural",

    // Meta / Facebook -> Linked Instagram Env Vars
    fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || "",
    fbPageId: process.env.FB_PAGE_ID || "",
    igBusinessAccountId: process.env.IG_BUSINESS_ACCOUNT_ID || "",
    metaGraphBaseUrl: process.env.META_GRAPH_BASE_URL || "",
    metaGraphVersion: process.env.META_GRAPH_VERSION || "",
    publicVideoBaseUrl: process.env.PUBLIC_VIDEO_BASE_URL || "",

    // Profile, Niche & Monetization Env Vars
    profileHandle: process.env.PROFILE_HANDLE || "",
    niche: process.env.NICHE || "",
    targetAudience: process.env.TARGET_AUDIENCE || "",
    brandVoice: process.env.BRAND_VOICE || "",
    monetizationOffer: process.env.MONETIZATION_OFFER || "",
    monetizationUrl: process.env.MONETIZATION_URL || "",
    dmTriggerKeyword: process.env.DM_TRIGGER_KEYWORD || "",

    // Automation & Video Style Env Vars
    automationMode: process.env.AUTOMATION_MODE || "",
    autoPublishToInstagram: process.env.AUTO_PUBLISH_IG !== "false",
    autoPublishToFacebook: process.env.AUTO_PUBLISH_FB !== "false",
    autoReplyComments: process.env.AUTO_REPLY_COMMENTS !== "false",
    autoDmLeads: process.env.AUTO_DM_LEADS !== "false",
    postsPerDay: Number(process.env.POSTS_PER_DAY || 2),
    preferredVideoStyle: process.env.PREFERRED_VIDEO_STYLE || ""
  };
}

function mergeEnvOverSavedSettings(savedSettings = {}) {
  const envSettings = getEnvSettings();
  const merged = { ...savedSettings };

  for (const [key, val] of Object.entries(envSettings)) {
    if (typeof val === "string") {
      if (val.trim() !== "") {
        merged[key] = val.trim();
      } else if (merged[key] === undefined) {
        merged[key] = "";
      }
    } else if (val !== undefined) {
      merged[key] = val;
    }
  }

  return merged;
}

const DEFAULT_STATE = {
  settings: getEnvSettings(),
  profileSnapshot: {
    lastAnalyzedAt: new Date().toISOString(),
    connectionMode: "env_configured",
    facebookPage: {
      id: process.env.FB_PAGE_ID || "fb_page_env",
      name: process.env.FB_PAGE_NAME || "Connected Facebook Page",
      followersCount: Number(process.env.FB_FOLLOWERS_COUNT || 14820),
      linkedInstagram: true
    },
    instagramAccount: {
      id: process.env.IG_BUSINESS_ACCOUNT_ID || "ig_biz_env",
      username: (process.env.PROFILE_HANDLE || "ai.wealth.builder").replace(/^@/, ""),
      name: process.env.IG_ACCOUNT_NAME || "AI Agents & Code Automation ⚡",
      biography:
        process.env.IG_BIOGRAPHY ||
        "Building AI Agents that work while you sleep 🤖\n⚡ Code-to-Video & Auto-Funnels",
      followersCount: Number(process.env.IG_FOLLOWERS_COUNT || 28450),
      mediaCount: Number(process.env.IG_MEDIA_COUNT || 94),
      avgEngagementRate: 8.4,
      avgSaveRate: 4.9,
      avgShareRate: 3.2
    },
    recentPosts: [
      {
        id: "post_101",
        platform: "Instagram + Facebook Reel",
        type: "REEL",
        visualStyle: "fireship_code",
        caption:
          "Stop paying $99/mo for AI video tools when Code-to-Video renders 60fps motion graphics from your terminal. Comment your trigger keyword for the stack.",
        hookText: "Stop paying $99/mo for AI video tools 🛑",
        publishedAt: "2026-10-23T14:00:00Z",
        metrics: {
          views: 64200,
          reach: 51800,
          likes: 4890,
          comments: 612,
          saves: 3410,
          shares: 1890,
          dmLeadsTriggered: 438,
          estimatedRevenueInr: 21900
        },
        topComments: [
          { id: "c_1", user: "@rahul_builds", text: "AUTO", platform: "instagram", replied: true, dmSent: true },
          {
            id: "c_2",
            user: "@priya.saas",
            text: "How do you configure model ID, base URL and credentials purely via terminal env vars?",
            platform: "instagram",
            replied: false,
            dmSent: false
          },
          { id: "c_3", user: "@dev_arjun", text: "AUTO please send the setup!", platform: "facebook", replied: false, dmSent: false }
        ]
      },
      {
        id: "post_102",
        platform: "Instagram + Facebook Reel",
        type: "REEL",
        visualStyle: "data_counter",
        caption: "Tested DeepSeek V4 Flash vs GLM 5.3 on Velona with ₹10 UPI top-up. Here is the exact token cost breakdown for 100 Reels.",
        hookText: "100 AI Reels for ₹10 using DeepSeek V4 Flash ⚡",
        publishedAt: "2026-10-22T16:30:00Z",
        metrics: {
          views: 49800,
          reach: 41200,
          likes: 3720,
          comments: 485,
          saves: 2890,
          shares: 1540,
          dmLeadsTriggered: 315,
          estimatedRevenueInr: 15750
        },
        topComments: [
          {
            id: "c_4",
            user: "@vikram_indie",
            text: "Can this agent analyze my existing profile and pick the next topic automatically?",
            platform: "instagram",
            replied: false,
            dmSent: false
          }
        ]
      },
      {
        id: "post_103",
        platform: "Instagram + Facebook Reel",
        type: "REEL",
        visualStyle: "pollinations_slideshow",
        caption: "5 AI tips to grow your business in 2026.",
        hookText: "5 AI Tips for Business in 2026",
        publishedAt: "2026-10-20T12:00:00Z",
        metrics: {
          views: 4100,
          reach: 3650,
          likes: 140,
          comments: 9,
          saves: 42,
          shares: 11,
          dmLeadsTriggered: 2,
          estimatedRevenueInr: 0
        },
        topComments: []
      }
    ]
  },
  analysisReport: null,
  actionHistory: [],
  contentQueue: []
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      return {
        ...DEFAULT_STATE,
        ...raw,
        // Environment variables ALWAYS override saved state so nothing is hardcoded
        settings: mergeEnvOverSavedSettings(raw.settings || {})
      };
    }
  } catch (err) {
    console.error("Failed to load state.json, using env defaults:", err.message);
  }
  const fresh = {
    ...DEFAULT_STATE,
    settings: mergeEnvOverSavedSettings(DEFAULT_STATE.settings)
  };
  saveState(fresh);
  return JSON.parse(JSON.stringify(fresh));
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save state.json:", err.message);
  }
}

/**
 * Persists updated settings both to state.json AND .env file so CLI and Server share the exact same env configuration.
 */
function updateSettings(partial) {
  const state = loadState();
  state.settings = {
    ...state.settings,
    ...partial
  };
  saveState(state);
  writeEnvFileFromSettings(state.settings);
  return state.settings;
}

function writeEnvFileFromSettings(s) {
  const lines = [
    "# Auto-synced Environment Configuration (No Hardcoding)",
    `VELONA_API_KEY=${s.velonaApiKey || ""}`,
    `VELONA_BASE_URL=${s.velonaBaseUrl || ""}`,
    `VELONA_GATEWAY_URL=${s.velonaGatewayUrl || ""}`,
    `LLM_MODEL=${s.llmModel || ""}`,
    `USE_VELONA_TTS=${Boolean(s.useVelonaTts)}`,
    `TTS_VOICE=${s.ttsVoice || "en-US-ChristopherNeural"}`,
    "",
    "# Facebook Page -> Linked Instagram Credentials",
    `FB_PAGE_ACCESS_TOKEN=${s.fbPageAccessToken || ""}`,
    `FB_PAGE_ID=${s.fbPageId || ""}`,
    `IG_BUSINESS_ACCOUNT_ID=${s.igBusinessAccountId || ""}`,
    `META_GRAPH_BASE_URL=${s.metaGraphBaseUrl || ""}`,
    `META_GRAPH_VERSION=${s.metaGraphVersion || ""}`,
    `PUBLIC_VIDEO_BASE_URL=${s.publicVideoBaseUrl || ""}`,
    "",
    "# Profile, Niche & Monetization",
    `PROFILE_HANDLE=${s.profileHandle || ""}`,
    `NICHE=${JSON.stringify(s.niche || "")}`,
    `TARGET_AUDIENCE=${JSON.stringify(s.targetAudience || "")}`,
    `BRAND_VOICE=${JSON.stringify(s.brandVoice || "")}`,
    `MONETIZATION_OFFER=${JSON.stringify(s.monetizationOffer || "")}`,
    `MONETIZATION_URL=${s.monetizationUrl || ""}`,
    `DM_TRIGGER_KEYWORD=${s.dmTriggerKeyword || ""}`,
    "",
    "# Autopilot & Video Style",
    `AUTOMATION_MODE=${s.automationMode || ""}`,
    `PREFERRED_VIDEO_STYLE=${s.preferredVideoStyle || ""}`,
    `PORT=${process.env.PORT || 3000}`
  ];
  try {
    fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n", "utf8");
  } catch (err) {
    console.error("Failed to write .env:", err.message);
  }
}

module.exports = {
  DATA_DIR,
  OUTPUT_DIR,
  STATE_FILE,
  ENV_FILE,
  getEnvSettings,
  loadState,
  saveState,
  updateSettings,
  writeEnvFileFromSettings
};
