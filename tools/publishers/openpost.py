"""OpenPost publisher — the distribution + feedback half of the Content Manager.

OpenPost (``getopenpost/openpost``) is the one piece this repo kept re-implementing
badly: a real multi-platform publishing surface with stored analytics and a reply
inbox. It renders nothing and generates nothing — the art, the motion and the voice
stay in this repo's generation tools. What it adds is the loop *after* the render:

    rendered reel ──> upload ──> publication ──> validate ──> publish / schedule
                                                        │
                          analytics export <────────────┴──> engagement inbox
                                    │                              │
                                    └──> next episode's brief      └──> reply

Everything here talks to the documented HTTP API (``/api/v1``), which is the same
surface the OpenPost web app, CLI, SDK and MCP server use. No SDK, no build step:
this module is pure standard library, so it works on a box where ``requests`` is
not installed (which is this repo's default install).

Self-host:

    git clone https://github.com/getopenpost/openpost && cd openpost
    docker compose up -d                  # web on :8080 by default
    # Settings -> Personal -> Developer -> create a token with api:read + api:write

Then:

    export OPENPOST_BASE_URL=http://127.0.0.1:8080
    export OPENPOST_TOKEN=op_...
    export OPENPOST_WORKSPACE_ID=ws_...

    python3 -m tools.publishers.openpost health
    python3 -m tools.publishers.openpost publish renders/ep01.mp4 \
        --caption "Six hundred years of darkness, and he still can't fold a croissant." \
        --account acc_instagram --account acc_facebook

Notes that cost real debugging time, so they are written down:

* A **publication** is the post; a **rendition** is its per-account version. Sending
  ``social_account_ids`` creates default renditions; pass ``output_profile`` to pin a
  reel (``instagram.reel``) instead of letting the server infer the format.
* ``publish-now`` takes ``expected_revision``. A ``409`` means the publication moved
  under you — re-read it, never retry the stale revision.
* Media upload is three calls, and an absolute upload URL points at storage: sending
  the bearer token there leaks it. Only relative upload targets get the token.
* Reuse one ``client_operation_id`` per reply. The server keeps a receipt, so a retry
  after a timeout does not post a second public comment.
* Analytics are stored, not live: ``GET /analytics/export`` returns what was collected.
  A blank metric is missing, never zero — do not average it into a decision.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

if __package__ in (None, ""):  # allow `python3 tools/publishers/openpost.py`
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from tools.base_tool import (  # noqa: E402
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    ToolResult,
    ToolRuntime,
    ToolStability,
    ToolTier,
)

API_PREFIX = "/api/v1"
TERMINAL_PUBLICATION_STATES = {
    "published",
    "failed",
    "partially_failed",
    "partial_failure",
    "cancelled",
    "canceled",
    "scheduled",
    "draft",
}


class OpenPostError(RuntimeError):
    """An OpenPost API call failed.

    Keeps the HTTP status and the server's error code so callers can branch on
    ``401`` (token), ``403`` (scope/workspace) and ``409`` (revision conflict)
    without parsing the message.
    """

    def __init__(self, message: str, *, status: int = 0, code: str = "", detail: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class OpenPostConfig:
    """Connection settings for one OpenPost instance and workspace."""

    base_url: str
    token: str
    workspace_id: str = ""

    @classmethod
    def from_env(cls, *, require_token: bool = True) -> "OpenPostConfig":
        base_url = (os.environ.get("OPENPOST_BASE_URL") or "").strip()
        token = (os.environ.get("OPENPOST_TOKEN") or "").strip()
        workspace_id = (
            os.environ.get("OPENPOST_WORKSPACE_ID")
            or os.environ.get("OPENPOST_WORKSPACE")
            or ""
        ).strip()
        if not base_url:
            raise OpenPostError(
                "OPENPOST_BASE_URL is not set. Point it at your instance, e.g. "
                "http://127.0.0.1:8080 (self-host) or https://app.openpo.st (hosted)."
            )
        if require_token and not token:
            raise OpenPostError(
                "OPENPOST_TOKEN is not set. Create one in Settings > Personal > "
                "Developer with the api:read and api:write scopes."
            )
        return cls(base_url=base_url.rstrip("/"), token=token, workspace_id=workspace_id)


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class OpenPostClient:
    """Thin, dependency-free client for the OpenPost HTTP API.

    One instance is safe to reuse; it holds no sockets between calls.
    """

    def __init__(self, config: OpenPostConfig, *, timeout: float = 60.0):
        self.config = config
        self.timeout = timeout

    # ------------------------------------------------------------------ HTTP

    def _api_url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.config.base_url}{API_PREFIX}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        base_url: Optional[str] = None,
        raw_body: Optional[bytes] = None,
        extra_headers: Optional[dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Any:
        url = base_url or self._api_url(path)
        if params:
            clean = {k: v for k, v in params.items() if v not in (None, "")}
            if clean:
                url = f"{url}?{urllib.parse.urlencode(clean)}"

        data = raw_body if raw_body is not None else (_json_bytes(body) if body is not None else None)
        headers = {"Accept": "application/json"}
        if self.config.token:
            headers["Authorization"] = f"Bearer {self.config.token}"
        if data is not None:
            headers.setdefault("Content-Type", "application/json")
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        if extra_headers:
            headers.update(extra_headers)

        request = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as exc:  # 4xx / 5xx
            payload = exc.read()
            code, detail = "", payload.decode("utf-8", "replace")
            try:
                parsed = json.loads(detail)
                code = str(parsed.get("code") or parsed.get("errors", [{}])[0].get("message", ""))
                detail = parsed.get("detail") or parsed.get("message") or detail
            except (ValueError, AttributeError, IndexError):
                pass
            raise OpenPostError(
                f"{method.upper()} {path} -> {exc.code}: {detail}",
                status=exc.code,
                code=code,
                detail=detail,
            ) from exc
        except urllib.error.URLError as exc:
            raise OpenPostError(
                f"{method.upper()} {path} failed: {exc.reason}. Is the OpenPost instance "
                f"running at {self.config.base_url}?"
            ) from exc

        if not payload:
            return {}
        if "application/json" not in content_type:
            return payload if "octet-stream" in content_type else payload.decode("utf-8", "replace")
        try:
            return json.loads(payload)
        except ValueError:
            return payload.decode("utf-8", "replace")

    # ------------------------------------------------------------- discovery

    def health(self) -> dict[str, Any]:
        """Liveness check. Works before a token exists."""
        saved, self.config = self.config.token, OpenPostConfig(
            self.config.base_url, "", self.config.workspace_id
        )
        try:
            return self._request("GET", "/health", timeout=15)
        finally:
            self.config = OpenPostConfig(self.config.base_url, saved, self.config.workspace_id)

    def list_workspaces(self) -> list[dict[str, Any]]:
        result = self._request("GET", "/workspaces")
        if isinstance(result, dict):
            for key in ("items", "workspaces", "data"):
                if isinstance(result.get(key), list):
                    return result[key]
            return [result] if result.get("id") else []
        return result or []

    def list_accounts(self, workspace_id: str = "") -> list[dict[str, Any]]:
        result = self._request(
            "GET", "/accounts", params={"workspace_id": workspace_id or self._workspace()}
        )
        if isinstance(result, dict):
            for key in ("items", "accounts", "data"):
                if isinstance(result.get(key), list):
                    return result[key]
            return []
        return result or []

    def _workspace(self, workspace_id: str = "") -> str:
        explicit = (workspace_id or self.config.workspace_id or "").strip()
        if explicit:
            return explicit
        raise OpenPostError(
            "No workspace_id. Set OPENPOST_WORKSPACE_ID or pass --workspace. "
            "Discover it with: python3 -m tools.publishers.openpost workspaces"
        )

    # ---------------------------------------------------------------- media

    def upload_media(
        self,
        path: str | Path,
        *,
        alt_text: str = "",
        workspace_id: str = "",
        idempotency_key: Optional[str] = None,
    ) -> str:
        """Run the three-step upload and return the media id.

        Step 2 is skipped when OpenPost reports the bytes already exist
        (``deduped: true``), which is the common case when re-publishing a render.
        """
        file_path = Path(path)
        if not file_path.is_file():
            raise OpenPostError(f"Media file not found: {file_path}")
        size = file_path.stat().st_size
        mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

        session = self._request(
            "POST",
            "/media/upload-session",
            body={
                "workspace_id": self._workspace(workspace_id),
                "filename": file_path.name,
                "mime_type": mime_type,
                "size": size,
                "alt_text": alt_text,
            },
            idempotency_key=idempotency_key or f"upload-{file_path.stem}-{size}",
        )
        media_id = str(session.get("media_id") or session.get("id") or "")
        if not media_id:
            raise OpenPostError(f"Upload session returned no media id: {session}")
        if session.get("deduped"):
            return media_id

        upload = session.get("upload") or {}
        target = str(upload.get("url") or session.get("complete_url") or "")
        if not target:
            raise OpenPostError(f"Upload session returned no upload target: {session}")

        headers = {str(k): str(v) for k, v in (upload.get("headers") or {}).items()}
        is_external = target.startswith(("http://", "https://"))
        target_url = target if is_external else f"{self.config.base_url}{target}"
        # Never send the workspace token to third-party storage.
        saved_token = self.config.token
        if is_external:
            self.config = OpenPostConfig(self.config.base_url, "", self.config.workspace_id)
        try:
            self._request(
                str(upload.get("method") or "PUT"),
                "",
                base_url=target_url,
                raw_body=file_path.read_bytes(),
                extra_headers={"Content-Type": mime_type, **headers},
                timeout=max(self.timeout, 300),
            )
        finally:
            self.config = OpenPostConfig(self.config.base_url, saved_token, self.config.workspace_id)

        completed = self._request(
            "POST",
            f"/media/upload-session/{urllib.parse.quote(media_id)}/complete",
            body={"workspace_id": self._workspace(workspace_id)},
        )
        return str(completed.get("id") or media_id)

    # ---------------------------------------------------------- publications

    def create_publication(
        self,
        *,
        title: str,
        source_text: str,
        account_ids: Optional[list[str]] = None,
        media_ids: Optional[list[str]] = None,
        workspace_id: str = "",
        content_profile: str = "short_video",
        output_profile: str = "",
        scheduled_at: Optional[str] = None,
        creation_preset: str = "",
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a draft. Nothing is published by this call."""
        body: dict[str, Any] = {
            "workspace_id": self._workspace(workspace_id),
            "title": title,
            "content_profile": content_profile,
            "source_text": source_text,
        }
        if creation_preset:
            body["creation_preset"] = creation_preset
        if scheduled_at:
            body["scheduled_at"] = scheduled_at

        media = [{"media_id": media_id} for media_id in (media_ids or [])]
        if media:
            body["media"] = media

        accounts = [a for a in (account_ids or []) if a]
        if accounts and output_profile:
            body["renditions"] = [
                {
                    "social_account_id": account_id,
                    "output_profile": output_profile,
                    "format_locked": True,
                    "media": media,
                }
                for account_id in accounts
            ]
        elif accounts:
            body["social_account_ids"] = accounts

        return self._request(
            "POST",
            "/publications",
            body=body,
            idempotency_key=idempotency_key or f"pub-{uuid.uuid4().hex[:12]}",
        )

    def get_publication(self, publication_id: str) -> dict[str, Any]:
        return self._request("GET", f"/publications/{urllib.parse.quote(publication_id)}")

    def publication_events(self, publication_id: str) -> dict[str, Any]:
        return self._request(
            "GET", f"/publications/{urllib.parse.quote(publication_id)}/events"
        )

    def validate(self, publication_id: str) -> dict[str, Any]:
        return self._request("POST", f"/publications/{urllib.parse.quote(publication_id)}/validate", body={})

    def publish_now(
        self, publication_id: str, revision: int, *, idempotency_key: Optional[str] = None
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/publications/{urllib.parse.quote(publication_id)}/publish-now",
            body={"expected_revision": revision},
            idempotency_key=idempotency_key,
        )

    def schedule(
        self,
        publication_id: str,
        revision: int,
        *,
        scheduled_at: str = "",
        idempotency_key: Optional[str] = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"expected_revision": revision}
        if scheduled_at:
            body["scheduled_at"] = scheduled_at
        return self._request(
            "POST",
            f"/publications/{urllib.parse.quote(publication_id)}/schedule",
            body=body,
            idempotency_key=idempotency_key,
        )

    def wait_for_publication(
        self,
        publication_id: str,
        *,
        timeout: float = 300.0,
        poll: float = 5.0,
    ) -> dict[str, Any]:
        """Poll until every rendition reaches a terminal state, or the timeout hits.

        Renditions report ``published`` further along than the publication's own
        status, so this checks the renditions and falls back to the parent status.
        """
        deadline = time.monotonic() + timeout
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last = self.get_publication(publication_id)
            renditions = last.get("renditions") or []
            states = {str(r.get("status") or "").lower() for r in renditions}
            if states and states.issubset(TERMINAL_PUBLICATION_STATES):
                if not states & {"draft", "scheduled"}:
                    return last
            if not states:
                status = str(last.get("status") or "").lower()
                if status in TERMINAL_PUBLICATION_STATES and status != "draft":
                    return last
            time.sleep(poll)
        return last

    # ------------------------------------------------------------- analytics

    def analytics(
        self,
        *,
        workspace_id: str = "",
        days: int = 30,
        dataset: str = "posts",
        group_by: str = "post",
        account_ids: Optional[list[str]] = None,
        platforms: Optional[list[str]] = None,
        metrics: Optional[list[str]] = None,
        timezone: str = "UTC",
        fmt: str = "json",
    ) -> Any:
        """Read stored measurements.

        ``dataset="posts"`` is the useful one for a content decision: one row per
        post. A blank cell means the provider did not report that metric — it is
        missing, not zero, so callers must skip it instead of averaging it in.
        """
        return self._request(
            "GET",
            "/analytics/export",
            params={
                "workspace_id": self._workspace(workspace_id),
                "days": days,
                "dataset": dataset,
                "group_by": group_by,
                "account_ids": ",".join(account_ids or []),
                "platforms": ",".join(platforms or []),
                "metrics": ",".join(metrics or []),
                "timezone": timezone,
                "format": fmt,
            },
            timeout=max(self.timeout, 120),
        )

    # --------------------------------------------------------------- features

    def account_features(
        self, account_ids: list[str], *, workspace_id: str = ""
    ) -> list[dict[str, Any]]:
        """Report which of ``analytics``, ``engagement``, ``messaging``, ``grow``
        each account can actually run.

        This is the honest answer to "is analytics on?": a connected account can
        publish while analytics stay off, or be enabled-but-blocked for a missing
        OAuth scope. ``availability`` is one of ``available``, ``unsupported``,
        ``missing_scope``, ``plan_restricted``, and ``effective_enabled`` is
        fail-closed — it is the only value worth trusting.
        """
        account_ids = [a for a in account_ids if a]
        if not account_ids:
            return []
        result = self._request(
            "GET",
            "/account-features",
            params={
                "workspace_id": self._workspace(workspace_id),
                "account_ids": ",".join(account_ids),
            },
        )
        if isinstance(result, dict):
            return list(result.get("features") or [])
        return result or []

    # ------------------------------------------------------------ engagement

    def engagement(
        self,
        *,
        kind: str = "comment",
        workspace_id: str = "",
        account_id: str = "",
        unread_only: bool = False,
        limit: int = 50,
    ) -> dict[str, Any]:
        result = self._request(
            "GET",
            "/engagement",
            params={
                "workspace_id": self._workspace(workspace_id),
                "kind": kind,
                "account_id": account_id,
                "unread": "true" if unread_only else "",
                "limit": limit,
            },
        )
        return result if isinstance(result, dict) else {"items": result}

    def refresh_engagement(self, *, workspace_id: str = "") -> dict[str, Any]:
        return self._request(
            "POST", "/engagement/refresh", body={"workspace_id": self._workspace(workspace_id)}
        )

    def reply(
        self,
        item_id: str,
        message: str,
        *,
        workspace_id: str = "",
        client_operation_id: str = "",
        action: str = "reply",
    ) -> dict[str, Any]:
        """Queue a public reply. Reuse ``client_operation_id`` when retrying."""
        if action == "reply" and not message.strip():
            raise OpenPostError("A reply needs a non-empty message.")
        return self._request(
            "POST",
            f"/engagement/{urllib.parse.quote(item_id)}/actions",
            body={
                "workspace_id": self._workspace(workspace_id),
                "action": action,
                "message": message,
                "client_operation_id": client_operation_id or f"reply-{uuid.uuid4().hex[:12]}",
            },
        )

    # ------------------------------------------------------------- shortcuts

    def publish_reel(
        self,
        video_path: str | Path,
        *,
        caption: str,
        title: str = "",
        account_ids: Optional[list[str]] = None,
        output_profile: str = "instagram.reel",
        scheduled_at: str = "",
        wait: bool = True,
        workspace_id: str = "",
    ) -> dict[str, Any]:
        """Upload a rendered reel, validate it, then publish or schedule it.

        This is the one-call path the Content Manager uses after a render: it
        returns the final publication (with per-destination status and URLs).
        """
        media_id = self.upload_media(video_path, workspace_id=workspace_id)
        publication = self.create_publication(
            title=title or Path(video_path).stem,
            source_text=caption,
            account_ids=account_ids,
            media_ids=[media_id],
            workspace_id=workspace_id,
            output_profile=output_profile if account_ids else "",
            scheduled_at=scheduled_at or None,
        )
        publication_id = str(publication.get("id") or "")
        if not publication_id:
            raise OpenPostError(f"Publication create returned no id: {publication}")
        revision = int(publication.get("revision") or 1)

        validation = self.validate(publication_id)
        if validation.get("valid") is False:
            raise OpenPostError(
                f"OpenPost rejected the publication before publishing: "
                f"{validation.get('issues') or validation}",
                status=422,
                detail=validation,
            )

        if scheduled_at:
            self.schedule(publication_id, revision, scheduled_at=scheduled_at)
        else:
            self.publish_now(publication_id, revision)
        return self.wait_for_publication(publication_id) if wait else self.get_publication(publication_id)


