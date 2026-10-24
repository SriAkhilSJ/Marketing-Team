#!/usr/bin/env node
/**
 * Terminal CLI for Marketing-Team Autonomous AI Reels & Posts Agent (100% Env-Driven)
 *
 * Commands:
 *   node cli.js set-env --base-url <url> --model <id> --api-key <key> --fb-token <token> ...
 *   node cli.js env                     # Show active environment configuration (no hardcoding)
 *   node cli.js render [topic]          # Generate a 9:16 Code-to-Video MP4 Reel + 4 Carousel slides
 *   node cli.js analyze                 # Run Profile Content Audit & print Action Plan
 *   node cli.js autopilot [topic]       # Full loop: Analyze -> Reply/DM Leads -> Render MP4 -> Publish IG + FB
 */

const { loadState, saveState, updateSettings, ENV_FILE } = require("./src/config");
const { resolveEnvConfig } = require("./src/velonaClient");
const { analyzeProfileAndPlanActions } = require("./src/profileAnalyzer");
const { generateCodeToVideoReel } = require("./src/codeVideoEngine");
const { runFullAutopilotCycle } = require("./src/autopilotDaemon");
const {
  loadMemoryStore,
  retrieveContextFromRag,
  addKnowledgeDocument
} = require("./src/memoryRagEngine");

function parseCliFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        flags[key] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function maskSecret(str) {
  if (!str) return "(not set)";
  if (str.length <= 10) return "***";
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

async function main() {
  const command = (process.argv[2] || "autopilot").toLowerCase();
  const { flags, positional } = parseCliFlags(process.argv.slice(3));

  // Apply any inline CLI flags directly to process.env for this run
  if (flags["base-url"]) process.env.VELONA_BASE_URL = flags["base-url"];
  if (flags["gateway-url"]) process.env.VELONA_GATEWAY_URL = flags["gateway-url"];
  if (flags["model"]) process.env.LLM_MODEL = flags["model"];
  if (flags["api-key"]) process.env.VELONA_API_KEY = flags["api-key"];
  if (flags["fb-token"]) process.env.FB_PAGE_ACCESS_TOKEN = flags["fb-token"];
  if (flags["fb-page-id"]) process.env.FB_PAGE_ID = flags["fb-page-id"];
  if (flags["ig-id"]) process.env.IG_BUSINESS_ACCOUNT_ID = flags["ig-id"];
  if (flags["style"]) process.env.PREFERRED_VIDEO_STYLE = flags["style"];
  if (flags["trigger"]) process.env.DM_TRIGGER_KEYWORD = flags["trigger"];
  if (flags["offer"]) process.env.MONETIZATION_OFFER = flags["offer"];
  if (flags["offer-url"]) process.env.MONETIZATION_URL = flags["offer-url"];

  if (command === "set-env") {
    const state = loadState();
    const updated = updateSettings({
      ...(flags["base-url"] ? { velonaBaseUrl: flags["base-url"] } : {}),
      ...(flags["gateway-url"] ? { velonaGatewayUrl: flags["gateway-url"] } : {}),
      ...(flags["model"] ? { llmModel: flags["model"] } : {}),
      ...(flags["api-key"] ? { velonaApiKey: flags["api-key"] } : {}),
      ...(flags["fb-token"] ? { fbPageAccessToken: flags["fb-token"] } : {}),
      ...(flags["fb-page-id"] ? { fbPageId: flags["fb-page-id"] } : {}),
      ...(flags["ig-id"] ? { igBusinessAccountId: flags["ig-id"] } : {}),
      ...(flags["style"] ? { preferredVideoStyle: flags["style"] } : {}),
      ...(flags["trigger"] ? { dmTriggerKeyword: flags["trigger"] } : {}),
      ...(flags["offer"] ? { monetizationOffer: flags["offer"] } : {}),
      ...(flags["offer-url"] ? { monetizationUrl: flags["offer-url"] } : {})
    });
    console.log(`✅ Saved environment variables to ${ENV_FILE}`);
    console.log({
      VELONA_BASE_URL: updated.velonaBaseUrl,
      VELONA_GATEWAY_URL: updated.velonaGatewayUrl,
      LLM_MODEL: updated.llmModel,
      VELONA_API_KEY: maskSecret(updated.velonaApiKey),
      FB_PAGE_ACCESS_TOKEN: maskSecret(updated.fbPageAccessToken),
      FB_PAGE_ID: updated.fbPageId || "(auto-discover)",
      IG_BUSINESS_ACCOUNT_ID: updated.igBusinessAccountId || "(auto-discover)",
      PREFERRED_VIDEO_STYLE: updated.preferredVideoStyle,
      DM_TRIGGER_KEYWORD: updated.dmTriggerKeyword
    });
    return;
  }

  if (command === "env") {
    const state = loadState();
    const envCfg = resolveEnvConfig(state.settings);
    console.log("=== ACTIVE ENVIRONMENT CONFIGURATION (ZERO HARDCODING) ===");
    console.log({
      ENV_FILE,
      VELONA_BASE_URL: envCfg.baseUrl || "(not set)",
      VELONA_GATEWAY_URL: envCfg.gatewayUrl || "(not set)",
      LLM_MODEL: envCfg.model || "(not set)",
      VELONA_API_KEY: maskSecret(envCfg.apiKey),
      FB_PAGE_ACCESS_TOKEN: maskSecret(state.settings.fbPageAccessToken),
      FB_PAGE_ID: state.settings.fbPageId || "(auto-discover)",
      IG_BUSINESS_ACCOUNT_ID: state.settings.igBusinessAccountId || "(auto-discover)",
      PREFERRED_VIDEO_STYLE: state.settings.preferredVideoStyle || "fireship_code",
      DM_TRIGGER_KEYWORD: state.settings.dmTriggerKeyword || "AUTO"
    });
    return;
  }

  if (command === "memory") {
    const store = loadMemoryStore();
    console.log("=== PERSISTENT MEMORY & RAG KNOWLEDGE VAULT ===");
    console.log("Velona Memory Session:", store.velonaMemorySessionId);
    console.log(`Knowledge Base Docs (${store.knowledgeDocs.length}):`);
    for (const d of store.knowledgeDocs) {
      console.log(`  - [${d.category}] ${d.title}: ${d.content.slice(0, 90)}...`);
    }
    console.log(`Remembered Episodic Reels (${store.episodicPostsMemory.length}):`);
    for (const ep of store.episodicPostsMemory) {
      console.log(`  - [${ep.outcome}] "${ep.hookText}" (Style: ${ep.visualStyle})`);
    }
    return;
  }

  if (command === "add-memory") {
    const title = flags["title"] || "CLI Knowledge Note";
    const category = flags["category"] || "custom";
    const content = flags["content"] || positional.join(" ");
    const doc = addKnowledgeDocument({ title, category, content, source: "cli" });
    console.log("✅ Added document to RAG Knowledge Base:", doc);
    return;
  }

  if (command === "query-memory") {
    const query = flags["query"] || positional.join(" ");
    const res = retrieveContextFromRag(query, 3);
    console.log(`=== RAG RETRIEVAL FOR: "${query}" ===`);
    console.log("Top Matched Knowledge Docs:", res.matchedKnowledgeDocs);
    console.log("Anti-Duplicate Check:", res.dedupCheck);
    return;
  }

  const customTopic = flags["topic"] || positional.join(" ");
  const preferredStyle = flags["style"] || process.env.PREFERRED_VIDEO_STYLE || "";

  if (command === "analyze") {
    const state = loadState();
    const report = await analyzeProfileAndPlanActions(state);
    saveState(state);
    console.log("=== PROFILE CONTENT AUDIT ===");
    console.log("Summary:", report.summaryDiagnosis);
    console.log("Recommended Next Reel:", report.recommendedNextReel);
    console.log("Autonomous Actions Queue:", report.autonomousActionsQueue);
    return;
  }

  if (command === "render") {
    const state = loadState();
    const envCfg = resolveEnvConfig(state.settings);
    console.log("🔧 Using Environment Configuration:");
    console.log(`   VELONA_BASE_URL    = ${envCfg.baseUrl}`);
    console.log(`   VELONA_GATEWAY_URL = ${envCfg.gatewayUrl}`);
    console.log(`   LLM_MODEL          = ${envCfg.model}`);
    console.log(`   VELONA_API_KEY     = ${maskSecret(envCfg.apiKey)}`);
    console.log(`   VIDEO_STYLE        = ${preferredStyle || state.settings.preferredVideoStyle || "fireship_code"}`);

    const report = state.analysisReport || (await analyzeProfileAndPlanActions(state));
    const reel = await generateCodeToVideoReel({
      settings: state.settings,
      analysisReport: report,
      customTopic,
      preferredStyle
    });
    state.contentQueue = [reel, ...(state.contentQueue || [])].slice(0, 15);
    saveState(state);
    console.log("\n🎬 === RENDERED 9:16 CODE-TO-VIDEO REEL ===");
    console.log("Reel ID        :", reel.id);
    console.log("Title          :", reel.title);
    console.log("Hook           :", reel.hookText);
    console.log("Model Configured:", reel.llmModelUsed);
    console.log("MP4 Video Path :", reel.localMp4Path);
    console.log("Remotion Code  :", reel.remotionCodeUrl);
    console.log("Carousel Slides:", reel.carouselUrls);
    return;
  }

  // Default: full autopilot cycle
  console.log("🚀 Starting Full Autonomous Cycle (Analyze Profile -> Reply/DM Leads -> Render Code-to-Video Reel -> Auto-Publish IG + FB)...");
  const res = await runFullAutopilotCycle({
    customTopic,
    preferredStyle,
    forcePublish: true
  });
  console.log("✅ Cycle Complete!");
  for (const s of res.cycleSteps) {
    console.log(`  [${s.status}] ${s.step}: ${s.detail}`);
  }
  console.log(`Rendered MP4: ${res.reelItem.localMp4Path}`);
}

main().catch((err) => {
  console.error("CLI Error:", err);
  process.exit(1);
});
