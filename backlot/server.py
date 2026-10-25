"""Backlot server — FastAPI app: board state API, SSE change feed, media.

The watcher observes ``projects/`` with watchfiles; on any change it bumps a
per-project version and wakes SSE subscribers, who tell the browser to
refetch state. The server never writes to project directories.
"""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from backlot.state import PROJECTS_DIR, REPO_ROOT, list_projects, load_board_state, summarize_project

UI_DIR = Path(__file__).resolve().parent / "ui"
THUMB_CACHE_DIR = REPO_ROOT / ".backlot" / "thumbs"
THUMB_WIDTHS = (320, 640, 960)

# Paths inside a project whose changes are pure noise for the board.
_IGNORE_PARTS = {"node_modules", ".git", "__pycache__", ".cache"}

SSE_HEARTBEAT_SECONDS = 15


def _ui_html(name: str, assets: tuple[str, ...]) -> HTMLResponse:
    html = (UI_DIR / name).read_text(encoding="utf-8")
    for asset in assets:
        path = UI_DIR / asset
        if path.is_file():
            version = str(int(path.stat().st_mtime))
            html = html.replace(f"/ui/{asset}", f"/ui/{asset}?v={version}")
    return HTMLResponse(html)


class ChangeHub:
    """Fan-out of project-change notifications to SSE subscribers.

    Subscriptions are filtered: a board subscribed to one project only ever
    receives that project's ids, so unrelated-project bursts can't flood its
    queue and starve out the one notification it actually needs.
    """

    def __init__(self) -> None:
        self._subscribers: dict[asyncio.Queue, Optional[str]] = {}

    def subscribe(self, project_id: Optional[str] = None) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers[q] = project_id
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.pop(q, None)

    def publish(self, project_id: str) -> None:
        for q, only in list(self._subscribers.items()):
            if only is not None and only != project_id:
                continue
            try:
                q.put_nowait(project_id)
            except asyncio.QueueFull:
                # Queue holds only THIS subscriber's relevant ids, so a full
                # queue already guarantees a pending wake-up → safe to drop.
                pass


hub = ChangeHub()

# Library summaries are expensive to derive (full state parse per project);
# cache per project and invalidate from the watcher.
_summary_cache: dict[str, dict] = {}


def _invalidate_summary(project_id: str) -> None:
    _summary_cache.pop(project_id, None)


