"""Contract tests for the OpenPost client — no network, no running instance.

A local HTTP server stands in for OpenPost, so these tests pin the actual wire
format against the documented API: the three-step media upload, the
``expected_revision`` on ``publish-now``, ``instagram.reel`` renditions, the
separate bearer-token rule for external storage targets, and the
``client_operation_id`` that makes a reply retry-safe.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from tools.publishers.openpost import (
    OpenPostClient,
    OpenPostConfig,
    OpenPostError,
    OpenPostPublisher,
    run_doctor,
)


class _FakeOpenPost:
    """Tiny stateful stand-in for an OpenPost instance."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.upload_headers: dict[str, str] = {}
        self.deduped = False
        self.external_upload = False
        self.publish_conflict = False
        self.validation_issues: list[dict[str, Any]] = []
        self.publication_polls = 0
        self.enabled_features: list[str] = []
        self.analytics_rows = [
            {"Post": "ep01", "Platform": "instagram", "Views": 12400, "Engagement": 830},
            {"Post": "ep02", "Platform": "instagram", "Views": "", "Engagement": 610},
        ]

    # -- routing ---------------------------------------------------------

    def handle(self, handler: BaseHTTPRequestHandler, method: str, path: str, body: bytes) -> tuple[int, Any]:
        raw_path = path
        parsed = json.loads(body) if body else {}
        self.requests.append({"method": method, "path": raw_path, "body": parsed})
        path = path.split("?")[0]  # routes ignore the query string

        if path.endswith("/api/v1/health"):
            return 200, {"status": "ok", "version": "7.3.1"}

        if path.endswith("/api/v1/workspaces") and method == "GET":
            return 200, {"items": [{"id": "ws_1", "name": "Studio"}]}

        if path.endswith("/api/v1/accounts") and method == "GET":
            return 200, {
                "items": [
                    {"id": "acc_ig", "platform": "instagram", "account_username": "bakery"},
                    {"id": "acc_fb", "platform": "facebook", "account_username": "bakerypage"},
                ]
            }

        if path.endswith("/api/v1/account-features") and method == "GET":
            rows = []
            for account in ("acc_ig", "acc_fb"):
                for feature in ("analytics", "engagement"):
                    enabled = feature in self.enabled_features
                    rows.append(
                        {
                            "social_account_id": account,
                            "platform": "instagram" if account == "acc_ig" else "facebook",
                            "feature": feature,
                            "supported": True,
                            "availability": "available" if enabled else "missing_scope",
                            "missing_scopes": [] if enabled else ["instagram_manage_insights"],
                            "effective_enabled": enabled,
                        }
                    )
            return 200, {"features": rows}

        if path.endswith("/api/v1/media/upload-session") and method == "POST":
            if self.deduped:
                return 200, {
                    "media_id": "media_existing",
                    "deduped": True,
                    "upload": {},
                    "complete_url": "/api/v1/media/upload-session/media_existing/complete",
                }
            target = "/api/v1/media/upload/media_new"
            if self.external_upload:
                target = f"{self.base_url}/external-storage/media_new"  # type: ignore[attr-defined]
            return 200, {
                "media_id": "media_new",
                "deduped": False,
                "upload": {"method": "PUT", "url": target, "headers": {"x-storage-token": "s3cr3t"}},
                "complete_url": "/api/v1/media/upload-session/media_new/complete",
            }

        if "/api/v1/media/upload-session/" in path and path.endswith("/complete"):
            return 200, {"id": "media_new", "processing_status": "ready"}

        if path.endswith("/api/v1/publications") and method == "POST":
            return 200, {
                "id": "pub_1",
                "revision": 3,
                "status": "draft",
                "renditions": [
                    {
                        "id": "r1",
                        "social_account_id": "acc_ig",
                        "output_profile": parsed.get("renditions", [{}])[0].get("output_profile", ""),
                        "status": "draft",
                    }
                ],
            }

        if path.endswith("/validate"):
            return 200, {"valid": not self.validation_issues, "issues": self.validation_issues}

        if path.endswith("/publish-now"):
            if self.publish_conflict:
                return 409, {"detail": "publication changed", "code": "revision_conflict"}
            return 200, {"id": "pub_1", "status": "queued"}

        if path.endswith("/api/v1/publications/pub_1/events"):
            return 200, {"items": [{"type": "validated"}, {"type": "published"}]}

        if path.endswith("/api/v1/publications/pub_1") and method == "GET":
            self.publication_polls += 1
            status = "queued" if self.publication_polls < 2 else "published"
            return 200, {
                "id": "pub_1",
                "status": status,
                "renditions": [
                    {
                        "id": "r1",
                        "status": "published" if self.publication_polls >= 2 else "publishing",
                        "provider_url": "https://www.instagram.com/reel/abc123/",
                    }
                ],
            }

        if path.startswith("/api/v1/analytics/export"):
            return 200, self.analytics_rows

        if path.endswith("/api/v1/engagement") and method == "GET":
            return 200, {"items": [{"id": "eng_1", "kind": "comment", "body": "part 2??"}]}

        if path.endswith("/actions") and method == "POST":
            return 200, {"job_id": "job_9", "status": "queued"}

        return 404, {"detail": f"no fake route for {method} {path}"}


