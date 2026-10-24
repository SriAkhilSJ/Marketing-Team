/**
 * Dynamic Schema-Driven Frontend Application for Autonomous AI Reels & Posts Studio
 * Loads all options, styles, voices, KPI cards, and settings fields from /api/config & /api/state.
 * Zero hardcoded options or static form definitions in HTML.
 */

let uiConfig = null;
let appState = null;
let activeReel = null;
let activeStudioTab = "video";

function showToast(msg) {
  const el = document.getElementById("statusToast");
  const txt = document.getElementById("statusToastText");
  if (!el || !txt) return;
  txt.textContent = msg;
  el.classList.remove("hidden");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function initApp() {
  try {
    const [cfgRes, stateRes] = await Promise.all([
      fetch("/api/config"),
      fetch("/api/state")
    ]);
    const cfgData = await cfgRes.json();
    const stateData = await stateRes.json();

    if (cfgData.ok) {
      uiConfig = cfgData;
    } else if (stateData.uiConfig) {
      uiConfig = stateData.uiConfig;
    }

    if (stateData.ok) {
      appState = stateData;
      if (stateData.uiConfig) uiConfig = stateData.uiConfig;
    }

    renderDynamicShell();
    renderDashboard();
  } catch (err) {
    showToast(`Failed to initialize studio: ${err.message}`);
  }
}

async function fetchState() {
  const res = await fetch("/api/state");
  const data = await res.json();
  if (!data.ok) return;
  appState = data;
  if (data.uiConfig) {
    uiConfig = data.uiConfig;
  }
  renderDynamicShell();
  renderDashboard();
}

/**
 * Populates all dynamic dropdowns, tabs, KPI cards, and schema-driven settings form from /api/config
 */
function renderDynamicShell() {
  if (!uiConfig) return;
  const settings = appState?.settings || {};

  // 1. Header meta
  if (uiConfig.appMeta) {
    document.getElementById("appTitle").textContent = uiConfig.appMeta.title;
    document.getElementById("appBadge").textContent = uiConfig.appMeta.badge;
    document.getElementById("appSubtitle").textContent = uiConfig.appMeta.subtitle;
  }

  // 2. Video Styles Dropdown
  const styleSelect = document.getElementById("videoStyleSelect");
  if (styleSelect && Array.isArray(uiConfig.videoStyles)) {
    const currentStyle = styleSelect.value || settings.preferredVideoStyle || uiConfig.videoStyles[0]?.id;
    styleSelect.innerHTML = uiConfig.videoStyles
      .map(
        (s) =>
          `<option value="${escapeHtml(s.id)}" ${s.id === currentStyle ? "selected" : ""}>${escapeHtml(s.label)}</option>`
      )
      .join("");
  }

  // 3. Voices Dropdown + Edge TTS status badge
  const voiceSelect = document.getElementById("ttsVoiceSelect");
  const ttsBadge = document.getElementById("ttsStatusBadge");
  if (voiceSelect && Array.isArray(uiConfig.voices)) {
    const currentVoice = voiceSelect.value || uiConfig.currentVoice || settings.ttsVoice;
    voiceSelect.innerHTML = uiConfig.voices
      .map(
        (v) =>
          `<option value="${escapeHtml(v.id)}" ${v.id === currentVoice ? "selected" : ""}>${escapeHtml(v.label)}</option>`
      )
      .join("");
  }
  if (ttsBadge) {
    if (uiConfig.ttsAvailable) {
      ttsBadge.textContent = "✅ Edge TTS";
      ttsBadge.className =
        "px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    } else {
      ttsBadge.textContent = "⚡ Synth Audio";
      ttsBadge.className =
        "px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30";
    }
  }

  // 4. Knowledge Base Categories Dropdown
  const kbCatSelect = document.getElementById("kbCategoryInput");
  if (kbCatSelect && Array.isArray(uiConfig.kbCategories)) {
    const prevCat = kbCatSelect.value || uiConfig.kbCategories[0]?.id;
    kbCatSelect.innerHTML = uiConfig.kbCategories
      .map(
        (c) =>
          `<option value="${escapeHtml(c.id)}" ${c.id === prevCat ? "selected" : ""}>${escapeHtml(c.label)}</option>`
      )
      .join("");
  }

  // 5. Studio Tabs Bar
  const tabsBar = document.getElementById("studioTabsBar");
  if (tabsBar && Array.isArray(uiConfig.studioTabs)) {
    tabsBar.innerHTML = uiConfig.studioTabs
      .map((tab) => {
        const isActive = tab.id === activeStudioTab;
        const cls = isActive
          ? "px-3 py-2 border-b-2 border-cyan-400 text-cyan-300"
          : "px-3 py-2 border-b-2 border-transparent text-slate-400 hover:text-white";
        return `<button onclick="switchStudioTab('${escapeHtml(tab.id)}')" id="tabBtn_${escapeHtml(tab.id)}" class="${cls}">${escapeHtml(tab.label)}</button>`;
      })
      .join("");
  }

  // 6. Schema-driven Settings Modal Form
  renderSchemaSettingsForm();
}

function getOptionsForSource(sourceKey) {
  if (!uiConfig) return [];
  const raw = uiConfig[sourceKey] || [];
  return raw.map((item) => ({
    id: item.id,
    label: item.label || item.name || item.id
  }));
}

function renderSchemaSettingsForm() {
  const container = document.getElementById("dynamicSettingsForm");
  if (!container || !uiConfig?.settingsSchema) return;
  const settings = appState?.settings || {};

  container.innerHTML = uiConfig.settingsSchema
    .map((section) => {
      const fieldsHtml = (section.fields || [])
        .map((field) => {
          const colClass = field.colSpan === 2 ? "sm:col-span-2" : "sm:col-span-1";
          const currentVal = settings[field.key];

          if (field.type === "checkbox") {
            const checked = Boolean(currentVal) ? "checked" : "";
            return `
              <label class="${colClass} flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  data-setting-key="${escapeHtml(field.key)}"
                  data-setting-type="checkbox"
                  ${checked}
                  class="w-4 h-4 accent-cyan-400 rounded"
                />
                <span class="text-slate-200 font-semibold">${escapeHtml(field.label)}</span>
                <span class="ml-auto text-[10px] text-slate-500 mono">${escapeHtml(field.envName || "")}</span>
              </label>
            `;
          }

          if (field.type === "select") {
            const opts = getOptionsForSource(field.optionsSource);
            const optionsHtml = opts
              .map(
                (o) =>
                  `<option value="${escapeHtml(o.id)}" ${o.id === currentVal ? "selected" : ""}>${escapeHtml(o.label)}</option>`
              )
              .join("");
            return `
              <div class="${colClass}">
                <div class="flex items-center justify-between mb-1">
                  <label class="text-slate-300 font-semibold">${escapeHtml(field.label)}</label>
                  <span class="text-[10px] text-slate-500 mono">${escapeHtml(field.envName || "")}</span>
                </div>
                <select
                  data-setting-key="${escapeHtml(field.key)}"
                  data-setting-type="select"
                  class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                >
                  ${optionsHtml}
                </select>
              </div>
            `;
          }

          // text or password
          const isPassword = field.type === "password";
          const valueAttr = isPassword ? "" : escapeHtml(currentVal || "");
          const placeholderText =
            isPassword && ((field.key === "velonaApiKey" && settings.hasVelonaKey) || (field.key === "fbPageAccessToken" && settings.hasFbToken))
              ? `Saved (${field.key === "velonaApiKey" ? settings.velonaKeyPreview : settings.fbTokenPreview}) — leave blank to keep`
              : field.placeholder || "";

          return `
            <div class="${colClass}">
              <div class="flex items-center justify-between mb-1">
                <label class="text-slate-300 font-semibold">${escapeHtml(field.label)}</label>
                <span class="text-[10px] text-slate-500 mono">${escapeHtml(field.envName || "")}</span>
              </div>
              <input
                type="${isPassword ? "password" : "text"}"
                data-setting-key="${escapeHtml(field.key)}"
                data-setting-type="${escapeHtml(field.type)}"
                value="${valueAttr}"
                placeholder="${escapeHtml(placeholderText)}"
                class="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
              />
            </div>
          `;
        })
        .join("");

      return `
        <div class="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div class="font-bold ${escapeHtml(section.colorClass || "text-cyan-400")} uppercase tracking-wider">
            ${escapeHtml(section.title)}
          </div>
          ${section.description ? `<p class="text-slate-400">${escapeHtml(section.description)}</p>` : ""}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${fieldsHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderKpiStrip() {
  if (!uiConfig?.kpiSchema || !appState) return;
  const { settings, velonaStatus, metaStatus, profileSnapshot, analysisReport } = appState;
  const summary = analysisReport?.profileMetricsSummary || {};
  const igUser = profileSnapshot?.instagramAccount?.username || settings.profileHandle || "profile";
  const fbName = profileSnapshot?.facebookPage?.name || "Facebook Page";

  const kpiValues = {
    velonaBadge: velonaStatus?.connected
      ? `₹${velonaStatus.balanceInr ?? "Live"}`
      : settings.hasVelonaKey
      ? "Key Saved"
      : "Env Engine",
    activeModelLabel: settings.llmModel || "deepseek/deepseek-v4-flash",
    velonaStatusText: velonaStatus?.message || "",
    metaBadge: metaStatus?.connected ? "Live Graph API" : "Single FB Auth",
    connectedAccountsLabel: `${fbName} ➔ @${igUser.replace(/^@/, "")}`,
    metaStatusText: metaStatus?.message || "",
    algoWeightBadge: "2026 Algo 3x Weight",
    kpiViews: (summary.totalViews || 0).toLocaleString("en-IN"),
    kpiSaveRate: `${summary.avgSaveRate || 0}% Avg Saves`,
    kpiFormatComparison: "Code-to-Video beats static slideshows by 14.2x",
    triggerKeywordBadge: `Trigger: "${settings.dmTriggerKeyword || "AUTO"}"`,
    kpiRevenue: `₹${(summary.totalRevenueInr || 0).toLocaleString("en-IN")}`,
    kpiLeads: `(${summary.totalLeads || 0} DM Leads)`,
    pendingLeadsHint: `${summary.pendingKeywordLeadsCount || 0} pending "${settings.dmTriggerKeyword || "AUTO"}" leads + ${summary.unansweredQuestionsCount || 0} questions`
  };

  const grid = document.getElementById("kpiGrid");
  if (!grid) return;

  grid.innerHTML = uiConfig.kpiSchema
    .map((card) => {
      const borderCls = card.highlightBorder ? "border-emerald-500/30" : "";
      const primaryVal = kpiValues[card.primaryKey] || "";
      const secondaryVal = card.secondaryKey ? kpiValues[card.secondaryKey] : "";
      const badgeVal = kpiValues[card.badgeKey] || "";
      const subVal = kpiValues[card.subtextKey] || "";

      return `
        <div class="glass rounded-2xl p-4 ${borderCls}">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>${escapeHtml(card.title)}</span>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              ${escapeHtml(badgeVal)}
            </span>
          </div>
          <div class="flex items-baseline gap-2">
            <div class="font-extrabold text-base sm:text-lg text-white truncate">${escapeHtml(primaryVal)}</div>
            ${
              secondaryVal
                ? `<span class="text-xs text-emerald-400 font-semibold shrink-0">${escapeHtml(secondaryVal)}</span>`
                : ""
            }
          </div>
          <p class="text-xs text-slate-400 mt-1 line-clamp-2">${escapeHtml(subVal)}</p>
        </div>
      `;
    })
    .join("");
}

function renderDashboard() {
  if (!appState) return;
  const { profileSnapshot, analysisReport, contentQueue } = appState;

  renderKpiStrip();

  // Analysis Report
  document.getElementById("analysisSourceLabel").textContent = analysisReport?.llmSource || "";
  document.getElementById("diagnosisSummary").textContent = analysisReport?.summaryDiagnosis || "";

  document.getElementById("winningPatternsList").innerHTML = (analysisReport?.winningPatterns || [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");

  document.getElementById("dropPatternsList").innerHTML = (analysisReport?.dropImmediately || [])
    .map((d) => `<li>${escapeHtml(d)}</li>`)
    .join("");

  // Recent Posts Audited
  document.getElementById("recentPostsContainer").innerHTML = (profileSnapshot?.recentPosts || [])
    .map((post) => {
      const isSlideshow = post.visualStyle === "pollinations_slideshow";
      const badgeClass = isSlideshow
        ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
        : "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
      return `
        <div class="p-3.5 rounded-xl bg-slate-900/75 border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}">
                ${escapeHtml(post.visualStyle)}
              </span>
              <span class="text-xs font-bold text-white">${escapeHtml(post.hookText)}</span>
            </div>
            <p class="text-xs text-slate-400 line-clamp-1">${escapeHtml(post.caption)}</p>
          </div>
          <div class="flex items-center gap-4 text-xs shrink-0">
            <div>
              <div class="text-slate-400 text-[10px]">VIEWS</div>
              <div class="font-bold text-white">${(post.metrics?.views || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="text-slate-400 text-[10px]">SAVES</div>
              <div class="font-bold text-cyan-300">${(post.metrics?.saves || 0).toLocaleString()}</div>
            </div>
            <div>
              <div class="text-slate-400 text-[10px]">DM LEADS</div>
              <div class="font-bold text-emerald-400">${post.metrics?.dmLeadsTriggered || 0}</div>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // Autonomous Actions Queue
  document.getElementById("actionsQueueContainer").innerHTML = (analysisReport?.autonomousActionsQueue || [])
    .map((act) => {
      const actionClick =
        act.type === "AUTO_REPLY_AND_DM"
          ? "processAllComments()"
          : act.type === "GENERATE_CODE_TO_VIDEO_REEL" || act.type === "GENERATE_CAROUSEL_POST"
          ? "generateNewCodeReel()"
          : "publishActiveReel()";
      return `
        <div class="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                ${escapeHtml(act.priority)}
              </span>
              <span class="text-xs font-bold text-white">${escapeHtml(act.title)}</span>
            </div>
            <p class="text-xs text-slate-400">${escapeHtml(act.impact)}</p>
          </div>
          <button
            onclick="${actionClick}"
            class="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 shrink-0"
          >
            ▶ Execute Action
          </button>
        </div>
      `;
    })
    .join("");

  // Comments & DM Funnel List
  const allComments = [];
  for (const p of profileSnapshot?.recentPosts || []) {
    for (const c of p.topComments || []) {
      allComments.push({ postHook: p.hookText, ...c });
    }
  }
  document.getElementById("commentsListContainer").innerHTML = allComments
    .map(
      (c) => `
      <div class="p-3 rounded-xl bg-slate-900/75 border border-slate-800 text-xs space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-bold text-white">${escapeHtml(c.user)}</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] uppercase bg-slate-800 text-slate-300">${escapeHtml(c.platform)}</span>
            <span class="text-slate-400">commented:</span>
            <span class="font-bold text-amber-300">"${escapeHtml(c.text)}"</span>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${
            c.replied
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
          }">
            ${c.replied ? "✓ Replied + DM Sent" : "⏳ Pending Action"}
          </span>
        </div>
        ${
          c.privateDmText
            ? `<div class="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-[11px] text-emerald-200">
                 <strong>Auto-DM Sent:</strong> ${escapeHtml(c.privateDmText)}
               </div>`
            : ""
        }
      </div>
    `
    )
    .join("");

  // Active Reel in Studio
  if (contentQueue && contentQueue.length > 0) {
    if (!activeReel || !contentQueue.find((r) => r.id === activeReel.id)) {
      activeReel = contentQueue[0];
    } else {
      activeReel = contentQueue.find((r) => r.id === activeReel.id);
    }
    renderActiveReelStudio();
  }

  // Queue list
  document.getElementById("reelQueueList").innerHTML = (contentQueue || [])
    .map((item) => {
      const selected = activeReel && activeReel.id === item.id;
      return `
        <div
          onclick="selectReelFromQueue('${escapeHtml(item.id)}')"
          class="p-2.5 rounded-lg cursor-pointer flex items-center justify-between text-xs border transition ${
            selected
              ? "bg-cyan-950/50 border-cyan-500/50 text-white"
              : "bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/70"
          }"
        >
          <div class="truncate pr-2">
            <span class="font-bold">${escapeHtml(item.hookText || item.title)}</span>
            <span class="text-[10px] text-slate-400 ml-2">(${escapeHtml(item.visualStyle)})</span>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded ${
            item.status === "PUBLISHED"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-cyan-500/20 text-cyan-300"
          }">${escapeHtml(item.status)}</span>
        </div>
      `;
    })
    .join("");

  renderMemoryVault(appState.memoryStore);
}

function renderActiveReelStudio() {
  if (!activeReel) return;
  document.getElementById("activeReelTitle").textContent = activeReel.hookText || activeReel.title;
  document.getElementById("activeReelStatus").textContent = activeReel.status;

  const videoEl = document.getElementById("reelVideoPlayer");
  if (videoEl.getAttribute("data-src") !== activeReel.videoUrl) {
    videoEl.src = activeReel.videoUrl;
    videoEl.setAttribute("data-src", activeReel.videoUrl);
    videoEl.load();
    videoEl.play().catch(() => {});
  }

  const dlLink = document.getElementById("downloadMp4Link");
  dlLink.href = activeReel.videoUrl;
  dlLink.setAttribute("download", `${activeReel.id}.mp4`);

  document.getElementById("carouselGrid").innerHTML = (activeReel.carouselUrls || [])
    .map(
      (url, idx) => `
      <a href="${escapeHtml(url)}" target="_blank" class="block rounded-xl overflow-hidden border border-slate-700 bg-slate-950 hover:border-cyan-400 transition">
        <img src="${escapeHtml(url)}" alt="Slide ${idx + 1}" class="w-full h-auto object-cover" />
      </a>
    `
    )
    .join("");

  document.getElementById("remotionCodeBox").textContent = activeReel.remotionCode || "";
  document.getElementById("voiceoverTextBox").textContent = activeReel.voiceoverFull || "";
  document.getElementById("captionTextBox").textContent = activeReel.caption || "";
}

function renderMemoryVault(memoryStore) {
  if (!memoryStore) return;
  document.getElementById("memorySessionBadge").textContent =
    `Session: ${memoryStore.velonaMemorySessionId || "mem_marketing_team_agent"}`;

  const docs = memoryStore.knowledgeDocs || [];
  const episodes = memoryStore.episodicPostsMemory || [];
  document.getElementById("kbCountLabel").textContent = docs.length;
  document.getElementById("episodicCountLabel").textContent = episodes.length;

  document.getElementById("knowledgeDocsList").innerHTML = docs
    .map(
      (doc) => `
      <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 truncate">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              ${escapeHtml(doc.category)}
            </span>
            <span class="font-bold text-white truncate">${escapeHtml(doc.title)}</span>
          </div>
          <button
            onclick="deleteKnowledgeDoc('${escapeHtml(doc.id)}')"
            class="text-slate-500 hover:text-rose-400 text-xs font-bold px-1"
            title="Remove from RAG"
          >
            &times;
          </button>
        </div>
        <p class="text-[11px] text-slate-300 leading-relaxed line-clamp-3">${escapeHtml(doc.content)}</p>
      </div>
    `
    )
    .join("");

  document.getElementById("episodicMemoryList").innerHTML = episodes
    .map(
      (ep) => `
      <div class="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
        <div class="flex items-center justify-between gap-2">
          <span class="font-bold text-white truncate">${escapeHtml(ep.hookText)}</span>
          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${
            ep.outcome === "AVOID_FORMAT"
              ? "bg-rose-500/20 text-rose-300"
              : "bg-emerald-500/20 text-emerald-300"
          }">
            ${escapeHtml(ep.outcome)}
          </span>
        </div>
        <div class="text-[11px] text-slate-400 flex items-center justify-between">
          <span>Style: <code>${escapeHtml(ep.visualStyle)}</code></span>
          <span>${ep.saveRate ? `${ep.saveRate}% Saves` : "Indexed in Memory"}</span>
        </div>
      </div>
    `
    )
    .join("");
}

function selectReelFromQueue(id) {
  const found = (appState?.contentQueue || []).find((r) => r.id === id);
  if (found) {
    activeReel = found;
    renderDashboard();
  }
}

function switchStudioTab(tab) {
  activeStudioTab = tab;
  ["video", "carousel", "code", "caption"].forEach((t) => {
    const panel = document.getElementById(`studioTab_${t}`);
    if (panel) panel.classList.toggle("hidden", t !== tab);
  });
  renderDynamicShell();
}

function speakActiveVoiceover() {
  if (!activeReel) return;
  const videoEl = document.getElementById("reelVideoPlayer");
  videoEl.currentTime = 0;
  videoEl.muted = false;
  videoEl.play().catch(() => {});

  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(activeReel.voiceoverFull);
    utter.rate = 1.06;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
  }
}

async function analyzeProfileNow() {
  const btn = document.getElementById("btnAnalyze");
  btn.disabled = true;
  btn.textContent = "⏳ Auditing Profile...";
  showToast("Analyzing connected Facebook Page & Linked Instagram profile metrics + comments...");
  try {
    await fetch("/api/analyze", { method: "POST" });
    await fetchState();
    showToast("✅ Profile audit complete! Updated winning patterns & autonomous action queue.");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔍 Re-Analyze Profile Content";
  }
}

async function generateNewCodeReel() {
  const btn = document.getElementById("btnGenerateReel");
  const customTopic = document.getElementById("customTopicInput").value;
  const preferredStyle = document.getElementById("videoStyleSelect").value;
  const ttsVoice = document.getElementById("ttsVoiceSelect")?.value || "";
  btn.disabled = true;
  btn.textContent = "⚙️ Rendering 9:16 MP4 in Code...";
  showToast(`Writing hook, script, Remotion .tsx code & rendering 9:16 MP4 Reel (${ttsVoice || "default voice"})...`);
  try {
    const res = await fetch("/api/generate-reel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customTopic, preferredStyle, ttsVoice })
    });
    const data = await res.json();
    if (data.ok && data.reelItem) {
      activeReel = data.reelItem;
      await fetchState();
      switchStudioTab("video");
      showToast(`🎬 Rendered new Code-to-Video Reel: "${data.reelItem.hookText}"!`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "🎬 Write Code & Render 9:16 MP4";
  }
}

async function runFullAutopilot() {
  const btn = document.getElementById("btnAutopilot");
  const customTopic = document.getElementById("customTopicInput").value;
  const preferredStyle = document.getElementById("videoStyleSelect").value;
  const ttsVoice = document.getElementById("ttsVoiceSelect")?.value || "";
  btn.disabled = true;
  btn.textContent = "⏳ Running Full Autopilot...";
  showToast("Executing Full Autopilot: 1) Profile Audit ➔ 2) Auto-Reply & DM Leads ➔ 3) Render Code-to-Video MP4 ➔ 4) Auto-Publish IG + FB...");
  try {
    const res = await fetch("/api/run-autopilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customTopic, preferredStyle, ttsVoice, forcePublish: true })
    });
    const data = await res.json();
    if (data.ok && data.reelItem) {
      activeReel = data.reelItem;
      await fetchState();
      showToast(`🚀 Autopilot cycle complete! Replied/DMed ${data.dmProcessedCount} commenters & published "${data.reelItem.hookText}" to IG + FB!`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Run Full Autopilot Loop Now";
  }
}

async function publishActiveReel() {
  if (!activeReel) return;
  const btn = document.getElementById("btnPublishActive");
  btn.disabled = true;
  btn.textContent = "⏳ Publishing...";
  showToast("Publishing 9:16 MP4 Reel & Carousel to Linked Instagram + Facebook Page via Meta Graph API...");
  try {
    const res = await fetch(`/api/publish/${activeReel.id}`, { method: "POST" });
    const data = await res.json();
    if (data.ok) {
      await fetchState();
      showToast(`📲 Published "${activeReel.hookText}" to Instagram Reels & Facebook Page!`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📲 Publish to IG + FB Now";
  }
}

async function processAllComments() {
  showToast("Sending public replies + Private DM monetization links to pending commenters...");
  const res = await fetch("/api/process-comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await res.json();
  if (data.ok) {
    await fetchState();
    showToast(`💸 Replied & sent Private DM offer links to ${data.dmResult.processedCount} leads!`);
  }
}

async function simulateAndProcessComment() {
  const user = document.getElementById("simCommentUser").value || "@new_viewer";
  const text = document.getElementById("simCommentText").value || "AUTO";
  showToast(`Simulating comment from ${user} ("${text}") & triggering Auto-Reply + Private DM...`);
  const res = await fetch("/api/process-comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      simulateComment: { user, text, platform: "instagram" }
    })
  });
  const data = await res.json();
  if (data.ok) {
    await fetchState();
    showToast(`⚡ Agent replied to ${user} & DMed the monetization link (${appState.settings.monetizationUrl})!`);
  }
}

async function runRagTestQuery() {
  const query = document.getElementById("ragQueryInput").value.trim();
  if (!query) return;
  const res = await fetch("/api/memory/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const data = await res.json();
  if (!data.ok) return;

  const { ragResult } = data;
  const box = document.getElementById("ragQueryResultBox");
  box.classList.remove("hidden");

  const topDocsHtml = (ragResult.matchedKnowledgeDocs || [])
    .slice(0, 2)
    .map(
      (d) =>
        `<div class="text-slate-300">• <strong>${escapeHtml(d.title)}</strong> <span class="text-indigo-400 mono">(score: ${d.similarityScore})</span> — ${escapeHtml(d.content.slice(0, 120))}...</div>`
    )
    .join("");

  const dedup = ragResult.dedupCheck || {};
  const dedupBadge = dedup.isNearDuplicate
    ? `<span class="text-rose-400 font-bold">⚠️ Near-Duplicate Detected (overlap ${dedup.maxOverlapScore} with "${escapeHtml(dedup.closestPastHook)}") — Agent will rewrite hook!</span>`
    : `<span class="text-emerald-400 font-bold">✓ Anti-Duplicate Guard Passed (max overlap ${dedup.maxOverlapScore} vs past Reels)</span>`;

  box.innerHTML = `
    <div class="font-bold text-indigo-300">Retrieved RAG Context Injected into Prompt:</div>
    ${topDocsHtml}
    <div class="pt-1 border-t border-slate-800">${dedupBadge}</div>
  `;
}

async function addNewKnowledgeDoc() {
  const title = document.getElementById("kbTitleInput").value.trim() || "Custom Brand / Offer Note";
  const category = document.getElementById("kbCategoryInput").value;
  const content = document.getElementById("kbContentInput").value.trim();
  if (!content) {
    showToast("⚠️ Please enter knowledge content to add to RAG memory.");
    return;
  }

  const res = await fetch("/api/memory/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, category, content })
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById("kbTitleInput").value = "";
    document.getElementById("kbContentInput").value = "";
    appState.memoryStore = data.memoryStore;
    renderMemoryVault(data.memoryStore);
    showToast(`🧠 Added "${title}" to RAG Knowledge Base! The agent will use this in every future Reel.`);
  }
}

async function deleteKnowledgeDoc(id) {
  const res = await fetch(`/api/memory/knowledge/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (data.ok) {
    appState.memoryStore = data.memoryStore;
    renderMemoryVault(data.memoryStore);
    showToast("🗑️ Removed document from RAG Knowledge Base.");
  }
}

function toggleSettingsModal(show) {
  if (show) renderSchemaSettingsForm();
  document.getElementById("settingsModal").classList.toggle("hidden", !show);
}

async function saveSettings() {
  const payload = {};
  const inputs = document.querySelectorAll("#dynamicSettingsForm [data-setting-key]");

  inputs.forEach((el) => {
    const key = el.getAttribute("data-setting-key");
    const type = el.getAttribute("data-setting-type");
    if (type === "checkbox") {
      payload[key] = Boolean(el.checked);
    } else if (type === "password") {
      const val = el.value.trim();
      payload[key] = val ? val : "__KEEP__";
    } else {
      payload[key] = el.value.trim();
    }
  });

  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.ok) {
    toggleSettingsModal(false);
    await fetchState();
    showToast("✅ Settings saved to .env & accounts synced!");
  }
}

function copyRemotionCode() {
  if (!activeReel?.remotionCode) return;
  navigator.clipboard.writeText(activeReel.remotionCode);
  showToast("📋 Copied Remotion .tsx component code to clipboard!");
}

window.addEventListener("DOMContentLoaded", initApp);
