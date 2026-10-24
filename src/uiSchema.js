const { VIDEO_STYLES } = require("./codeVideoEngine");
const { POPULAR_VELONA_MODELS } = require("./velonaClient");
const { EDGE_TTS_VOICES, isEdgeTtsAvailable } = require("./ttsEngine");

const KB_CATEGORIES = [
  { id: "monetization", label: "MONETIZATION & OFFER" },
  { id: "product", label: "PRODUCT / TECH STACK" },
  { id: "hooks", label: "VIRAL HOOKS & RULES" },
  { id: "audience", label: "AUDIENCE FAQ" },
  { id: "brand", label: "BRAND VOICE & PROOF" }
];

const AUTOMATION_MODES = [
  {
    id: "hybrid_dashboard",
    label: "HYBRID STUDIO + ONE-CLICK AUTOPILOT",
    description: "Inspect analytics, preview 30fps monochrome Reels, and trigger full autopilot anytime."
  },
  {
    id: "full_autopilot",
    label: "FULL AUTOPILOT (ZERO-TOUCH)",
    description: "Automatically audits profile, renders 9:16 MP4 + Carousel, publishes to IG & FB, and DMs commenters."
  },
  {
    id: "review_first",
    label: "REVIEW BEFORE PUBLISH",
    description: "Generates MP4 + Carousel into PENDING_REVIEW queue for manual sign-off."
  }
];

const STUDIO_TABS = [
  { id: "video", label: "01 // 9:16 MP4" },
  { id: "carousel", label: "02 // CAROUSEL (4)" },
  { id: "code", label: "03 // REMOTION .TSX" },
  { id: "caption", label: "04 // SCRIPT & CTA" }
];

const KPI_SCHEMA = [
  {
    id: "llm_engine",
    label: "01 // TEXT-TO-TEXT ENGINE",
    valueKey: "llmEngineTitle",
    subKey: "llmEngineSubtitle",
    badgeKey: "llmEngineBadge"
  },
  {
    id: "meta_graph",
    label: "02 // FB -> IG LINKED AUTH",
    valueKey: "metaStatusTitle",
    subKey: "metaStatusSubtitle",
    badgeKey: "metaStatusBadge"
  },
  {
    id: "profile_saves",
    label: "03 // CODE REEL SAVE RATE",
    valueKey: "saveRateTitle",
    subKey: "saveRateSubtitle",
    badgeKey: "saveRateBadge"
  },
  {
    id: "rag_memory",
    label: "04 // PERSISTENT RAG VAULT",
    valueKey: "ragMemoryTitle",
    subKey: "ragMemorySubtitle",
    badgeKey: "ragMemoryBadge"
  }
];

