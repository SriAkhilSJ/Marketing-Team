const { VIDEO_STYLES } = require("./codeVideoEngine");
const { POPULAR_VELONA_MODELS } = require("./velonaClient");
const { EDGE_TTS_VOICES, isEdgeTtsAvailable } = require("./ttsEngine");

/**
 * Dynamic UI & Configuration Schema served via GET /api/config
 * Eliminates all hardcoded options, settings fields, KPI labels, and toggles from public/index.html.
 */
function buildUiConfigSchema(settings = {}) {
  const ttsAvailable = isEdgeTtsAvailable();
  const currentVoice = process.env.TTS_VOICE || settings.ttsVoice || "en-US-ChristopherNeural";

  return {
    appMeta: {
      title: "Marketing-Team // Autonomous Reels & Posts Agent",
      badge: "Code-to-Video + RAG Engine",
      subtitle: "1 Text Key (velona.in) • 1 Facebook Token (Auto-Links Instagram) • Profile Audit ➔ Code Reel ➔ Auto-Post & DM"
    },
    videoStyles: Object.values(VIDEO_STYLES).map((s) => ({
      id: s.id,
      label: s.name,
      accent: s.accent
    })),
    voices: EDGE_TTS_VOICES,
    ttsAvailable,
    currentVoice,
    popularModels: POPULAR_VELONA_MODELS,
    kbCategories: [
      { id: "monetization", label: "Monetization / Offer" },
      { id: "strategy", label: "Hook / Strategy Rule" },
      { id: "technical", label: "Product / Tech Spec" },
      { id: "faq", label: "Audience FAQ Answer" }
    ],
    automationModes: [
      { id: "hybrid_dashboard", label: "Hybrid Studio + Autopilot (Recommended)" },
      { id: "full_autopilot", label: "100% Hands-Free Full Autopilot" },
      { id: "review_first", label: "Review Queue Before Publishing" }
    ],
    studioTabs: [
      { id: "video", label: "🎬 9:16 MP4 Reel" },
      { id: "carousel", label: "🖼️ 4-Slide Carousel" },
      { id: "code", label: "💻 Remotion .tsx Code" },
      { id: "caption", label: "📝 Script & Caption" }
    ],
    kpiSchema: [
      {
        id: "velona",
        title: "AI ENGINE (VELONA.IN)",
        badgeKey: "velonaBadge",
        primaryKey: "activeModelLabel",
        subtextKey: "velonaStatusText",
        highlightBorder: false
      },
      {
        id: "meta",
        title: "FB PAGE ➔ LINKED INSTAGRAM",
        badgeKey: "metaBadge",
        primaryKey: "connectedAccountsLabel",
        subtextKey: "metaStatusText",
        highlightBorder: false
      },
      {
        id: "engagement",
        title: "PROFILE SAVE / SHARE SCORE",
        badgeKey: "algoWeightBadge",
        primaryKey: "kpiViews",
        secondaryKey: "kpiSaveRate",
        subtextKey: "kpiFormatComparison",
        highlightBorder: false
      },
      {
        id: "revenue",
        title: "COMMENT ➔ AUTO-DM REVENUE",
        badgeKey: "triggerKeywordBadge",
        primaryKey: "kpiRevenue",
        secondaryKey: "kpiLeads",
        subtextKey: "pendingLeadsHint",
        highlightBorder: true
      }
    ],
    settingsSchema: [
      {
        sectionId: "velona_section",
        title: "1. Velona.in OpenAI-Compatible Text API (INR Billed)",
        colorClass: "text-cyan-400",
        fields: [
          {
            key: "velonaApiKey",
            envName: "VELONA_API_KEY",
            label: "Velona API Key (sk-...)",
            type: "password",
            placeholder: "Leave blank to keep existing key, or paste sk-...",
            colSpan: 1
          },
          {
            key: "llmModel",
            envName: "LLM_MODEL",
            label: "AI Model (via Velona.in)",
            type: "select",
            optionsSource: "popularModels",
            colSpan: 1
          },
          {
            key: "velonaBaseUrl",
            envName: "VELONA_BASE_URL",
            label: "OpenAI-Compatible Base URL",
            type: "text",
            placeholder: "https://velona.in/v1",
            colSpan: 1
          },
          {
            key: "velonaGatewayUrl",
            envName: "VELONA_GATEWAY_URL",
            label: "Native Gateway URL",
            type: "text",
            placeholder: "https://velona.in/gateway/v1",
            colSpan: 1
          }
        ]
      },
      {
        sectionId: "meta_section",
        title: "2. Facebook Page Connection (Auto-Discovers Linked Instagram)",
        colorClass: "text-sky-400",
        description:
          "Because your Facebook Page is connected to your Instagram Business/Creator account, you only need your Facebook Page Access Token. The agent automatically fetches your linked instagram_business_account ID and posts to both!",
        fields: [
          {
            key: "fbPageAccessToken",
            envName: "FB_PAGE_ACCESS_TOKEN",
            label: "Facebook Page / User Access Token",
            type: "password",
            placeholder: "Leave blank to keep existing token, or paste EAAG...",
            colSpan: 2
          },
          {
            key: "fbPageId",
            envName: "FB_PAGE_ID",
            label: "Facebook Page ID (Auto-filled if blank)",
            type: "text",
            placeholder: "Auto-discovered from token",
            colSpan: 1
          },
          {
            key: "igBusinessAccountId",
            envName: "IG_BUSINESS_ACCOUNT_ID",
            label: "Linked Instagram Business ID (Auto-filled)",
            type: "text",
            placeholder: "Auto-discovered from FB Page",
            colSpan: 1
          }
        ]
      },
      {
        sectionId: "monetization_section",
        title: "3. Niche, Voice & Comment-to-DM Monetization Funnel",
        colorClass: "text-emerald-400",
        fields: [
          {
            key: "niche",
            envName: "NICHE",
            label: "Niche / Topic Focus",
            type: "text",
            placeholder: "AI Agents, Tech Automation & Side Hustle Monetization",
            colSpan: 1
          },
          {
            key: "dmTriggerKeyword",
            envName: "DM_TRIGGER_KEYWORD",
            label: "Comment Trigger Keyword (e.g. AUTO)",
            type: "text",
            placeholder: "AUTO",
            colSpan: 1
          },
          {
            key: "monetizationOffer",
            envName: "MONETIZATION_OFFER",
            label: "Monetization Offer Name",
            type: "text",
            placeholder: "AI Automation Blueprint (₹499)",
            colSpan: 1
          },
          {
            key: "monetizationUrl",
            envName: "MONETIZATION_URL",
            label: "Payment / Affiliate Link Sent in DM",
            type: "text",
            placeholder: "https://...",
            colSpan: 1
          },
          {
            key: "preferredVideoStyle",
            envName: "PREFERRED_VIDEO_STYLE",
            label: "Default Code-to-Video Style",
            type: "select",
            optionsSource: "videoStyles",
            colSpan: 1
          },
          {
            key: "ttsVoice",
            envName: "TTS_VOICE",
            label: "Default Neural Voiceover (Edge TTS)",
            type: "select",
            optionsSource: "voices",
            colSpan: 1
          }
        ]
      },
      {
        sectionId: "autopilot_section",
        title: "4. Autopilot Mode & Action Toggles",
        colorClass: "text-amber-400",
        fields: [
          {
            key: "automationMode",
            envName: "AUTOMATION_MODE",
            label: "Operating Mode",
            type: "select",
            optionsSource: "automationModes",
            colSpan: 2
          },
          {
            key: "autoPublishToInstagram",
            envName: "AUTO_PUBLISH_IG",
            label: "Auto-Publish Reels to Linked Instagram",
            type: "checkbox",
            colSpan: 1
          },
          {
            key: "autoPublishToFacebook",
            envName: "AUTO_PUBLISH_FB",
            label: "Auto-Publish Reels to Facebook Page",
            type: "checkbox",
            colSpan: 1
          },
          {
            key: "autoReplyComments",
            envName: "AUTO_REPLY_COMMENTS",
            label: "Auto-Reply Publicly to Comments",
            type: "checkbox",
            colSpan: 1
          },
          {
            key: "autoDmLeads",
            envName: "AUTO_DM_LEADS",
            label: "Auto-Send Private Reply DM Offer Link",
            type: "checkbox",
            colSpan: 1
          }
        ]
      }
    ]
  };
}

module.exports = {
  buildUiConfigSchema
};