def run_doctor(client: OpenPostClient) -> list[dict[str, Any]]:
    """Answer "is this set up?" with checks that fail for a reason.

    Each check carries a name, an ok flag, the observed detail, and — when it
    fails — what to do next. Ordered so the first failure is the one to fix.
    """
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str, fix: str = "") -> None:
        checks.append({"check": name, "ok": ok, "detail": detail, "fix": "" if ok else fix})

    add(
        "instance url",
        bool(client.config.base_url),
        client.config.base_url or "unset",
        "export OPENPOST_BASE_URL=http://127.0.0.1:8080",
    )

    try:
        health = client.health()
        add("instance reachable", True, str(health.get("status") or health.get("version") or "ok"))
    except OpenPostError as exc:
        add(
            "instance reachable",
            False,
            str(exc),
            "Start it: `docker compose up -d` in your openpost clone, and check the port.",
        )
        return checks  # nothing below can work

    if not client.config.token:
        add("token set", False, "OPENPOST_TOKEN is empty", "Settings > Personal > Developer")
        return checks
    try:
        workspaces = client.list_workspaces()
        add("token valid", True, f"{len(workspaces)} workspace(s) visible")
    except OpenPostError as exc:
        add(
            "token valid",
            False,
            f"{exc.status}: {exc}",
            "401 means expired or revoked; 403 means wrong scope or workspace.",
        )
        return checks

    workspace_id = client.config.workspace_id
    if not workspace_id and workspaces:
        workspace_id = str(workspaces[0].get("id") or "")
    add(
        "workspace resolved",
        bool(workspace_id),
        workspace_id or "unset",
        "export OPENPOST_WORKSPACE_ID=ws_... (see `workspaces`)",
    )
    if not workspace_id:
        return checks

    try:
        accounts = client.list_accounts(workspace_id)
    except OpenPostError as exc:
        add("accounts listed", False, str(exc), "Check the token's workspace binding.")
        return checks

    add(
        "accounts connected",
        bool(accounts),
        ", ".join(
            f"{a.get('platform')}:{a.get('account_username') or a.get('alias') or a.get('id')}"
            for a in accounts
        )
        or "none",
        "Settings > Workspace > Social accounts > connect the account you post from.",
    )
    if not accounts:
        return checks

    account_ids = [str(a.get("id")) for a in accounts if a.get("id")]
    try:
        features = client.account_features(account_ids, workspace_id=workspace_id)
    except OpenPostError as exc:
        add("features readable", False, str(exc), "Needs api:read on the same workspace.")
        return checks

    def summarise(feature: str) -> tuple[bool, str]:
        rows = [f for f in features if f.get("feature") == feature]
        on = [f for f in rows if f.get("effective_enabled")]
        blocked = [
            f"{f.get('platform')}:{f.get('availability')}"
            + (f" (missing {','.join(f.get('missing_scopes') or [])})" if f.get("missing_scopes") else "")
            for f in rows
            if not f.get("effective_enabled")
        ]
        detail = f"{len(on)}/{len(rows)} enabled" + (f"; blocked: {'; '.join(blocked)}" if blocked else "")
        return bool(on), detail

    ok_publish, publish_detail = True, "capability varies per account; test one draft"
    add("publishing", ok_publish, publish_detail)

    ok_analytics, analytics_detail = summarise("analytics")
    add(
        "analytics enabled",
        ok_analytics,
        analytics_detail,
        "Enable Analytics per account in Settings, then reconnect if a scope is missing.",
    )

    ok_inbox, engagement_detail = summarise("engagement")
    add(
        "inbox enabled",
        ok_inbox,
        engagement_detail,
        "Enable Inbox activity per account; it is a separate switch from publishing.",
    )
    return checks


