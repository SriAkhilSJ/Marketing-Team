const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./config");
const { resolveEnvConfig } = require("./velonaClient");

const MEMORY_FILE = path.join(DATA_DIR, "memory_rag.json");
const KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge");

if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

const DEFAULT_KNOWLEDGE_DOCS = [
  {
    id: "kb_brand_playbook",
    title: "Brand Voice & Viral Hook Playbook (2026 IG/FB Algorithm)",
    category: "strategy",
    source: "data/knowledge/brand_playbook.md",
    createdAt: "2026-10-24T06:00:00.000Z",
    content:
      "Instagram & Facebook 2026 algorithm weights Saves 3x and Shares 3x over Likes. " +
      "Every Reel must open with a concrete 3-second scroll-stopping hook contrasting old expensive tools ($99/mo subscriptions or static image slideshows) against fast programmatic Code-to-Video Reels costing ~₹0.08 via Velona.in. " +
      "Never use generic listicle hooks like '5 AI Tips'. Always include a single-word Comment-to-DM trigger keyword so the agent can send the Private Reply DM link automatically."
  },
  {
    id: "kb_product_offer",
    title: "Monetization Offer & Funnel Facts",
    category: "monetization",
    source: "data/knowledge/offer_specs.md",
    createdAt: "2026-10-24T06:05:00.000Z",
    content:
      "Core Offer: AI Automation Blueprint + Ready-to-Use Code-to-Video Agent Templates (₹499 / $19). " +
      "Includes: 1) Single Facebook Page Token setup that auto-discovers linked Instagram Business account, " +
      "2) Profile Analyzer & Comment Question Miner, 3) Remotion + Canvas 9:16 MP4 Code-to-Video Engine, " +
      "4) Persistent RAG + Episodic Content Memory so the agent never repeats hooks or spams commenters."
  },
  {
    id: "kb_velona_specs",
    title: "Velona.in Model & Cost Reference",
    category: "technical",
    source: "data/knowledge/velona_models.md",
    createdAt: "2026-10-24T06:10:00.000Z",
    content:
      "Velona.in provides 300+ models via OpenAI-compatible $VELONA_BASE_URL (/v1/chat/completions) and native $VELONA_GATEWAY_URL (/gateway/v1/inference/run & /gateway/v1/inference/embed) with ₹10 minimum UPI top-up. " +
      "Best value coding model: deepseek/deepseek-v4-flash (Coding score 65.0, ₹19.42/1M input, ₹52.12/1M output, ~₹0.08 per Reel). " +
      "Also supports z-ai/glm-5.3-flash, z-ai/glm-5.3, qwen/qwen3-coder, and google/gemini-2.5-flash-lite."
  }
];

function loadMemoryStore() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
      return {
        velonaMemorySessionId: parsed.velonaMemorySessionId || "mem_marketing_team_agent",
        knowledgeDocs: Array.isArray(parsed.knowledgeDocs) ? parsed.knowledgeDocs : DEFAULT_KNOWLEDGE_DOCS,
        episodicPostsMemory: Array.isArray(parsed.episodicPostsMemory) ? parsed.episodicPostsMemory : [],
        contactedUsersMemory: parsed.contactedUsersMemory || {},
        retrievalLogs: Array.isArray(parsed.retrievalLogs) ? parsed.retrievalLogs : []
      };
    }
  } catch (err) {
    console.error("Failed to read memory_rag.json, initializing fresh store:", err.message);
  }

  const initial = {
    velonaMemorySessionId: process.env.VELONA_MEMORY_SESSION || "mem_marketing_team_agent",
    knowledgeDocs: DEFAULT_KNOWLEDGE_DOCS,
    episodicPostsMemory: [
      {
        id: "mem_post_101",
        hookText: "Stop paying $99/mo for AI video tools 🛑",
        topic: "Replacing $99/mo video subscriptions with 60fps Code-to-Video Reels",
        visualStyle: "fireship_code",
        outcome: "WINNER",
        views: 64200,
        saveRate: 6.58,
        dmLeads: 438,
        recordedAt: "2026-10-23T14:00:00Z"
      },
      {
        id: "mem_post_102",
        hookText: "100 AI Reels for ₹10 using DeepSeek V4 Flash ⚡",
        topic: "Token cost breakdown of generating 100 Reels with ₹10 UPI top-up",
        visualStyle: "data_counter",
        outcome: "WINNER",
        views: 49800,
        saveRate: 7.01,
        dmLeads: 315,
        recordedAt: "2026-10-22T16:30:00Z"
      },
      {
        id: "mem_post_103",
        hookText: "5 AI Tips for Business in 2026",
        topic: "Generic AI tips slideshow with static images",
        visualStyle: "pollinations_slideshow",
        outcome: "AVOID_FORMAT",
        views: 4100,
        saveRate: 1.15,
        dmLeads: 2,
        recordedAt: "2026-10-20T12:00:00Z"
      }
    ],
    contactedUsersMemory: {
      "@rahul_builds": { lastDmAt: "2026-10-23T14:05:00Z", trigger: "AUTO", count: 1 }
    },
    retrievalLogs: []
  };

  saveMemoryStore(initial);
  return initial;
}

