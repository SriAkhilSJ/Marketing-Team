# OpenPost — publishing, measurement, and replies

OpenPost ([`getopenpost/openpost`](https://github.com/getopenpost/openpost)) is the
**distribution half** of the Content Manager. It is not a generator: it never draws a
frame, voices a line, or invents a script. This repo's video tools do that. OpenPost
takes the finished render and answers the three questions that come after it:

1. **Did it go out?** — publications and per-destination renditions across the
   connected networks, with a provider URL and an error field per rendition.
2. **How did it do?** — stored per-post measurements exported as JSON/CSV.
3. **What did people say?** — comments, mentions and reviews, with receipts so a
   reply retry cannot post twice.

That is the loop this repo was missing. `tools/publishers/export_bundle.py` packages a
render for hand-off; `tools/publishers/social_media_publisher.py` posts to Meta with a
token you own. OpenPost is the option when you want many networks, stored analytics and
an inbox without writing a publisher per platform.

```
render ──> upload ──> publication ──> validate ──> publish / schedule
                                              │
                    analytics export <────────┴────────> engagement inbox
                             │                                    │
                    next episode's brief                    approved replies
```

---

## 1. Run an instance

Self-hosted is a single compose stack:

```bash
git clone https://github.com/getopenpost/openpost
cd openpost
docker compose up -d
# web UI + API on http://localhost:8080
```

Hosted works too, with a different base URL — the API is identical:

```
https://app.openpo.st/api/v1
```

Then connect the accounts you actually post from in **Settings → Workspace → Social
accounts**, and enable **Analytics** and **Inbox activity** per account. Those are
separate switches: a connected account can publish while analytics stay off, and the
export will simply have no rows for it.

> **Port clash:** OpenPost self-host defaults to `:8080`. If something else in your
> stack already listens there (a preview server, for example), change one of them
> before debugging phantom 404s.

## 2. Create a token

**Settings → Personal → Developer → create token.**

- `api:read` for analytics and inbox reads.
- `api:write` for publications, uploads and replies.
- Bind the token to one workspace, give it an expiry, and keep one token per
  integration. A `401` means missing/expired/revoked; a `403` means the token is valid
  but lacks the scope, workspace, or plan for that operation.

```bash
export OPENPOST_BASE_URL=http://127.0.0.1:8080
export OPENPOST_TOKEN=op_...
export OPENPOST_WORKSPACE_ID=ws_...        # from `... workspaces`
```

Tokens belong in `.env` or a secret store — never in a composition file or a commit.

## 3. Use it

```bash
# is it up, and which workspaces can this token see?
python3 -m tools.publishers.openpost health
python3 -m tools.publishers.openpost accounts

# publish a render, pinned to the reel format
python3 -m tools.publishers.openpost publish renders/ep01.mp4 \
    --caption "Six hundred years of darkness, and he still can't fold a croissant." \
    --account acc_instagram --account acc_facebook \
    --profile instagram.reel

# schedule instead of publishing now (RFC 3339, future)
python3 -m tools.publishers.openpost publish ep01.mp4 --caption "..." \
    --account acc_instagram --scheduled-at 2026-10-27T18:30:00Z

# what happened
python3 -m tools.publishers.openpost status pub_...
python3 -m tools.publishers.openpost analytics --days 7 --out analytics.json
python3 -m tools.publishers.openpost inbox --kind comment --unread
python3 -m tools.publishers.openpost reply eng_... --message "Part 2 drops tomorrow."
```

From Python:

```python
from tools.publishers.openpost import OpenPostConfig, OpenPostClient

client = OpenPostClient(OpenPostConfig.from_env())

publication = client.publish_reel(
    "projects/demon-lords-bakery/renders/ep01.mp4",
    caption="The underworld closed. The lease did not.",
    account_ids=["acc_instagram", "acc_facebook"],
    output_profile="instagram.reel",
)
print(publication["renditions"][0]["provider_url"])

rows = client.analytics(days=7, dataset="posts")
```

Or through the tool registry, which is how a pipeline stage should call it:

```python
from tools.publishers.openpost import OpenPostPublisher

result = OpenPostPublisher().execute({
    "operation": "publish",
    "video_path": "projects/demon-lords-bakery/renders/ep01.mp4",
    "caption": "The underworld closed. The lease did not.",
    "account_ids": ["acc_instagram"],
})
assert result.success, result.error
```

`operation` accepts `health`, `publish`, `status`, `analytics`, `engagement`, `reply`.
A failed call returns `ToolResult(success=False, error=...)` — it does not raise.

---

## 4. The API facts that matter

These are the things that cost a debugging session when you assume them:

| Topic | Reality |
|---|---|
| **Publication vs rendition** | A *publication* is the post; a *rendition* is its per-account version. `social_account_ids` creates default renditions; `renditions[].output_profile` pins the format. |
| **Reels** | `output_profile: "instagram.reel"`, `content_profile: "short_video"`. Reels are **not** text-card converted, even if the account defaults to `text_card: always`. |
| **Publishing** | `POST /publications/{id}/publish-now` with `{"expected_revision": n}`. A `409` means the publication changed — re-read it, never retry the stale revision. |
| **Scheduling** | Set `scheduled_at` (future, RFC 3339) at create/update time, then `POST /publications/{id}/schedule` with the latest revision. The job stays pending until then — do not block a render pipeline waiting on it. |
| **Uploads** | Three calls: create session → send bytes → complete. `deduped: true` means the bytes already exist — use `media_id` and skip steps 2–3. |
| **Upload security** | An **absolute** upload URL is third-party storage: never send the OpenPost bearer token to it. A **relative** URL is an OpenPost endpoint and does take the token. |
| **Analytics** | `GET /analytics/export`. Stored data, not live — a blank cell means *missing*, never zero. Never average a blank into a decision. Durations are stored in ms and percentages in basis points. |
| **Replies** | `POST /engagement/{id}/actions` with a `client_operation_id`. Reuse the same id when retrying; the server's receipt prevents a duplicate public comment. |
| **Reading inbox** | `GET /engagement?kind=comment|mention|review` reads saved activity only. It never triggers a provider fetch — that is `POST /engagement/refresh`. |

## 5. Using the numbers to steer the next episode

The point of connecting analytics is not a dashboard; it is a smaller decision next time.
The rule that keeps this honest:

1. Pull `dataset=posts` for the last 7–30 days.
2. Drop every row with a blank metric you care about — missing is not zero.
3. Compare **like with like**: same format, same account, comparable age. A reel posted
   two hours ago is not evidence about a reel posted last week.
4. Turn the surviving signal into one change for the next brief — a hook style, a beat
   length, a posting window — not five.
5. Record which change you made, so the next comparison has a control.

Anything more elaborate is guessing with extra steps.

## 6. What OpenPost does not do

- It does not generate or edit the video. You give it a file.
- It does not make every provider equal: publishing support does not imply analytics,
  inbox, or reply support for that platform. Enable each per account and test it.
- It does not refresh provider data on a schedule you control; collection is its own
  job, and a provider may revise a number after publication.

## 7. Tests

`tests/tools/test_openpost_client.py` runs against a local fake server — no instance,
no token, no network:

```bash
python3 -m pytest tests/tools/test_openpost_client.py -q
```

It pins the wire format: three-step upload, dedupe short-circuit, no bearer token on
external storage, `expected_revision` on publish, `instagram.reel` renditions,
`client_operation_id` on replies, and blank analytics staying blank.
