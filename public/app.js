/**
 * Schema-Driven Frontend Application — Monochrome Edition
 * Dynamically renders all controls, KPI cards, studio tabs, scene inspector,
 * and settings form from GET /api/config and GET /api/state.
 */

let appState = null;
let uiConfig = null;
let activeReelIndex = 0;
let activeStudioTab = "video";

function showToast(msg, isError = false) {
  const toast = document.getElementById("statusToast");
  const text = document.getElementById("statusToastText");
  if (!toast || !text) return;
  toast.classList.remove("hidden", "border-white", "border-zinc-500");
  toast.classList.add(isError ? "border-zinc-500" : "border-white");
  text.textContent = msg;
}

async function fetchConfigAndState() {
  try {
    const [cfgRes, stateRes] = await Promise.all([
      fetch("/api/config"),
      fetch("/api/state")
    ]);
    const cfgJson = await cfgRes.json();
    const stateJson = await stateRes.json();

    if (cfgJson.ok) {
      uiConfig = cfgJson;
      renderDynamicConfigControls();
    }
    if (stateJson.ok) {
      appState = stateJson;
      renderAll();
    }
  } catch (err) {
    showToast("Failed to load config/state: " + err.message, true);
  }
}

function renderDynamicConfigControls() {
  if (!uiConfig) return;

  // 1. Header Metadata
  const titleEl = document.getElementById("appTitle");
  const subEl = document.getElementById("appSubtitle");
  const badgeEl = document.getElementById("appBadge");
  if (titleEl && uiConfig.appMeta) titleEl.textContent = uiConfig.appMeta.title;
  if (subEl && uiConfig.appMeta) subEl.textContent = uiConfig.appMeta.subtitle;
  if (badgeEl && uiConfig.appMeta) badgeEl.textContent = uiConfig.appMeta.badge;

  // 2. Video Styles Select
  const styleSelect = document.getElementById("videoStyleSelect");
  if (styleSelect && Array.isArray(uiConfig.videoStyles)) {
    const currentVal =
      styleSelect.value ||
      appState?.settings?.preferredVideoStyle ||
      uiConfig.videoStyles[0]?.id;
    styleSelect.innerHTML = uiConfig.videoStyles
      .map((s) => `<option value="${s.id}">${s.name}</option>`)
      .join("");
    if (currentVal) styleSelect.value = currentVal;
  }

  // 3. TTS Voices Select + Status Badge
  const voiceSelect = document.getElementById("ttsVoiceSelect");
  const ttsBadge = document.getElementById("ttsStatusBadge");
  if (voiceSelect && Array.isArray(uiConfig.voices)) {
    const selectedVoice =
      voiceSelect.value ||
      appState?.settings?.ttsVoice ||
      uiConfig.currentVoice ||
      "en-US-ChristopherNeural";
    voiceSelect.innerHTML = uiConfig.voices
      .map(
        (v) =>
          `<option value="${v.id}" ${v.id === selectedVoice ? "selected" : ""}>${v.label}</option>`
      )
      .join("");
  }
  if (ttsBadge) {
    ttsBadge.textContent = uiConfig.ttsAvailable ? "[EDGE TTS READY]" : "[SYNTH AUDIO]";
    ttsBadge.className = "text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700 mono";
  }

  // 4. Knowledge Base Categories Select
  const kbCatSelect = document.getElementById("kbCategoryInput");
  if (kbCatSelect && Array.isArray(uiConfig.kbCategories)) {
    kbCatSelect.innerHTML = uiConfig.kbCategories
      .map((c) => `<option value="${c.id}">${c.label}</option>`)
      .join("");
  }

  // 5. Studio Tabs Bar
  const tabsBar = document.getElementById("studioTabsBar");
  if (tabsBar && Array.isArray(uiConfig.studioTabs)) {
    tabsBar.innerHTML = uiConfig.studioTabs
      .map((t) => {
        const isActive = t.id === activeStudioTab;
        return `<button
          onclick="switchStudioTab('${t.id}')"
          id="tabBtn_${t.id}"
          class="px-3 py-2 border-b-2 transition ${
            isActive
              ? "border-white text-white font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-200"
          }"
        >${t.label}</button>`;
      })
      .join("");
  }

  // 6. Dynamic Settings Form
  renderSchemaDrivenSettingsForm();
}