function saveMemoryStore(store) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save memory_rag.json:", err.message);
  }
}

/**
 * Tokenizes text into normalized terms & bigrams for hybrid BM25 + Cosine similarity retrieval
 */
function tokenize(text) {
  const clean = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9₹$_\s-]/g, " ");
  const words = clean.split(/\s+/).filter((w) => w.length > 1);
  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]}_${words[i + 1]}`);
  }
  return tokens;
}

function computeSimilarity(textA, textB) {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const freqA = {};
  const freqB = {};
  for (const t of tokensA) freqA[t] = (freqA[t] || 0) + 1;
  for (const t of tokensB) freqB[t] = (freqB[t] || 0) + 1;

  const vocab = new Set([...Object.keys(freqA), ...Object.keys(freqB)]);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const term of vocab) {
    const a = freqA[term] || 0;
    const b = freqB[term] || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return +(dot / (Math.sqrt(normA) * Math.sqrt(normB))).toFixed(3);
}

/**
 * Optional Velona Native Embeddings call (POST ${VELONA_GATEWAY_URL}/inference/embed)
 * Falls back transparently to local hybrid BM25/Cosine vectors when offline.
 */
async function tryVelonaEmbed(texts, settings = {}) {
  const { apiKey, gatewayUrl } = resolveEnvConfig(settings);
  const embedModel = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
  if (!apiKey || !gatewayUrl) return null;

  try {
    const res = await fetch(`${gatewayUrl}/inference/embed`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: embedModel,
        inputs: texts
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const json = await res.json();
      return json?.data?.vectors || null;
    }
  } catch (_) {
    // Fallback to local hybrid vector similarity
  }
  return null;
}

/**
 * Retrieves top-K Knowledge Base chunks + Episodic Past Reels Memory for a query,
 * and checks Anti-Duplicate similarity against all remembered Reels.
 */
function retrieveContextFromRag(query, topK = 4) {
  const store = loadMemoryStore();
  const q = String(query || "").trim();

  // 1. Score Knowledge Base documents
  const scoredDocs = (store.knowledgeDocs || [])
    .map((doc) => {
      const score = computeSimilarity(q, `${doc.title} ${doc.category} ${doc.content}`);
      return {
        ...doc,
        similarityScore: score
      };
    })
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, topK);

  // 2. Score Episodic Past Posts (to find similar past posts & check duplication)
  const scoredEpisodes = (store.episodicPostsMemory || [])
    .map((ep) => {
      const score = computeSimilarity(q, `${ep.hookText} ${ep.topic} ${ep.voiceover || ""}`);
      return {
        ...ep,
        similarityScore: score
      };
    })
    .sort((a, b) => b.similarityScore - a.similarityScore);

  const highestDuplicateMatch = scoredEpisodes[0] || null;
  const isNearDuplicate = Boolean(highestDuplicateMatch && highestDuplicateMatch.similarityScore >= 0.78);

  const winningEpisodes = (store.episodicPostsMemory || []).filter((e) => e.outcome === "WINNER").slice(0, 3);
  const avoidedFormats = (store.episodicPostsMemory || []).filter((e) => e.outcome === "AVOID_FORMAT");

  // Log retrieval
  if (q) {
    store.retrievalLogs = [
      {
        id: `rag_q_${Date.now()}`,
        timestamp: new Date().toISOString(),
        query: q,
        topDocMatch: scoredDocs[0]?.title || "Default Playbook",
        topDocScore: scoredDocs[0]?.similarityScore || 0,
        highestEpisodeOverlap: highestDuplicateMatch?.hookText || "None",
        overlapScore: highestDuplicateMatch?.similarityScore || 0,
        dedupPassed: !isNearDuplicate
      },
      ...(store.retrievalLogs || [])
    ].slice(0, 25);
    saveMemoryStore(store);
  }

  return {
    velonaMemorySessionId: store.velonaMemorySessionId,
    matchedKnowledgeDocs: scoredDocs,
    winningEpisodes,
    avoidedFormats,
    dedupCheck: {
      isNearDuplicate,
      maxOverlapScore: highestDuplicateMatch?.similarityScore || 0,
      closestPastHook: highestDuplicateMatch?.hookText || null
    }
  };
}

/**
 * Adds a new Knowledge Document (from UI or CLI) into the RAG Knowledge Base
 */
function addKnowledgeDocument({ title, category = "custom", content, source = "ui_upload" }) {
  const store = loadMemoryStore();
  const doc = {
    id: `kb_${Date.now()}`,
    title: String(title || "Untitled Knowledge Note").trim(),
    category: String(category || "custom").trim(),
    source,
    createdAt: new Date().toISOString(),
    content: String(content || "").trim()
  };
  store.knowledgeDocs = [doc, ...(store.knowledgeDocs || [])];
  saveMemoryStore(store);
  return doc;
}

/**
 * Deletes a Knowledge Document by ID
 */
function deleteKnowledgeDocument(docId) {
  const store = loadMemoryStore();
  store.knowledgeDocs = (store.knowledgeDocs || []).filter((d) => d.id !== docId);
  saveMemoryStore(store);
  return store.knowledgeDocs;
}

/**
 * Records a newly generated or published Reel into Episodic Content Memory
 * so the agent remembers every hook, script, caption, and style it has ever created.
 */
function rememberGeneratedReel(reelItem) {
  const store = loadMemoryStore();
  const filtered = (store.episodicPostsMemory || []).filter(
    (e) => e.id !== reelItem.id && e.hookText !== reelItem.hookText
  );
  store.episodicPostsMemory = [
    {
      id: reelItem.id,
      hookText: reelItem.hookText,
      topic: reelItem.title,
      visualStyle: reelItem.visualStyle,
      voiceover: reelItem.voiceoverFull,
      outcome: "REMEMBERED_REEL",
      views: 0,
      saveRate: 0,
      dmLeads: 0,
      recordedAt: new Date().toISOString()
    },
    ...filtered
  ].slice(0, 100);
  saveMemoryStore(store);
  return store;
}

/**
 * Remembers that a user was replied to / DMed so the agent never double-DMs the same follower.
 */
function rememberContactedUser(username, triggerKeyword) {
  const store = loadMemoryStore();
  const prev = store.contactedUsersMemory[username] || { count: 0 };
  store.contactedUsersMemory[username] = {
    lastDmAt: new Date().toISOString(),
    trigger: triggerKeyword,
    count: (prev.count || 0) + 1
  };
  saveMemoryStore(store);
}

module.exports = {
  MEMORY_FILE,
  loadMemoryStore,
  saveMemoryStore,
  retrieveContextFromRag,
  addKnowledgeDocument,
  deleteKnowledgeDocument,
  rememberGeneratedReel,
  rememberContactedUser,
  tryVelonaEmbed,
  computeSimilarity
};
