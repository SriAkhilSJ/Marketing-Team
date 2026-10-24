/**
 * OpenAI-Compatible + Gateway AI Client (100% Environment-Variable Driven)
 * Reads base URL, gateway URL, model ID, and API key strictly from env/settings.
 */

const POPULAR_VELONA_MODELS = [
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash — ₹19.42 in / ₹52.12 out (Coding Score: 65 • #1 Best Value!)",
    provider: "DeepSeek",
    badge: "🏆 Best & Cheapest for Code Reels (~₹0.08/Reel)"
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash — Latest Fast Reasoning + Code",
    provider: "DeepSeek",
    badge: "New V4.1 Flash"
  },
  {
    id: "z-ai/glm-5.3-flash",
    name: "Z.ai GLM 5.3 Flash — Ultra-Fast Agentic & Bilingual Hooks",
    provider: "Zhipu / Z.ai",
    badge: "Fast Agent Model"
  },
  {
    id: "z-ai/glm-5.3",
    name: "Z.ai GLM 5.3 — Full Flagship Agent & Code Model",
    provider: "Zhipu / Z.ai",
    badge: "GLM 5.3 Flagship"
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro — ₹177.82 in / ₹355.65 out (1M Context Frontier)",
    provider: "DeepSeek",
    badge: "Heavy Reasoning"
  },
  {
    id: "qwen/qwen3-coder",
    name: "Qwen3 Coder — ₹30.66 in / ₹102.20 out (Dedicated Code Generator)",
    provider: "Qwen",
    badge: "Budget Coder"
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite — ₹10.22 in / ₹40.88 out (Ultra-Cheap Profile Audit)",
    provider: "Google",
    badge: "Ultra Low Cost"
  },
  {
    id: "openai/gpt-5-nano",
    name: "OpenAI GPT-5 Nano — ₹5.11 in / ₹40.88 out (Cheapest Input on Velona)",
    provider: "OpenAI",
    badge: "₹5.11/1M Input"
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6 — Premium Motion Graphics & Copywriting",
    provider: "Anthropic",
    badge: "Premium Quality"
  }
];

function resolveEnvConfig(settings = {}) {
  return {
    apiKey: (
      process.env.VELONA_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      settings.velonaApiKey ||
      ""
    ).trim(),
    baseUrl: (
      process.env.VELONA_BASE_URL ||
      process.env.LLM_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      settings.velonaBaseUrl ||
      ""
    )
      .trim()
      .replace(/\/+$/, ""),
    gatewayUrl: (
      process.env.VELONA_GATEWAY_URL ||
      settings.velonaGatewayUrl ||
      ""
    )
      .trim()
      .replace(/\/+$/, ""),
    model: (
      process.env.LLM_MODEL ||
      process.env.MODEL_ID ||
      settings.llmModel ||
      ""
    ).trim()
  };
}

async function checkVelonaCredits(settings) {
  const { apiKey, baseUrl, gatewayUrl, model } = resolveEnvConfig(settings);
  if (!apiKey) {
    return {
      connected: false,
      mode: "env_awaiting_key",
      message: `Env configured (Base URL: ${baseUrl || "not set"}, Model: ${model || "not set"}). Set VELONA_API_KEY in .env or terminal to enable live calls.`,
      balanceInr: null,
      balanceUsd: null
    };
  }

  if (!gatewayUrl) {
    return {
      connected: true,
      mode: "openai_compatible_env",
      message: `Configured via env (Base URL: ${baseUrl}, Model: ${model})`,
      balanceInr: null,
      balanceUsd: null
    };
  }

  try {
    const res = await fetch(`${gatewayUrl}/account/credits`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const json = await res.json();
      const data = json.data || {};
      return {
        connected: true,
        mode: "velona_live",
        message: `Connected to ${gatewayUrl} (Model: ${model})`,
        balanceInr: data.balance_inr ?? null,
        balanceUsd: data.balance_usd ?? null,
        usageUsd: data.usage_usd ?? null
      };
    }

    const errText = await res.text();
    return {
      connected: false,
      mode: "key_saved_offline_fallback",
      message: `Env credentials loaded (${res.status}): ${errText.slice(0, 120)}`,
      balanceInr: null
    };
  } catch (err) {
    return {
      connected: false,
      mode: "env_loaded_sandbox_fallback",
      message: `Env loaded -> Base URL: ${baseUrl} | Model: ${model} | Key: ${apiKey.slice(0, 6)}... (Using local engine in restricted sandbox).`,
      balanceInr: null
    };
  }
}

/**
 * Calls the OpenAI-compatible endpoint (${VELONA_BASE_URL}/chat/completions) first,
 * and falls back to (${VELONA_GATEWAY_URL}/inference/run) if configured.
 */
async function callVelonaChat({
  settings,
  systemPrompt,
  userPrompt,
  temperature = 0.7,
  maxTokens = 1800,
  jsonMode = false
}) {
  const { apiKey, baseUrl, gatewayUrl, model } = resolveEnvConfig(settings);

  if (!apiKey || !model || (!baseUrl && !gatewayUrl)) {
    return {
      ok: false,
      source: "missing_env",
      model,
      baseUrl,
      error: "Missing VELONA_API_KEY, VELONA_BASE_URL, or LLM_MODEL in environment"
    };
  }

  // 1. Try OpenAI-compatible /chat/completions
  if (baseUrl) {
    try {
      const chatUrl = baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl}/chat/completions`;
      const body = {
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens
      };
      if (jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const res = await fetch(chatUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const data = await res.json();
        const content =
          data?.choices?.[0]?.message?.content || data?.data?.output || "";
        if (content) {
          return {
            ok: true,
            source: chatUrl,
            model,
            content,
            usage: data.usage || data?.data?.usage || null
          };
        }
      }
    } catch (_) {
      // Proceed to gatewayUrl if configured
    }
  }

  // 2. Try Native Gateway /inference/run if VELONA_GATEWAY_URL is set
  if (gatewayUrl) {
    try {
      const memorySession =
        process.env.VELONA_MEMORY_SESSION ||
        settings.velonaMemorySession ||
        "mem_marketing_team_agent";
      const res = await fetch(`${gatewayUrl}/inference/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          turns: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: userPrompt }
          ],
          stream: false,
          config: { temperature, max_tokens: maxTokens },
          output: { format: jsonMode ? "json" : "text" },
          velona: { memory_session: memorySession }
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (res.ok) {
        const json = await res.json();
        const content = json?.data?.output || "";
        if (content) {
          return {
            ok: true,
            source: `${gatewayUrl}/inference/run`,
            model,
            content,
            usage: json?.data?.usage || null,
            meta: json?.meta || null
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        source: "network_error",
        model,
        baseUrl,
        error: err.message
      };
    }
  }

  return {
    ok: false,
    source: "fallback",
    model,
    baseUrl,
    error: "Configured endpoint unreachable from sandbox environment"
  };
}

function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

module.exports = {
  POPULAR_VELONA_MODELS,
  resolveEnvConfig,
  checkVelonaCredits,
  callVelonaChat,
  parseJsonSafely
};