# --------------------------------------------------------------------------- tool


class OpenPostPublisher(BaseTool):
    """PUBLISH-tier tool: ship a render through OpenPost and read the results back.

    Three operations, each usable on its own:

    * ``publish``    — upload the render and publish or schedule it
    * ``analytics``  — stored per-post measurements for the last N days
    * ``engagement`` — comments/mentions plus approved replies
    """

    name = "openpost_publisher"
    version = "0.1.0"
    tier = ToolTier.PUBLISH
    capability = "publish"
    provider = "openpost"
    stability = ToolStability.BETA
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.DETERMINISTIC
    runtime = ToolRuntime.API

    dependencies = []  # standard library only
    optional_env_vars = ["OPENPOST_BASE_URL", "OPENPOST_TOKEN", "OPENPOST_WORKSPACE_ID"]
    install_instructions = (
        "Run an OpenPost instance (docker compose up -d) and set OPENPOST_BASE_URL, "
        "OPENPOST_TOKEN and OPENPOST_WORKSPACE_ID."
    )

    agent_skills = []

    capabilities = [
        "publish_reel_via_openpost",
        "schedule_publication",
        "read_post_analytics",
        "read_engagement_inbox",
        "reply_to_comment",
    ]
    supports = {
        "free": True,
        "self_hosted": True,
        "uploads": True,
        "scheduling": True,
        "analytics": True,
        "engagement": True,
        "generates_media": False,
    }
    best_for = [
        "distributing a finished render to several networks from one call",
        "reading stored post performance so the next episode can learn from it",
        "answering audience comments without a second tool",
    ]
    not_good_for = [
        "creating or editing the video (it publishes what you hand it)",
        "platforms whose provider permissions you have not connected in OpenPost",
    ]
    side_effects = ["publishes content to connected social accounts", "sends public replies"]
    user_visible_verification = [
        "GET /publications/{id} shows every rendition as published, with a provider URL",
    ]

    resource_profile = ResourceProfile(cpu_cores=1, ram_mb=128, disk_mb=0, network_required=True)

    input_schema = {
        "type": "object",
        "required": ["operation"],
        "properties": {
            "operation": {
                "type": "string",
                "enum": [
                    "health", "doctor", "publish", "status",
                    "analytics", "engagement", "reply",
                ],
            },
            "video_path": {"type": "string", "description": "Rendered MP4 to publish."},
            "caption": {"type": "string", "description": "Post text / caption."},
            "title": {"type": "string", "description": "Internal publication title."},
            "account_ids": {"type": "array", "items": {"type": "string"}},
            "output_profile": {"type": "string", "default": "instagram.reel"},
            "scheduled_at": {"type": "string", "description": "RFC 3339 time; omit to publish now."},
            "publication_id": {"type": "string"},
            "days": {"type": "integer", "default": 30},
            "kind": {"type": "string", "enum": ["comment", "mention", "review"], "default": "comment"},
            "item_id": {"type": "string"},
            "message": {"type": "string"},
        },
    }

    def _client(self, inputs: dict[str, Any]) -> OpenPostClient:
        base_url = inputs.get("base_url") or os.environ.get("OPENPOST_BASE_URL", "")
        token = inputs.get("token") or os.environ.get("OPENPOST_TOKEN", "")
        workspace_id = inputs.get("workspace_id") or os.environ.get("OPENPOST_WORKSPACE_ID", "")
        if not base_url:
            raise OpenPostError(
                "No OpenPost instance configured. Set OPENPOST_BASE_URL (self-host "
                "default is http://127.0.0.1:8080) or pass base_url."
            )
        return OpenPostClient(
            OpenPostConfig(base_url=base_url.rstrip("/"), token=token, workspace_id=workspace_id)
        )

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        started = time.monotonic()
        operation = str(inputs.get("operation") or "health")
        try:
            client = self._client(inputs)
            if operation == "health":
                health = client.health()
                workspaces: list[dict[str, Any]] = []
                if client.config.token:
                    try:
                        workspaces = client.list_workspaces()
                    except OpenPostError as exc:
                        health = {**health, "workspace_error": str(exc)}
                return ToolResult(
                    success=True,
                    data={"operation": "health", "health": health, "workspaces": workspaces},
                    duration_seconds=time.monotonic() - started,
                )

            if operation == "doctor":
                checks = run_doctor(client)
                return ToolResult(
                    success=all(c["ok"] for c in checks),
                    data={"operation": "doctor", "checks": checks,
                          "setup_complete": all(c["ok"] for c in checks)},
                    duration_seconds=time.monotonic() - started,
                )

            if operation == "publish":
                video_path = inputs.get("video_path")
                if not video_path:
                    raise OpenPostError("operation=publish needs video_path")
                publication = client.publish_reel(
                    video_path,
                    caption=str(inputs.get("caption") or ""),
                    title=str(inputs.get("title") or ""),
                    account_ids=list(inputs.get("account_ids") or []),
                    output_profile=str(inputs.get("output_profile") or "instagram.reel"),
                    scheduled_at=str(inputs.get("scheduled_at") or ""),
                    wait=bool(inputs.get("wait", True)),
                )
                return ToolResult(
                    success=True,
                    data={"operation": "publish", "publication": publication},
                    artifacts=[],
                    duration_seconds=time.monotonic() - started,
                )

            if operation == "status":
                publication_id = str(inputs.get("publication_id") or "")
                if not publication_id:
                    raise OpenPostError("operation=status needs publication_id")
                return ToolResult(
                    success=True,
                    data={
                        "operation": "status",
                        "publication": client.get_publication(publication_id),
                        "events": client.publication_events(publication_id),
                    },
                    duration_seconds=time.monotonic() - started,
                )

            if operation == "analytics":
                rows = client.analytics(
                    days=int(inputs.get("days") or 30),
                    account_ids=list(inputs.get("account_ids") or []),
                    platforms=list(inputs.get("platforms") or []),
                )
                return ToolResult(
                    success=True,
                    data={"operation": "analytics", "analytics": rows},
                    duration_seconds=time.monotonic() - started,
                )

            if operation == "engagement":
                return ToolResult(
                    success=True,
                    data={
                        "operation": "engagement",
                        "engagement": client.engagement(
                            kind=str(inputs.get("kind") or "comment"),
                            unread_only=bool(inputs.get("unread_only", False)),
                            limit=int(inputs.get("limit") or 50),
                        ),
                    },
                    duration_seconds=time.monotonic() - started,
                )

            if operation == "reply":
                item_id = str(inputs.get("item_id") or "")
                if not item_id:
                    raise OpenPostError("operation=reply needs item_id")
                return ToolResult(
                    success=True,
                    data={
                        "operation": "reply",
                        "result": client.reply(
                            item_id,
                            str(inputs.get("message") or ""),
                            client_operation_id=str(inputs.get("client_operation_id") or ""),
                        ),
                    },
                    duration_seconds=time.monotonic() - started,
                )

            raise OpenPostError(f"Unknown operation: {operation}")
        except OpenPostError as exc:
            return ToolResult(
                success=False,
                data={"operation": operation, "status": exc.status, "code": exc.code},
                error=str(exc),
                duration_seconds=time.monotonic() - started,
            )

    def dry_run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """Confirm the instance is reachable before uploading anything."""
        try:
            health = self._client(inputs).health()
            return {"ok": True, "reachable": True, "health": health}
        except OpenPostError as exc:
            return {"ok": False, "reachable": False, "error": str(exc)}


