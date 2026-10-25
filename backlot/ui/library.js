import { el, fmtAgo, getJSON, subscribe, thumbURL } from "/ui/lib.js";

const grid = document.getElementById("grid");
const THEME_KEY = "backlot.theme";

// Enforce dark monochrome theme by default
document.documentElement.dataset.theme = "dark";
localStorage.setItem(THEME_KEY, "dark");

function miniRail(states) {
  const rail = el("div", { class: "mini-rail" });
  for (const s of states) {
    const cls = s.status === "completed" ? "d"
      : s.status === "in_progress" ? "a"
      : s.status === "awaiting_human" ? "w" : "";
    rail.append(el("i", { class: cls, title: `${s.name}: ${s.status}` }));
  }
  return rail;
}

function card(p) {
  const poster = el("div", { class: "lib-poster" });
  if (p.poster) {
    const img = el("img", {
      src: thumbURL(p.project_id, p.poster, 640),
      loading: "lazy",
      alt: p.title || p.project_id,
    });
    img.onerror = () => {
      img.replaceWith(el("span", { class: "lp-txt" }, "9:16 REEL READY"));
    };
    poster.append(img);
  } else {
    poster.append(el("span", { class: "lp-txt" }, "NO MEDIA YET"));
  }
  if (p.live && p.active_stage) {
    poster.append(el("span", { class: "lp-live" },
      el("span", { class: "dot" }),
      p.awaiting_human ? "◈ AWAITING YOU" : `LIVE · ${p.active_stage.toUpperCase()}`));
  } else if (p.awaiting_human) {
    poster.append(el("span", { class: "lp-live" }, "◈ AWAITING YOU"));
  }

  const meta = el("div", { class: "lb-meta" },
    el("span", { class: "chip" }, p.pipeline_type || "animation"),
    p.scene_count ? el("span", { class: "chip" }, `${p.scene_count} scenes`) : null,
    p.render_count ? el("span", { class: "chip" }, `${p.render_count} renders`) : null,
    el("span", { class: "when" }, fmtAgo(p.last_activity)),
  );

  const staticSuffix = new URLSearchParams(location.search).has("static") ? "?static=1" : "";
  return el("a", {
    class: `lib-card${p.live ? " live-card" : ""}`,
    href: `/p/${p.project_id}${staticSuffix}`,
    style: "text-decoration:none;color:inherit",
  },
    poster,
    el("div", { class: "lib-body" },
      el("h3", {}, (p.title || p.project_id).toUpperCase()),
      meta,
      p.stage_states.length ? miniRail(p.stage_states) : null,
    ),
  );
}

async function render() {
  const projects = await getJSON("/api/projects");
  const countEl = document.getElementById("count");
  if (countEl) countEl.textContent = `${projects.length} projects`;
  const liveCount = projects.filter((p) => p.live).length;
  const badge = document.getElementById("liveBadge");
  if (badge) badge.classList.toggle("idle", liveCount === 0);
  const liveText = document.getElementById("liveText");
  if (liveText) liveText.textContent = liveCount ? `${liveCount} LIVE` : "READY";
  grid.innerHTML = "";
  const emptyEl = document.getElementById("empty");
  if (emptyEl) emptyEl.style.display = projects.length ? "none" : "block";
  for (const p of projects) grid.append(card(p));
}

render().catch(console.error);
if (!new URLSearchParams(location.search).has("static")) {
  subscribe("/api/library/events", () => render().catch(console.error));
}