function renderSchemaDrivenSettingsForm() {
  const container = document.getElementById("dynamicSettingsForm");
  if (!container || !uiConfig?.settingsSchema) return;

  const settings = appState?.settings || {};

  container.innerHTML = uiConfig.settingsSchema
    .map((section) => {
      const fieldsHtml = section.fields
        .map((field) => {
          const currentVal =
            settings[field.key] !== undefined ? settings[field.key] : field.value;

          if (field.type === "checkbox") {
            return `
              <label class="flex items-center gap-2.5 p-2.5 rounded bg-black border border-zinc-800 cursor-pointer">
                <input
                  type="checkbox"
                  id="cfg_${field.key}"
                  data-schema-key="${field.key}"
                  class="rounded accent-white"
                  ${currentVal ? "checked" : ""}
                />
                <span class="text-xs text-zinc-200 font-medium">${field.label}</span>
                <span class="ml-auto text-[10px] text-zinc-500 mono">${field.envVar || ""}</span>
              </label>
            `;
          }

          if (field.type === "select") {
            const opts = (field.options || [])
              .map(
                (o) =>
                  `<option value="${o.id}" ${
                    String(currentVal) === String(o.id) ? "selected" : ""
                  }>${o.label}</option>`
              )
              .join("");
            return `
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-xs font-semibold text-zinc-300">${field.label}</label>
                  <span class="text-[10px] text-zinc-500 mono">${field.envVar || ""}</span>
                </div>
                <select
                  id="cfg_${field.key}"
                  data-schema-key="${field.key}"
                  class="w-full px-3 py-2 rounded mono-input text-xs mono"
                >${opts}</select>
              </div>
            `;
          }

          if (field.type === "model_select_or_custom") {
            const opts = (field.options || [])
              .map(
                (o) =>
                  `<option value="${o.id}" ${
                    String(currentVal) === String(o.id) ? "selected" : ""
                  }>${o.label}</option>`
              )
              .join("");
            return `
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-semibold text-zinc-300">${field.label}</label>
                  <span class="text-[10px] text-zinc-500 mono">${field.envVar || ""}</span>
                </div>
                <select
                  id="cfg_${field.key}_preset"
                  onchange="document.getElementById('cfg_${field.key}').value = this.value"
                  class="w-full px-3 py-2 rounded mono-input text-xs mono"
                >
                  <option value="">-- Choose Verified Catalog Model --</option>
                  ${opts}
                </select>
                <input
                  id="cfg_${field.key}"
                  data-schema-key="${field.key}"
                  type="text"
                  value="${escapeHtml(String(currentVal || ""))}"
                  placeholder="${escapeHtml(field.placeholder || "")}"
                  class="w-full px-3 py-2 rounded mono-input text-xs mono"
                />
              </div>
            `;
          }

          return `
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="text-xs font-semibold text-zinc-300">${field.label}</label>
                <span class="text-[10px] text-zinc-500 mono">${field.envVar || ""}</span>
              </div>
              <input
                id="cfg_${field.key}"
                data-schema-key="${field.key}"
                type="${field.type || "text"}"
                value="${escapeHtml(String(currentVal || ""))}"
                placeholder="${escapeHtml(field.placeholder || "")}"
                class="w-full px-3 py-2 rounded mono-input text-xs mono"
              />
            </div>
          `;
        })
        .join("");

      return `
        <div class="p-4 rounded-lg bg-zinc-950 border border-zinc-800 space-y-3">
          <div>
            <div class="text-xs font-bold text-white mono">${section.title}</div>
            <div class="text-[11px] text-zinc-400">${section.subtitle || ""}</div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${fieldsHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderKpiCards() {
  const kpiGrid = document.getElementById("kpiGrid");
  if (!kpiGrid || !uiConfig?.kpiSchema || !appState) return;

  const velona = appState.velonaStatus || {};
  const meta = appState.metaConnection || {};
  const report = appState.analysisReport || {};
  const mem = appState.memoryStore?.stats || {};
  const settings = appState.settings || {};

  const kpiValues = {
    llmEngineTitle: settings.llmModel || "deepseek/deepseek-v4-flash",
    llmEngineSubtitle: velona.message || `Base URL: ${settings.velonaBaseUrl || "env"}`,
    llmEngineBadge: velona.connected ? "ONLINE" : "LOCAL / ENV",

    metaStatusTitle: meta.instagram?.username
      ? `@${meta.instagram.username}`
      : settings.profileHandle || "@ai.wealth.builder",
    metaStatusSubtitle: meta.pageName
      ? `Linked via FB Page: ${meta.pageName}`
      : "Single FB Token -> Linked IG Auto-Discovery",
    metaStatusBadge: meta.connected ? "GRAPH LIVE" : "SANDBOX",

    saveRateTitle: `${report.profileMetricsSummary?.avgSaveRate || "4.91"}% SAVES`,
    saveRateSubtitle: `${(report.profileMetricsSummary?.totalViews || 118100).toLocaleString()} views • ${
      report.profileMetricsSummary?.totalLeads || 759
    } DM leads`,
    saveRateBadge: `${report.profileMetricsSummary?.totalPostsAnalyzed || 3} AUDITED`,

    ragMemoryTitle: `${mem.totalKnowledgeDocs || 0} KB // ${mem.totalRememberedReels || 0} REELS`,
    ragMemorySubtitle: `${mem.totalContactedUsers || 0} leads remembered in DM ledger`,
    ragMemoryBadge: "RAG ACTIVE"
  };

  kpiGrid.innerHTML = uiConfig.kpiSchema
    .map((k) => {
      return `
        <div class="mono-card rounded-xl p-4 space-y-1.5">
          <div class="flex items-center justify-between text-[10px] text-zinc-400 mono">
            <span>${k.label}</span>
            <span class="px-1.5 py-0.5 rounded bg-zinc-900 text-white border border-zinc-700 font-bold">
              ${escapeHtml(kpiValues[k.badgeKey] || "")}
            </span>
          </div>
          <div class="text-sm font-extrabold text-white truncate mono">
            ${escapeHtml(kpiValues[k.valueKey] || "")}
          </div>
          <div class="text-[11px] text-zinc-400 truncate">
            ${escapeHtml(kpiValues[k.subKey] || "")}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderAll() {
  if (!appState) return;
  renderKpiCards();
  renderProfileAnalysis();
  renderActionsQueue();
  renderCommentsFunnel();
  renderMemoryRagVault();
  renderCodeVideoStudio();
  renderSchemaDrivenSettingsForm();
}

function renderProfileAnalysis() {
  const report = appState.analysisReport || {};
  const posts = appState.profileSnapshot?.recentPosts || appState.profileSnapshot?.posts || [];

  const diagEl = document.getElementById("diagnosisSummary");
  const srcEl = document.getElementById("analysisSourceLabel");
  if (diagEl) {
    diagEl.textContent =
      report.summaryDiagnosis ||
      report.diagnosisSummary ||
      "Code-to-Video motion Reels outperform static image slideshows by 14.2x in views and saves.";
  }
  if (srcEl) {
    srcEl.textContent = `${report.llmSource || "AUDIT ENGINE"} • ${new Date(
      report.analyzedAt || Date.now()
    ).toLocaleTimeString()}`;
  }

  const winList = document.getElementById("winningPatternsList");
  if (winList) {
    const wins = report.winningPatterns || [
      "30fps Monochrome Code-to-Video Reels drive 4.91% save rate",
      "Comment-to-DM trigger keyword funnels convert 71% of inquiries"
    ];
    winList.innerHTML = wins.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
  }

  const dropList = document.getElementById("dropPatternsList");
  if (dropList) {
    const drops = report.dropImmediately || report.dropPatterns || [
      "Stop posting static AI image slideshows (low retention)",
      "Never leave high-intent pricing/link comments unanswered"
    ];
    dropList.innerHTML = drops.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
  }

  const postsContainer = document.getElementById("recentPostsContainer");
  if (postsContainer) {
    postsContainer.innerHTML = posts
      .map((p) => {
        const views = p.metrics?.views ?? p.views ?? 0;
        const likes = p.metrics?.likes ?? p.likes ?? 0;
        const saves = p.metrics?.saves ?? p.saves ?? 0;
        const commentsCount = p.metrics?.comments ?? p.topComments?.length ?? 0;
        const savesPct = views ? ((saves / views) * 100).toFixed(2) : "0.00";
        const isSlideshow = (p.visualStyle || "").includes("slideshow");
        const badgeLabel = isSlideshow
          ? "STATIC SLIDESHOW"
          : `CODE REEL // ${(p.visualStyle || "MONOCHROME").toUpperCase()}`;
        return `
          <div class="p-3 rounded-lg mono-subcard flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="space-y-1 max-w-lg">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold mono ${
                  !isSlideshow
                    ? "bg-white text-black"
                    : "bg-zinc-900 text-zinc-400 border border-zinc-800"
                }">${escapeHtml(badgeLabel)}</span>
                <span class="font-bold text-white truncate">${escapeHtml(
                  p.hookText || p.caption?.split("\n")[0] || p.id
                )}</span>
              </div>
              <div class="text-[11px] text-zinc-500 mono">
                VIEWS: ${views.toLocaleString()} • LIKES: ${likes.toLocaleString()} • SAVES: ${saves.toLocaleString()} (${savesPct}%) • COMMENTS: ${commentsCount}
              </div>
            </div>
            <span class="text-[10px] font-bold mono px-2 py-1 rounded border ${
              !isSlideshow
                ? "border-zinc-600 text-white bg-zinc-900"
                : "border-zinc-800 text-zinc-500 bg-black"
            }">
              ${!isSlideshow ? "[WINNING FORMAT]" : "[UNDERPERFORMING]"}
            </span>
          </div>
        `;
      })
      .join("");
  }
}