# ---------------------------------------------------------------------------- cli


def _client_from_args(args: argparse.Namespace) -> OpenPostClient:
    config = OpenPostConfig(
        base_url=(args.base_url or os.environ.get("OPENPOST_BASE_URL") or "").rstrip("/"),
        token=args.token or os.environ.get("OPENPOST_TOKEN", ""),
        workspace_id=args.workspace or os.environ.get("OPENPOST_WORKSPACE_ID", ""),
    )
    if not config.base_url:
        raise SystemExit("Set --base-url or OPENPOST_BASE_URL (e.g. http://127.0.0.1:8080).")
    return OpenPostClient(config, timeout=args.timeout)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="openpost",
        description="Publish renders and read results through an OpenPost instance.",
    )
    parser.add_argument("--base-url", help="Instance origin, e.g. http://127.0.0.1:8080")
    parser.add_argument("--token", help="Developer token (or OPENPOST_TOKEN)")
    parser.add_argument("--workspace", help="Workspace id (or OPENPOST_WORKSPACE_ID)")
    parser.add_argument("--timeout", type=float, default=60.0)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("health", help="Check the instance and list workspaces")
    sub.add_parser("doctor", help="Check env, token, workspace, accounts, analytics, inbox")
    sub.add_parser("workspaces", help="List workspaces the token can see")
    sub.add_parser("accounts", help="List connected social accounts")

    publish = sub.add_parser("publish", help="Upload a render and publish it")
    publish.add_argument("video")
    publish.add_argument("--caption", required=True)
    publish.add_argument("--title", default="")
    publish.add_argument("--account", action="append", default=[], dest="accounts")
    publish.add_argument("--profile", default="instagram.reel")
    publish.add_argument("--scheduled-at", default="")
    publish.add_argument("--no-wait", action="store_true")

    status = sub.add_parser("status", help="Read one publication and its events")
    status.add_argument("publication_id")

    analytics = sub.add_parser("analytics", help="Export stored measurements as JSON")
    analytics.add_argument("--days", type=int, default=30)
    analytics.add_argument("--dataset", default="posts", choices=["report", "posts", "daily", "accounts"])
    analytics.add_argument("--platform", action="append", default=[], dest="platforms")
    analytics.add_argument("--out", default="")

    inbox = sub.add_parser("inbox", help="List comments, mentions or reviews")
    inbox.add_argument("--kind", default="comment", choices=["comment", "mention", "review"])
    inbox.add_argument("--unread", action="store_true")

    reply = sub.add_parser("reply", help="Queue a public reply to an inbox item")
    reply.add_argument("item_id")
    reply.add_argument("--message", required=True)

    args = parser.parse_args(argv)
    client = _client_from_args(args)

    try:
        if args.command == "health":
            print(json.dumps(client.health(), indent=2, ensure_ascii=False))
        elif args.command == "doctor":
            checks = run_doctor(client)
            width = max(len(c["check"]) for c in checks)
            for check in checks:
                mark = "PASS" if check["ok"] else "FAIL"
                print(f"[{mark}] {check['check'].ljust(width)}  {check['detail']}")
                if check["fix"]:
                    print(f"       {' ' * width}  -> {check['fix']}")
            complete = all(c["ok"] for c in checks)
            print("\nsetup complete: " + ("yes" if complete else "no"))
            return 0 if complete else 1
        elif args.command == "workspaces":
            print(json.dumps(client.list_workspaces(), indent=2, ensure_ascii=False))
        elif args.command == "accounts":
            print(json.dumps(client.list_accounts(), indent=2, ensure_ascii=False))
        elif args.command == "publish":
            result = client.publish_reel(
                args.video,
                caption=args.caption,
                title=args.title,
                account_ids=args.accounts,
                output_profile=args.profile,
                scheduled_at=args.scheduled_at,
                wait=not args.no_wait,
            )
            print(json.dumps(result, indent=2, ensure_ascii=False))
        elif args.command == "status":
            print(json.dumps(client.get_publication(args.publication_id), indent=2, ensure_ascii=False))
        elif args.command == "analytics":
            rows = client.analytics(
                days=args.days, dataset=args.dataset, platforms=args.platforms
            )
            text = json.dumps(rows, indent=2, ensure_ascii=False)
            if args.out:
                Path(args.out).write_text(text, encoding="utf-8")
                print(f"wrote {args.out}")
            else:
                print(text)
        elif args.command == "inbox":
            print(
                json.dumps(
                    client.engagement(kind=args.kind, unread_only=args.unread),
                    indent=2,
                    ensure_ascii=False,
                )
            )
        elif args.command == "reply":
            print(json.dumps(client.reply(args.item_id, args.message), indent=2, ensure_ascii=False))
    except OpenPostError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