def _serve(fake: _FakeOpenPost) -> tuple[ThreadingHTTPServer, str]:
    class Handler(BaseHTTPRequestHandler):
        def _dispatch(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            path = self.path.split("?")[0]
            is_storage_target = (
                "/media/upload/" in path and "upload-session" not in path
            ) or not path.startswith("/api/v1")
            if is_storage_target:
                fake.upload_headers = {k.lower(): v for k, v in self.headers.items()}
                fake.requests.append({"method": self.command, "path": path, "body": {}})
                status, payload = 200, {"ok": True}
            else:
                status, payload = fake.handle(self, self.command, self.path, raw)
            data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PUT = _dispatch

        def log_message(self, *args: Any) -> None:  # keep pytest output clean
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host, port = server.server_address
    return server, f"http://{host}:{port}"


@pytest.fixture()
def fake():
    state = _FakeOpenPost()
    server, base_url = _serve(state)
    state.base_url = base_url  # type: ignore[attr-defined]
    yield state
    server.shutdown()
    server.server_close()


def _client(fake: _FakeOpenPost, token: str = "op_test") -> OpenPostClient:
    return OpenPostClient(
        OpenPostConfig(base_url=fake.base_url, token=token, workspace_id="ws_1"),  # type: ignore[attr-defined]
        timeout=5,
    )


# --------------------------------------------------------------------- tests


def test_health_needs_no_token(fake):
    client = OpenPostClient(OpenPostConfig(base_url=fake.base_url, token=""), timeout=5)  # type: ignore[attr-defined]
    assert client.health()["status"] == "ok"


def test_upload_deduped_skips_transfer(fake):
    fake.deduped = True
    assert _client(fake).upload_media(__file__) == "media_existing"
    assert [r["path"] for r in fake.requests] == ["/api/v1/media/upload-session"]


def test_upload_runs_three_steps_and_never_leaks_token_to_storage(fake):
    media_id = _client(fake).upload_media(__file__, alt_text="frame")

    assert media_id == "media_new"
    paths = [r["path"] for r in fake.requests]
    assert paths == [
        "/api/v1/media/upload-session",
        "/api/v1/media/upload/media_new",
        "/api/v1/media/upload-session/media_new/complete",
    ]
    # A relative upload target is an OpenPost endpoint, so the token is expected.
    assert fake.upload_headers.get("authorization") == "Bearer op_test"
    session = fake.requests[0]["body"]
    assert session["workspace_id"] == "ws_1"
    assert session["size"] > 0


def test_external_upload_target_gets_no_bearer_token(fake):
    """Storage targets are third-party: the workspace token must not travel there."""
    fake.external_upload = True
    _client(fake).upload_media(__file__)

    assert "authorization" not in fake.upload_headers
    assert fake.upload_headers.get("x-storage-token") == "s3cr3t"


def test_publish_reel_pins_reel_profile_and_expected_revision(fake):
    fake.publication_polls = 5  # already published on the first poll
    publication = _client(fake).publish_reel(
        __file__, caption="The lease did not close.", account_ids=["acc_ig"]
    )

    create = next(r for r in fake.requests if r["path"] == "/api/v1/publications")
    assert create["body"]["content_profile"] == "short_video"
    assert create["body"]["media"] == [{"media_id": "media_new"}]
    assert create["body"]["renditions"][0]["output_profile"] == "instagram.reel"
    assert create["body"]["renditions"][0]["format_locked"] is True

    publish = next(r for r in fake.requests if r["path"].endswith("/publish-now"))
    assert publish["body"] == {"expected_revision": 3}
    assert publication["renditions"][0]["status"] == "published"


def test_revision_conflict_surfaces_the_status_code(fake):
    fake.publish_conflict = True
    with pytest.raises(OpenPostError) as excinfo:
        _client(fake).publish_reel(__file__, caption="x", account_ids=["acc_ig"])
    assert excinfo.value.status == 409
    assert excinfo.value.code == "revision_conflict"


def test_invalid_publication_is_not_published(fake):
    fake.validation_issues = [{"code": "reel_needs_video"}]
    with pytest.raises(OpenPostError):
        _client(fake).publish_reel(__file__, caption="x", account_ids=["acc_ig"])


def test_reply_reuses_the_operation_id_on_retry(fake):
    client = _client(fake)
    client.reply("eng_1", "Part 2 drops tomorrow.", client_operation_id="op-abc")
    body = fake.requests[-1]["body"]
    assert body["action"] == "reply"
    assert body["message"] == "Part 2 drops tomorrow."
    assert body["client_operation_id"] == "op-abc"
    assert body["workspace_id"] == "ws_1"


def test_analytics_keeps_blank_metrics_blank(fake):
    rows = _client(fake).analytics(days=7, platforms=["instagram"])
    assert rows[1]["Views"] == ""  # missing stays missing; never coerced to zero
    query = fake.requests[-1]["path"]
    assert "days=7" in query and "platforms=instagram" in query and "dataset=posts" in query


def test_tool_returns_failure_instead_of_raising(monkeypatch):
    monkeypatch.delenv("OPENPOST_BASE_URL", raising=False)
    result = OpenPostPublisher().execute({"operation": "health"})
    assert result.success is False
    assert "OPENPOST_BASE_URL" in (result.error or "")


# ------------------------------------------------------------------- doctor


def _checks(fake) -> dict[str, dict[str, Any]]:
    client = _client(fake)
    return {c["check"]: c for c in run_doctor(client)}


def test_doctor_reports_incomplete_when_analytics_and_inbox_are_off(fake):
    fake.enabled_features = []  # everything is connected, nothing is switched on
    checks = _checks(fake)

    assert checks["instance reachable"]["ok"] is True
    assert checks["token valid"]["ok"] is True
    assert checks["accounts connected"]["ok"] is True
    assert checks["analytics enabled"]["ok"] is False
    assert "missing_scope" in checks["analytics enabled"]["detail"]
    assert checks["inbox enabled"]["ok"] is False
    assert all(c["ok"] for c in checks.values()) is False


def test_doctor_passes_when_every_feature_is_enabled(fake):
    fake.enabled_features = ["analytics", "engagement"]
    checks = _checks(fake)
    assert all(c["ok"] for c in checks.values()), [
        c for c in checks.values() if not c["ok"]
    ]


def test_doctor_stops_early_when_the_instance_is_unreachable():
    client = OpenPostClient(OpenPostConfig(base_url="http://127.0.0.1:1", token="t"), timeout=1)
    checks = run_doctor(client)
    assert [c["check"] for c in checks] == ["instance url", "instance reachable"]
    assert checks[-1]["ok"] is False
    assert "docker compose up -d" in checks[-1]["fix"]