function renderActionsQueue() {
  const container = document.getElementById("actionsQueueContainer");
  if (!container) return;
  const actions =
    appState.analysisReport?.autonomousActionsQueue ||
    appState.analysisReport?.autonomousActionQueue ||
    [];

  if (actions.length === 0) {
    container.innerHTML = `<div class="text-xs text-zinc-500 mono">No pending actions. Click Re-Analyze Profile.</div>`;
    return;
  }

  container.innerHTML = actions
    .map((act) => {
      const isDm = act.type === "AUTO_REPLY_AND_DM";
      const isPublish = act.type === "AUTO_PUBLISH_IG_FB";
      const btnAction = isDm
        ? "processAllComments()"
        : isPublish
        ? "publishActiveReel()"
        : `generateNewCodeReel(${JSON.stringify(
            appState.analysisReport?.recommendedNextReel?.title || ""
          )})`;
      const btnLabel = isDm
        ? "EXECUTE DMS ->"
        : isPublish
        ? "PUBLISH IG+FB ->"
        : "COMPILE REEL ->";

      return `
        <div class="p-3 rounded-lg mono-subcard flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="space-y-1 flex-1">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-900 text-white border border-zinc-700 mono">${escapeHtml(
                act.priority || "HIGH"
              )}</span>
              <span class="font-bold text-white">${escapeHtml(act.title)}</span>
            </div>
            <p class="text-[11px] text-zinc-400 mono">${escapeHtml(
              act.impact || act.reason || ""
            )}</p>
          </div>
          <button
            onclick='${btnAction}'
            class="btn-secondary px-3 py-1.5 rounded text-xs mono whitespace-nowrap"
          >
            ${btnLabel}
          </button>
        </div>
      `;
    })
    .join("");
}