function buildUiConfigSchema(settings = {}) {
  const videoStyles = Object.values(VIDEO_STYLES).map((s) => ({
    id: s.id,
    name: s.name,
    accent: s.accent,
    secondary: s.secondary
  }));

  const currentVoice =
    process.env.TTS_VOICE || settings.ttsVoice || "en-US-ChristopherNeural";

  const settingsSchema = [
    {
      sectionId: "velona_env",
      title: "01 // OpenAI-Compatible & Gateway Environment (.env)",
      subtitle: "Reads and persists directly to process.env and .env with zero hardcoding.",
      fields: [
        {
          key: "velonaApiKey",
          envVar: "VELONA_API_KEY",
          label: "API Key (VELONA_API_KEY)",
          type: "password",
          placeholder: "sk-...",
          value: settings.velonaApiKey || ""
        },
        {
          key: "velonaBaseUrl",
          envVar: "VELONA_BASE_URL",
          label: "OpenAI-Compatible Base URL (VELONA_BASE_URL)",
          type: "text",
          placeholder: "https://velona.in/v1",
          value: process.env.VELONA_BASE_URL || settings.velonaBaseUrl || ""
        },
        {
          key: "velonaGatewayUrl",
          envVar: "VELONA_GATEWAY_URL",
          label: "Gateway Base URL (VELONA_GATEWAY_URL)",
          type: "text",
          placeholder: "https://velona.in/gateway/v1",
          value: process.env.VELONA_GATEWAY_URL || settings.velonaGatewayUrl || ""
        },
        {
          key: "llmModel",
          envVar: "LLM_MODEL",
          label: "Model ID (LLM_MODEL)",
          type: "model_select_or_custom",
          placeholder: "deepseek/deepseek-v4-flash",
          value: process.env.LLM_MODEL || settings.llmModel || "",
          options: POPULAR_VELONA_MODELS.map((m) => ({
            id: m.id,
            label: `${m.name} [${m.id}]`,
            badge: m.badge
          }))
        }
      ]
    },
    {
      sectionId: "meta_auth",
      title: "02 // Single Facebook Page Connection -> Linked Instagram Discovery",
      subtitle: "One Facebook Page Access Token controls both Facebook Page and linked Instagram Business.",
      fields: [
        {
          key: "fbPageAccessToken",
          envVar: "FB_PAGE_ACCESS_TOKEN",
          label: "Facebook Page Access Token (FB_PAGE_ACCESS_TOKEN)",
          type: "password",
          placeholder: "EAABsbCS1iHgBO...",
          value: settings.fbPageAccessToken || ""
        },
        {
          key: "fbPageId",
          envVar: "FB_PAGE_ID",
          label: "Facebook Page ID (Optional — Auto-Discovered)",
          type: "text",
          placeholder: "Auto-discovered from /me/accounts",
          value: settings.fbPageId || ""
        },
        {
          key: "igBusinessAccountId",
          envVar: "IG_BUSINESS_ACCOUNT_ID",
          label: "Linked Instagram Business ID (Auto-Discovered)",
          type: "text",
          placeholder: "Auto-discovered from Facebook Page",
          value: settings.igBusinessAccountId || ""
        },
        {
          key: "publicVideoBaseUrl",
          envVar: "PUBLIC_VIDEO_BASE_URL",
          label: "Public Video Base URL (For Meta Graph Reel Container Fetch)",
          type: "text",
          placeholder: "https://your-domain-or-tunnel.app",
          value: settings.publicVideoBaseUrl || ""
        }
      ]
    },
    {
      sectionId: "monetization_funnel",
      title: "03 // Niche, Brand Voice & Comment-to-DM Monetization Funnel",
      subtitle: "Used by the RAG Engine, Code-to-Video Generator, and Private Reply DM Responder.",
      fields: [
        {
          key: "profileHandle",
          envVar: "PROFILE_HANDLE",
          label: "Profile Handle",
          type: "text",
          placeholder: "@ai.wealth.builder",
          value: settings.profileHandle || ""
        },
        {
          key: "niche",
          envVar: "NICHE",
          label: "Account Niche & Positioning",
          type: "text",
          placeholder: "AI Agents, Tech Automation & Side Hustle Monetization",
          value: settings.niche || ""
        },
        {
          key: "brandVoice",
          envVar: "BRAND_VOICE",
          label: "Brand Voice",
          type: "text",
          placeholder: "Direct, high-clarity, proof-driven, zero fluff",
          value: settings.brandVoice || ""
        },
        {
          key: "dmTriggerKeyword",
          envVar: "DM_TRIGGER_KEYWORD",
          label: "Comment Trigger Keyword (DM_TRIGGER_KEYWORD)",
          type: "text",
          placeholder: "AUTO",
          value: settings.dmTriggerKeyword || "AUTO"
        },
        {
          key: "monetizationOffer",
          envVar: "MONETIZATION_OFFER",
          label: "Monetization Offer Name & Price",
          type: "text",
          placeholder: "AI Automation Blueprint + Ready-to-Use Templates (Rs.499)",
          value: settings.monetizationOffer || ""
        },
        {
          key: "monetizationUrl",
          envVar: "MONETIZATION_URL",
          label: "Monetization Checkout / Funnel URL",
          type: "text",
          placeholder: "https://your-offer-link.com",
          value: settings.monetizationUrl || ""
        }
      ]
    },
    {
      sectionId: "studio_defaults",
      title: "04 // Autopilot Mode, Default Video Style & Neural Voice",
      subtitle: "Controls autonomous execution behavior and default rendering parameters.",
      fields: [
        {
          key: "automationMode",
          envVar: "AUTOMATION_MODE",
          label: "Execution Mode (AUTOMATION_MODE)",
          type: "select",
          value: settings.automationMode || "hybrid_dashboard",
          options: AUTOMATION_MODES.map((m) => ({ id: m.id, label: m.label }))
        },
        {
          key: "preferredVideoStyle",
          envVar: "PREFERRED_VIDEO_STYLE",
          label: "Default Code-to-Video Style (PREFERRED_VIDEO_STYLE)",
          type: "select",
          value: settings.preferredVideoStyle || "fireship_code",
          options: videoStyles.map((s) => ({ id: s.id, label: s.name }))
        },
        {
          key: "ttsVoice",
          envVar: "TTS_VOICE",
          label: "Default Neural Voiceover (TTS_VOICE)",
          type: "select",
          value: currentVoice,
          options: EDGE_TTS_VOICES
        },
        {
          key: "autoReplyComments",
          envVar: "AUTO_REPLY_COMMENTS",
          label: "Auto-Reply to Post Comments",
          type: "checkbox",
          value: settings.autoReplyComments !== false
        },
        {
          key: "autoSendDm",
          envVar: "AUTO_SEND_DM",
          label: "Auto-Send Private Reply DMs on Keyword Match",
          type: "checkbox",
          value: settings.autoSendDm !== false
        }
      ]
    }
  ];

  return {
    appMeta: {
      title: "AUTONOMOUS REELS // MONOCHROME STUDIO",
      subtitle: "Procedural 30fps Code-to-Video Engine • FB->IG Single Auth • Persistent RAG Memory",
      badge: "MONOCHROME v2.0"
    },
    videoStyles,
    voices: EDGE_TTS_VOICES,
    ttsAvailable: isEdgeTtsAvailable(),
    currentVoice,
    popularModels: POPULAR_VELONA_MODELS,
    kbCategories: KB_CATEGORIES,
    automationModes: AUTOMATION_MODES,
    studioTabs: STUDIO_TABS,
    kpiSchema: KPI_SCHEMA,
    settingsSchema
  };
}

module.exports = {
  buildUiConfigSchema
};