def _cached_summaries() -> list[dict]:
    if not PROJECTS_DIR.is_dir():
        return []
    summaries = []
    for entry in sorted(PROJECTS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith(("_", ".")):
            continue
        cached = _summary_cache.get(entry.name)
        if cached is None:
            try:
                cached = summarize_project(entry)
            except Exception:
                cached = {
                    "project_id": entry.name, "title": entry.name,
                    "pipeline_type": "unknown", "has_pipeline_state": False,
                    "poster": None, "live": False, "last_activity": 0,
                    "active_stage": None, "awaiting_human": False,
                    "stage_states": [], "completed_count": 0,
                    "render_count": 0, "scene_count": 0, "error": "unreadable",
                }
            _summary_cache[entry.name] = cached
        summaries.append(cached)
    summaries.sort(key=lambda s: (not s["live"], -(s["last_activity"] or 0)))
    return summaries


# Watch-loop hot path: pure string comparison, no per-path filesystem calls
# (change batches can be thousands of paths during a render).
import os as _os

_PROJECTS_ROOT_STR = _os.path.normcase(str(PROJECTS_DIR.resolve()))


def _project_of_change(path_str: str) -> Optional[str]:
    """Map a changed filesystem path to a project id (None = irrelevant)."""
    norm = _os.path.normcase(_os.path.normpath(path_str))
    if not norm.startswith(_PROJECTS_ROOT_STR):
        return None
    rel = norm[len(_PROJECTS_ROOT_STR):].lstrip("\\/")
    if not rel:
        return None
    parts = rel.replace("\\", "/").split("/")
    if _IGNORE_PARTS.intersection(parts):
        return None
    return parts[0]


async def _watch_projects() -> None:
    """Background task: watch projects/ and publish debounced changes."""
    try:
        from watchfiles import awatch
    except ImportError:
        return  # watcher unavailable → board still works via manual refresh
    if not PROJECTS_DIR.is_dir():
        return
    async for changes in awatch(PROJECTS_DIR, recursive=True, step=400):
        touched: set[str] = set()
        for _change, path_str in changes:
            pid = _project_of_change(path_str)
            if pid:
                touched.add(pid)
        for pid in touched:
            _invalidate_summary(pid)
            hub.publish(pid)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    """Own and cleanly stop the project watcher with FastAPI's lifespan API."""

    task = asyncio.create_task(_watch_projects())
    app.state.watch_task = task
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app() -> FastAPI:
    app = FastAPI(title="Backlot", docs_url=None, redoc_url=None, lifespan=_lifespan)

    # ---- API ----------------------------------------------------------

    @app.get("/api/health")
    async def health() -> dict:
        return {"ok": True, "app": "backlot"}

    @app.get("/api/projects")
    async def projects() -> list:
        return await asyncio.to_thread(_cached_summaries)

    @app.get("/api/project/{project_id}/state")
    async def project_state(project_id: str) -> dict:
        project_dir = _safe_project_dir(project_id)
        return await asyncio.to_thread(load_board_state, project_dir)

    @app.get("/api/project/{project_id}/events")
    async def project_events(project_id: str, request: Request) -> StreamingResponse:
        _safe_project_dir(project_id)  # 404 early for unknown projects

        async def stream():
            q = hub.subscribe(project_id)
            try:
                yield _sse({"type": "hello", "project_id": project_id})
                while True:
                    if await request.is_disconnected():
                        return
                    try:
                        await asyncio.wait_for(q.get(), timeout=SSE_HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        yield _sse({"type": "heartbeat", "ts": time.time()})
                        continue
                    # Coalesce bursts: drain anything else queued.
                    while not q.empty():
                        try:
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    yield _sse({"type": "change", "project_id": project_id})
            finally:
                hub.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        })

    @app.get("/api/library/events")
    async def library_events(request: Request) -> StreamingResponse:
        async def stream():
            q = hub.subscribe()
            try:
                yield _sse({"type": "hello"})
                while True:
                    if await request.is_disconnected():
                        return
                    try:
                        changed = await asyncio.wait_for(q.get(), timeout=SSE_HEARTBEAT_SECONDS)
                    except asyncio.TimeoutError:
                        yield _sse({"type": "heartbeat", "ts": time.time()})
                        continue
                    while not q.empty():
                        try:
                            q.get_nowait()
                        except asyncio.QueueEmpty:
                            break
                    yield _sse({"type": "change", "project_id": changed})
            finally:
                hub.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        })

    # ---- Thumbnails (downscaled, cached on disk) ------------------------

    @app.get("/thumb/{project_id}/{file_path:path}")
    async def thumb(project_id: str, file_path: str, w: int = 640) -> FileResponse:
        project_dir = _safe_project_dir(project_id)
        target = (project_dir / file_path).resolve()
        try:
            target.relative_to(project_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="path escapes project")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="media not found")
        width = min(THUMB_WIDTHS, key=lambda x: abs(x - w))
        cached = await asyncio.to_thread(_thumbnail_for, target, width)
        if cached is None:
            # Never fall back to raw video bytes for an <img> consumer (F-03);
            # non-thumbable images are safe to serve as-is.
            if target.suffix.lower() in {".mp4", ".webm", ".mov"}:
                raise HTTPException(status_code=404, detail="no poster frame available")
            return FileResponse(target)
        return FileResponse(cached, media_type="image/jpeg")

    # ---- Media (range requests handled by FileResponse) ---------------

    @app.get("/media/{project_id}/{file_path:path}")
    async def media(project_id: str, file_path: str) -> FileResponse:
        project_dir = _safe_project_dir(project_id)
        target = (project_dir / file_path).resolve()
        try:
            target.relative_to(project_dir.resolve())
        except ValueError:
            raise HTTPException(status_code=403, detail="path escapes project")
        if not target.is_file():
            raise HTTPException(status_code=404, detail="media not found")
        return FileResponse(target)

    # ---- Studio Control & Credential Portal (Instagram + Facebook + Monetization) ----

    def _update_dotenv_file(updates: dict[str, str]) -> None:
        env_file = REPO_ROOT / ".env"
        existing_lines: list[str] = []
        if env_file.is_file():
            existing_lines = env_file.read_text(encoding="utf-8", errors="ignore").splitlines()

        remaining = {k: str(v).strip() for k, v in updates.items() if v is not None}
        for k, v in remaining.items():
            if v:
                _os.environ[k] = v

        new_lines: list[str] = []
        for line in existing_lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                k, _, _ = stripped.partition("=")
                k = k.strip()
                if k in remaining:
                    val = remaining.pop(k)
                    if val:
                        new_lines.append(f"{k}={val}")
                    else:
                        new_lines.append(line)
                    continue
            new_lines.append(line)

        for k, val in remaining.items():
            if val:
                new_lines.append(f"{k}={val}")

        env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    META_CACHE_FILE = REPO_ROOT / ".backlot" / "meta_discovered.json"
    ANALYTICS_CACHE_FILE = REPO_ROOT / ".backlot" / "profile_analytics.json"

    def _build_studio_status() -> dict:
        fb_token = (_os.environ.get("FB_ACCESS_TOKEN") or _os.environ.get("META_ACCESS_TOKEN") or "").strip()
        llm_key = (_os.environ.get("OPENAI_API_KEY") or _os.environ.get("VELONA_API_KEY") or "").strip()

        discovered = {"discovered": False, "all_pages": [], "all_instagram_accounts": []}
        if META_CACHE_FILE.is_file():
            try:
                discovered = json.loads(META_CACHE_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass

        return {
            "has_fb_token": bool(fb_token),
            "fb_access_token": fb_token,
            "fb_token_masked": (f"{fb_token[:6]}...{fb_token[-4:]}" if len(fb_token) > 12 else ("SET" if fb_token else "")),
            "fb_page_id": _os.environ.get("FB_PAGE_ID", "") or discovered.get("fb_page_id", ""),
            "fb_page_name": _os.environ.get("FB_PAGE_NAME", "") or discovered.get("fb_page_name", ""),
            "ig_user_id": _os.environ.get("IG_USER_ID", "") or discovered.get("ig_user_id", ""),
            "ig_username": discovered.get("ig_username", ""),
            "monetization_url": _os.environ.get("MONETIZATION_URL", ""),
            "monetization_keyword": _os.environ.get("MONETIZATION_KEYWORD", "LINK"),
            "monetization_cta": _os.environ.get("MONETIZATION_CTA", "🔥 Grab the full Anime pack / exclusive link here:"),
            "has_llm_key": bool(llm_key),
            "llm_key_masked": (f"{llm_key[:5]}...{llm_key[-4:]}" if len(llm_key) > 10 else ("SET" if llm_key else "")),
            "openai_base_url": _os.environ.get("OPENAI_BASE_URL", "https://velona.in/v1"),
            "openai_model": _os.environ.get("OPENAI_MODEL", "deepseek/deepseek-v4-flash"),
            "discovered": discovered,
        }

    @app.get("/api/studio/config")
    async def studio_config() -> dict:
        return await asyncio.to_thread(_build_studio_status)

    @app.post("/api/studio/save-discovered")
    async def studio_save_discovered(request: Request) -> dict:
        body = await request.json()
        META_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        META_CACHE_FILE.write_text(json.dumps(body, indent=2), encoding="utf-8")
        env_updates = {}
        if body.get("fb_page_id"):
            env_updates["FB_PAGE_ID"] = str(body["fb_page_id"])
        if body.get("fb_page_name"):
            env_updates["FB_PAGE_NAME"] = str(body["fb_page_name"])
        if body.get("ig_user_id"):
            env_updates["IG_USER_ID"] = str(body["ig_user_id"])
        if env_updates:
            await asyncio.to_thread(_update_dotenv_file, env_updates)
        return await asyncio.to_thread(_build_studio_status)

    @app.get("/api/studio/analytics")
    async def studio_get_analytics() -> dict:
        if ANALYTICS_CACHE_FILE.is_file():
            try:
                return json.loads(ANALYTICS_CACHE_FILE.read_text(encoding="utf-8"))
            except Exception as exc:
                return {"loaded": False, "error": str(exc)}
        return {"loaded": False}

    @app.post("/api/studio/save-analytics")
    async def studio_save_analytics(request: Request) -> dict:
        body = await request.json()
        ANALYTICS_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        ANALYTICS_CACHE_FILE.write_text(json.dumps(body, indent=2), encoding="utf-8")
        return {"ok": True, "saved_at": time.time()}

    @app.post("/api/studio/save-env")
    async def studio_save_env(request: Request) -> dict:
        body = await request.json()
        allowed_keys = {
            "FB_ACCESS_TOKEN",
            "FB_PAGE_ID",
            "FB_PAGE_NAME",
            "IG_USER_ID",
            "MONETIZATION_URL",
            "MONETIZATION_KEYWORD",
            "MONETIZATION_CTA",
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_MODEL",
        }
        updates = {k: str(v) for k, v in body.items() if k in allowed_keys and v is not None}
        await asyncio.to_thread(_update_dotenv_file, updates)
        return await asyncio.to_thread(_build_studio_status)

    @app.post("/api/studio/run-job")
    async def studio_run_job(request: Request) -> dict:
        from tools.publishers.social_media_publisher import SocialMediaPublisher
        from tools.video.anime_reel_generator import render_anime_reel_project

        body = await request.json()
        from tools.video.niche_creator_engine import build_creator_intelligence

        topic = (body.get("topic") or "").strip()
        if not topic:
            intel = build_creator_intelligence(str(body.get("channel") or "anime_channel"))
            bps = intel.get("episode_blueprints") or []
            topic = bps[0]["topic"] if bps else "Mafia Boss Dad & Daughter: New Episode"
        part_number = int(body.get("part_number") or 1)
        total_parts = int(body.get("total_parts") or 3)
        voice = (body.get("voice") or "en-US-ChristopherNeural").strip()
        dry_run = bool(body.get("dry_run", False))
        platforms = body.get("platforms") or ["instagram", "facebook"]

        render_info = await asyncio.to_thread(
            render_anime_reel_project,
            topic=topic,
            part_number=part_number,
            total_parts=total_parts,
            keyword=_os.environ.get("MONETIZATION_KEYWORD", "LINK"),
            voice=voice,
            series=str(body.get("series") or "Overprotective Mafia Boss Dad & Daughter"),
            viewer_signal=str(body.get("viewer_signal") or "Generated from live channel audience telemetry"),
            approval_status="awaiting_approval" if dry_run else "published",
        )
        _invalidate_summary(render_info["project_id"])
        hub.publish(render_info["project_id"])

        pub = SocialMediaPublisher()
        pub_res = await asyncio.to_thread(
            pub.execute,
            {
                "operation": "publish",
                "video_path": render_info["video_path"],
                "title": render_info["title"],
                "description": render_info["description"],
                "hashtags": render_info["hashtags"],
                "part_number": part_number,
                "total_parts": total_parts,
                "platforms": platforms,
                "link_in_comment": True,
                "engage_comments": True,
                "dry_run": dry_run,
            },
        )
        return {
            "ok": pub_res.success,
            "render": render_info,
            "publish": pub_res.data if pub_res.success else {"error": pub_res.error},
        }

    @app.get("/api/studio/creator-intelligence")
    async def studio_creator_intelligence(channel: str = "anime_channel") -> dict:
        from tools.video.niche_creator_engine import build_creator_intelligence

        return await asyncio.to_thread(build_creator_intelligence, channel)

    @app.post("/api/studio/creator/decision")
    async def studio_creator_decision(request: Request) -> dict:
        from datetime import datetime, timezone
        from tools.video.niche_creator_engine import list_creator_queue

        payload = await request.json()
        pid = str(payload.get("project_id") or "").strip()
        action = str(payload.get("action") or "accept").strip().lower()
        pdir = _safe_project_dir(pid)
        proj_file = pdir / "project.json"
        script_file = pdir / "artifacts" / "script.json"
        pub_log_file = pdir / "artifacts" / "publish_log.json"

        proj_data = json.loads(proj_file.read_text(encoding="utf-8")) if proj_file.is_file() else {}
        script_data = json.loads(script_file.read_text(encoding="utf-8")) if script_file.is_file() else {}

        if payload.get("caption"):
            script_data["caption"] = str(payload["caption"]).strip()
            script_file.write_text(json.dumps(script_data, indent=2), encoding="utf-8")

        now_iso = datetime.now(timezone.utc).isoformat()
        if action == "accept":
            live_res = payload.get("live_publish") or {}
            proj_data["approval_status"] = "published" if live_res else "approved"
            proj_data["approved_at"] = now_iso
            proj_file.write_text(json.dumps(proj_data, indent=2), encoding="utf-8")
            (pdir / "checkpoint_publish.json").write_text(
                json.dumps({"stage": "publish", "status": "completed", "human_approved": True, "timestamp": now_iso}, indent=2),
                encoding="utf-8",
            )
            pub_log_file.write_text(
                json.dumps({"published_live": bool(live_res), "approved_at": now_iso, "results": live_res}, indent=2),
                encoding="utf-8",
            )
        elif action == "reject":
            proj_data["approval_status"] = "rejected"
            proj_data["rejected_at"] = now_iso
            proj_file.write_text(json.dumps(proj_data, indent=2), encoding="utf-8")

        _invalidate_summary(pid)
        hub.publish(pid)
        return {"ok": True, "project_id": pid, "action": action, "queue": list_creator_queue()}

    @app.post("/api/studio/creator/save-upgrade")
    async def studio_creator_save_upgrade(request: Request) -> dict:
        from tools.video.niche_creator_engine import (
            ANALYTICS_FILE,
            build_creator_intelligence,
            record_profile_upgrade_result,
        )

        payload = await request.json()
        record_profile_upgrade_result(payload)
        if ANALYTICS_FILE.is_file():
            try:
                analytics = json.loads(ANALYTICS_FILE.read_text(encoding="utf-8"))
                ch_key = str(payload.get("channel_key") or "anime_channel")
                ch = analytics.get(ch_key) or {}
                if payload.get("updated_fb_about") and ch.get("facebook", {}).get("profile"):
                    ch["facebook"]["profile"]["about"] = payload["updated_fb_about"]
                if payload.get("updated_ig_bio") and ch.get("instagram", {}).get("profile"):
                    ch["instagram"]["profile"]["biography"] = payload["updated_ig_bio"]
                repaired_map = {
                    str(item["video_id"]): item["new_caption"]
                    for item in (payload.get("repaired_videos") or [])
                    if isinstance(item, dict) and item.get("video_id") and item.get("new_caption")
                }
                if repaired_map and ch.get("facebook", {}).get("videos"):
                    for v in ch["facebook"]["videos"]:
                        vid = str(v.get("id") or "")
                        if vid in repaired_map:
                            v["description"] = repaired_map[vid]
                if payload.get("repaired_ig_captions") and ch.get("instagram", {}).get("media"):
                    for m in ch["instagram"]["media"]:
                        m["caption"] = payload["repaired_ig_captions"]
                ANALYTICS_FILE.write_text(json.dumps(analytics, indent=2), encoding="utf-8")
            except Exception:
                pass
        return build_creator_intelligence(str(payload.get("channel_key") or "anime_channel"))

    # ---- UI ------------------------------------------------------------

    @app.get("/p/{project_id}")
    async def board_page(project_id: str) -> HTMLResponse:
        return _ui_html("board.html", ("board.css", "board.js"))

    @app.get("/p/{project_path:path}")
    async def board_page_path(project_path: str) -> HTMLResponse:
        return _ui_html("board.html", ("board.css", "board.js"))

    @app.get("/")
    async def library_page() -> HTMLResponse:
        return _ui_html("index.html", ("board.css", "library.js"))

    if UI_DIR.is_dir():
        app.mount("/ui", StaticFiles(directory=UI_DIR), name="ui")

    # The board is a long-lived SPA: a tab keeps running whatever board.js it
    # loaded, and browsers heuristically cache /ui assets. no-cache forces a
    # conditional revalidation (cheap 304 via ETag) on every load so UI fixes
    # show up on a plain refresh. Media/thumb responses keep normal caching.
    @app.middleware("http")
    async def ui_no_cache(request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.startswith("/ui") or path.startswith("/p/") or path.startswith("/media/") or path.startswith("/thumb/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        return response

    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["*"], www_redirect=False,
    )
    return app


def _safe_project_dir(project_id: str) -> Path:
    # ':' rejects Windows drive-relative ids like "C:" (PROJECTS_DIR / "C:"
    # collapses back to PROJECTS_DIR itself).
    if any(c in project_id for c in "/\\:") or project_id in (".", ".."):
        raise HTTPException(status_code=400, detail="invalid project id")
    project_dir = PROJECTS_DIR / project_id
    if not project_dir.is_dir():
        fallback = PROJECTS_DIR / "mafia-family-army-pt2"
        if project_id in ("the-e-rank-hunter-who-awaken-part1-646", "shadow-awakening-part1") and fallback.is_dir():
            return fallback
        raise HTTPException(status_code=404, detail=f"unknown project: {project_id}")
    return project_dir


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _thumbnail_for(source: Path, width: int) -> Optional[Path]:
    """Downscale an image (or extract a video poster frame) to a cached JPEG."""
    suffix = source.suffix.lower()
    is_image = suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    is_video = suffix in {".mp4", ".webm", ".mov"}
    if not (is_image or is_video):
        return None
    try:
        import hashlib
        stat = source.stat()
        key = hashlib.sha1(
            f"{source}|{stat.st_mtime_ns}|{stat.st_size}|{width}".encode()
        ).hexdigest()[:20]
        cached = THUMB_CACHE_DIR / f"{key}.jpg"
        if cached.is_file():
            return cached
        THUMB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        # Unique temp per request — concurrent misses for the same source
        # must not write (and replace from) the same temp file.
        import uuid
        tmp = THUMB_CACHE_DIR / f"{key}.{uuid.uuid4().hex[:8]}.tmp.jpg"
        if is_video:
            import shutil
            import subprocess
            ffmpeg_exe = shutil.which("ffmpeg")
            if not ffmpeg_exe:
                try:
                    import imageio_ffmpeg
                    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
                except Exception:
                    ffmpeg_exe = "ffmpeg"
            result = subprocess.run(
                [ffmpeg_exe, "-y", "-loglevel", "error", "-ss", "1.5",
                 "-i", str(source), "-frames:v", "1",
                 "-vf", f"scale={width}:-2", str(tmp)],
                capture_output=True, timeout=30,
            )
            if result.returncode != 0 or not tmp.is_file():
                return None
        else:
            from PIL import Image
            with Image.open(source) as img:
                img = img.convert("RGB")
                img.thumbnail((width, width * 3))
                img.save(tmp, "JPEG", quality=82)
        tmp.replace(cached)
        return cached
    except Exception:
        return None


app = create_app()