function renderCommentsFunnel() {
  const container = document.getElementById("commentsListContainer");
  if (!container) return;

  const posts = appState.profileSnapshot?.recentPosts || appState.profileSnapshot?.posts || [];
  const allComments = [];
  posts.forEach((p) => {
    (p.topComments || p.comments || []).forEach((c) => {
      allComments.push({ ...c, postId: p.id });
    });
  });

  if (allComments.length === 0) {
    container.innerHTML = `<div class="text-xs text-zinc-500 mono">No comments found.</div>`;
    return;
  }

  container.innerHTML = allComments
    .map((c) => {
      const replied = Boolean(c.replied || c.dmSent);
      const handle = c.user || c.username || "@viewer";
      const replyMsg = c.publicReplyText || c.replyText || "";
      const dmMsg = c.privateDmText || c.dmSentText || "";
      return `
        <div class="p-3 rounded-lg mono-subcard flex items-start justify-between gap-3 text-xs">
          <div class="space-y-1 w-full">
            <div class="flex items-center justify-between gap-2 mono">
              <span class="font-bold text-white">${escapeHtml(handle)} <span class="text-zinc-500 text-[10px]">(${escapeHtml(
        c.platform || "instagram"
      )})</span></span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                replied
                  ? "bg-white text-black"
                  : "bg-zinc-900 text-zinc-400 border border-zinc-700"
              }">
                ${replied ? "REPLIED + DM SENT" : "PENDING LEAD"}
              </span>
            </div>
            <p class="text-zinc-200">"${escapeHtml(c.text)}"</p>
            ${
              replyMsg
                ? `<div class="text-[11px] text-zinc-400 mono">↳ PUBLIC REPLY: ${escapeHtml(
                    replyMsg
                  )}</div>`
                : ""
            }
            ${
              dmMsg
                ? `<div class="text-[11px] text-zinc-300 mono">↳ PRIVATE DM: ${escapeHtml(
                    dmMsg.split("\n")[0]
                  )}</div>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
}

function renderMemoryRagVault() {
  const mem = appState.memoryStore || {};
  const docs = mem.knowledgeBase || [];
  const episodes = mem.episodicPostMemory || [];

  const sessionBadge = document.getElementById("memorySessionBadge");
  if (sessionBadge) {
    sessionBadge.textContent = `SESSION: ${
      mem.velonaMemorySessionId || "mem_marketing_team_agent"
    }`;
  }

  const kbCount = document.getElementById("kbCountLabel");
  if (kbCount) kbCount.textContent = docs.length;

  const epCount = document.getElementById("episodicCountLabel");
  if (epCount) epCount.textContent = episodes.length;

  const kbList = document.getElementById("knowledgeDocsList");
  if (kbList) {
    kbList.innerHTML = docs
      .map(
        (d) => `
        <div class="p-2.5 rounded-lg mono-subcard text-xs space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-white truncate">${escapeHtml(d.title)}</span>
            <button
              onclick="deleteKnowledgeDoc('${d.id}')"
              class="text-[10px] text-zinc-500 hover:text-white mono"
            >DELETE</button>
          </div>
          <p class="text-[11px] text-zinc-400 line-clamp-2">${escapeHtml(d.content)}</p>
        </div>
      `
      )
      .join("");
  }

  const epList = document.getElementById("episodicMemoryList");
  if (epList) {
    epList.innerHTML = episodes
      .map(
        (e) => `
        <div class="p-2.5 rounded-lg mono-subcard text-xs space-y-1">
          <div class="flex items-center justify-between">
            <span class="font-bold text-white truncate">${escapeHtml(
              e.hookText || e.title
            )}</span>
            <span class="text-[10px] text-zinc-400 mono">${e.saveRate || "4.9%"}</span>
          </div>
          <div class="text-[11px] text-zinc-500 mono">STYLE: ${escapeHtml(
            e.visualStyle || "fireship_code"
          )}</div>
        </div>
      `
      )
      .join("");
  }
}

function renderCodeVideoStudio() {
  const queue = appState.contentQueue || [];
  if (queue.length === 0) return;

  if (activeReelIndex >= queue.length) activeReelIndex = 0;
  const active = queue[activeReelIndex];

  const titleEl = document.getElementById("activeReelTitle");
  const statusEl = document.getElementById("activeReelStatus");
  if (titleEl) titleEl.textContent = active.title || active.hookText;
  if (statusEl) statusEl.textContent = active.status || "READY";

  const videoEl = document.getElementById("reelVideoPlayer");
  if (videoEl && active.videoUrl) {
    const targetSrc = `${active.videoUrl}?t=${encodeURIComponent(active.createdAt || "")}`;
    if (videoEl.getAttribute("data-src") !== targetSrc) {
      videoEl.setAttribute("data-src", targetSrc);
      videoEl.src = targetSrc;
      videoEl.load();
    }
  }

  // Render 4-Stage Scene Inspector cards so user can inspect and seek to each scene
  const inspectorGrid = document.getElementById("sceneInspectorGrid");
  if (inspectorGrid && Array.isArray(active.scenes)) {
    inspectorGrid.innerHTML = active.scenes
      .map((s, idx) => {
        const startSec = idx * 3;
        return `
          <button
            onclick="seekVideoToScene(${startSec})"
            class="text-left p-2 rounded bg-black hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-500 transition space-y-0.5"
          >
            <div class="flex items-center justify-between text-[10px] text-zinc-400 mono">
              <span>${escapeHtml(s.badge || `0${idx + 1} // STAGE`)}</span>
              <span>0:0${startSec}s</span>
            </div>
            <div class="text-[11px] font-bold text-white truncate">${escapeHtml(
              s.headline || ""
            )}</div>
            <div class="text-[10px] text-zinc-500 mono truncate">${escapeHtml(
              `${s.metricLabel || "METRIC"}: ${s.metricValue || ""}`
            )}</div>
          </button>
        `;
      })
      .join("");
  }

  const dlLink = document.getElementById("downloadMp4Link");
  if (dlLink && active.videoUrl) {
    dlLink.href = active.videoUrl;
  }

  const carouselGrid = document.getElementById("carouselGrid");
  if (carouselGrid) {
    carouselGrid.innerHTML = (active.carouselUrls || [])
      .map(
        (url, idx) => `
        <a href="${url}" target="_blank" class="block rounded-lg overflow-hidden border border-zinc-800 bg-black">
          <img src="${url}" alt="Slide ${idx + 1}" class="w-full h-auto object-cover" />
        </a>
      `
      )
      .join("");
  }

  const codeBox = document.getElementById("remotionCodeBox");
  if (codeBox) codeBox.textContent = active.remotionCode || "";

  const voBox = document.getElementById("voiceoverTextBox");
  if (voBox) voBox.textContent = active.voiceoverFull || "";

  const capBox = document.getElementById("captionTextBox");
  if (capBox) capBox.textContent = active.caption || "";

  const queueList = document.getElementById("reelQueueList");
  if (queueList) {
    queueList.innerHTML = queue
      .map(
        (item, idx) => `
        <button
          onclick="selectReelFromQueue(${idx})"
          class="w-full text-left p-2.5 rounded-lg text-xs flex items-center justify-between border transition mono ${
            idx === activeReelIndex
              ? "bg-white text-black border-white font-bold"
              : "bg-black border-zinc-800 text-zinc-300 hover:border-zinc-600"
          }"
        >
          <span class="truncate max-w-[230px]">${escapeHtml(
            item.title || item.hookText
          )}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded ${
            idx === activeReelIndex ? "bg-black text-white" : "bg-zinc-900 text-zinc-400"
          }">${item.status}</span>
        </button>
      `
      )
      .join("");
  }
}

function seekVideoToScene(seconds) {
  const videoEl = document.getElementById("reelVideoPlayer");
  if (!videoEl) return;
  videoEl.currentTime = seconds;
  videoEl.play().catch(() => {});
}

function selectReelFromQueue(idx) {
  activeReelIndex = idx;
  renderCodeVideoStudio();
}

function switchStudioTab(tabId) {
  activeStudioTab = tabId;
  if (uiConfig?.studioTabs) {
    uiConfig.studioTabs.forEach((t) => {
      const panel = document.getElementById(`studioTab_${t.id}`);
      if (panel) {
        panel.classList.toggle("hidden", t.id !== tabId);
      }
    });
  }
  renderDynamicConfigControls();
}

async function analyzeProfileNow() {
  const btn = document.getElementById("btnAnalyze");
  if (btn) btn.textContent = "ANALYZING...";
  try {
    const res = await fetch("/api/analyze", { method: "POST" });
    const json = await res.json();
    if (json.ok) {
      await fetchConfigAndState();
      showToast("Profile content audited and autonomous actions updated.");
    }
  } catch (err) {
    showToast("Analysis error: " + err.message, true);
  } finally {
    if (btn) btn.textContent = "RE-ANALYZE PROFILE ->";
  }
}

async function generateNewCodeReel(overrideTopic = "") {
  const btn = document.getElementById("btnGenerateReel");
  const topicInput = document.getElementById("customTopicInput");
  const styleSelect = document.getElementById("videoStyleSelect");
  const voiceSelect = document.getElementById("ttsVoiceSelect");

  const customTopic = overrideTopic || (topicInput ? topicInput.value.trim() : "");
  const preferredStyle = styleSelect ? styleSelect.value : "fireship_code";
  const ttsVoice = voiceSelect ? voiceSelect.value : "";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "COMPILING 30FPS MONOCHROME MP4...";
  }
  showToast("Compiling 4-stage monochrome motion graphics + voiceover into 9:16 MP4...");

  try {
    const res = await fetch("/api/generate-reel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customTopic, preferredStyle, ttsVoice })
    });
    const json = await res.json();
    const createdReel = json.reelItem || json.reel;
    if (json.ok && createdReel) {
      activeReelIndex = 0;
      await fetchConfigAndState();
      switchStudioTab("video");
      showToast(`Rendered 9:16 MP4 Master: "${createdReel.title}"`);
    } else {
      showToast("Render failed: " + (json.error || "Unknown error"), true);
    }
  } catch (err) {
    showToast("Render error: " + err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "COMPILE & RENDER 9:16 MP4 MASTER ->";
    }
  }
}

async function publishActiveReel() {
  const queue = appState?.contentQueue || [];
  const active = queue[activeReelIndex];
  if (!active) return;

  const btn = document.getElementById("btnPublishActive");
  if (btn) btn.textContent = "PUBLISHING...";
  try {
    const res = await fetch(`/api/publish/${encodeURIComponent(active.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const json = await res.json();
    if (json.ok) {
      await fetchConfigAndState();
      showToast("Published 9:16 Reel to Linked Instagram Business & Facebook Page.");
    }
  } catch (err) {
    showToast("Publish failed: " + err.message, true);
  } finally {
    if (btn) btn.textContent = "PUBLISH IG + FB ->";
  }
}

async function processAllComments(simulateComment = null) {
  const btn = document.getElementById("btnProcessComments");
  if (btn) btn.textContent = "SENDING DMS...";
  try {
    const res = await fetch("/api/process-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(simulateComment ? { simulateComment } : {})
    });
    const json = await res.json();
    if (json.ok) {
      await fetchConfigAndState();
      const count = json.dmResult?.processedCount ?? json.repliedCount ?? 1;
      showToast(`Processed ${count} comment leads and dispatched Private DMs.`);
    }
  } catch (err) {
    showToast("Error processing comments: " + err.message, true);
  } finally {
    if (btn) btn.textContent = "PROCESS ALL PENDING LEADS ->";
  }
}

async function simulateAndProcessComment() {
  const userEl = document.getElementById("simCommentUser");
  const textEl = document.getElementById("simCommentText");
  const user = userEl ? userEl.value.trim() : "@viewer";
  const text = textEl ? textEl.value.trim() : "AUTO";

  await processAllComments({ user, text, platform: "instagram" });
}

async function runFullAutopilot() {
  const btn = document.getElementById("btnAutopilot");
  const voiceSelect = document.getElementById("ttsVoiceSelect");
  const ttsVoice = voiceSelect ? voiceSelect.value : "";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "RUNNING AUTOPILOT...";
  }
  showToast("Executing Full Autopilot: Profile Audit -> Comment DMs -> 30fps MP4 Render -> IG & FB Publish...");

  try {
    const res = await fetch("/api/run-autopilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttsVoice })
    });
    const json = await res.json();
    if (json.ok) {
      activeReelIndex = 0;
      await fetchConfigAndState();
      showToast(json.autopilotResult?.summary || "Full Autopilot cycle completed.");
    }
  } catch (err) {
    showToast("Autopilot failed: " + err.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "RUN AUTOPILOT LOOP ->";
    }
  }
}

async function runRagTestQuery() {
  const input = document.getElementById("ragQueryInput");
  const box = document.getElementById("ragQueryResultBox");
  if (!input || !box) return;

  try {
    const res = await fetch("/api/memory/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: input.value.trim(), topK: 3 })
    });
    const json = await res.json();
    const ctx = json.ragResult || json.ragContext;
    if (json.ok && ctx) {
      box.classList.remove("hidden");
      box.innerHTML = `
        <div class="font-bold text-white mono">TOP MATCHED RAG CHUNKS:</div>
        ${ctx.matchedKnowledgeDocs
          .map(
            (d) =>
              `<div class="text-zinc-300 mono">• <b>${escapeHtml(
                d.title
              )}</b> (score: ${d.similarityScore}) — ${escapeHtml(d.content)}</div>`
          )
          .join("")}
        <div class="pt-1 text-zinc-400 mono">
          ANTI-DUPLICATE GUARD: ${
            ctx.dedupCheck.isNearDuplicate
              ? `[BLOCKED: Near-duplicate (${ctx.dedupCheck.maxOverlapScore})]`
              : `[UNIQUE HOOK VERIFIED (max overlap: ${ctx.dedupCheck.maxOverlapScore})]`
          }
        </div>
      `;
    }
  } catch (err) {
    showToast("RAG query failed: " + err.message, true);
  }
}

async function addNewKnowledgeDoc() {
  const titleEl = document.getElementById("kbTitleInput");
  const catEl = document.getElementById("kbCategoryInput");
  const contentEl = document.getElementById("kbContentInput");
  const title = titleEl ? titleEl.value.trim() : "";
  const category = catEl ? catEl.value : "monetization";
  const content = contentEl ? contentEl.value.trim() : "";

  if (!title || !content) {
    showToast("Please provide both a title and content for the RAG knowledge fact.", true);
    return;
  }

  try {
    const res = await fetch("/api/memory/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, category, content })
    });
    const json = await res.json();
    if (json.ok) {
      if (titleEl) titleEl.value = "";
      if (contentEl) contentEl.value = "";
      await fetchConfigAndState();
      showToast(`Saved "${title}" into persistent RAG Knowledge Vault.`);
    }
  } catch (err) {
    showToast("Failed to add knowledge doc: " + err.message, true);
  }
}

async function deleteKnowledgeDoc(id) {
  try {
    await fetch(`/api/memory/knowledge/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    await fetchConfigAndState();
  } catch (err) {
    showToast("Failed to delete knowledge doc: " + err.message, true);
  }
}

function toggleSettingsModal(show) {
  const modal = document.getElementById("settingsModal");
  if (!modal) return;
  modal.classList.toggle("hidden", !show);
}

async function saveSettings() {
  const inputs = document.querySelectorAll("[data-schema-key]");
  const payload = {};
  inputs.forEach((el) => {
    const key = el.getAttribute("data-schema-key");
    if (el.type === "checkbox") {
      payload[key] = el.checked;
    } else {
      payload[key] = el.value.trim();
    }
  });

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.ok) {
      toggleSettingsModal(false);
      await fetchConfigAndState();
      showToast("Saved configuration to .env and synced accounts.");
    }
  } catch (err) {
    showToast("Failed to save settings: " + err.message, true);
  }
}

function speakActiveVoiceover() {
  const videoEl = document.getElementById("reelVideoPlayer");
  if (videoEl) {
    videoEl.muted = false;
    videoEl.currentTime = 0;
    videoEl.play().catch(() => {});
  }
  const queue = appState?.contentQueue || [];
  const active = queue[activeReelIndex];
  if (!active || !("speechSynthesis" in window)) return;
  if (!uiConfig?.ttsAvailable) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(active.voiceoverFull || "");
    utter.rate = 1.04;
    window.speechSynthesis.speak(utter);
  }
}

function copyRemotionCode() {
  const queue = appState?.contentQueue || [];
  const active = queue[activeReelIndex];
  if (!active?.remotionCode) return;
  navigator.clipboard.writeText(active.remotionCode);
  showToast("Copied Remotion (.tsx) source code to clipboard.");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.addEventListener("DOMContentLoaded", () => {
  fetchConfigAndState();
});
