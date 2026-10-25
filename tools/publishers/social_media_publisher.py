"""Social Media Publisher (Instagram + Facebook + Monetization Engine) — PUBLISH-tier tool.

Integrates ``social-media-posters`` (``post-to-instagram/post_to_instagram_via_fb.py``,
``post-to-facebook/post_to_facebook.py``, and the unified ``social`` CLI) directly into
OpenMontage's ``publish`` stage with:

1. **Single-Token Meta Auto-Discovery**:
   Given only ``FB_ACCESS_TOKEN`` (or ``META_ACCESS_TOKEN``), automatically discovers
   your Facebook Page ID (``FB_PAGE_ID``), Page Access Token, and linked Instagram
   Business Account ID (``IG_USER_ID``) via Meta Graph API v25.0.
2. **Instagram Reels + Facebook Page Dual Publishing**:
   - Uploads **local `.mp4` video files** directly to Instagram Reels using Facebook's
     resumable upload infrastructure (``rupload.facebook.com`` via ``InstagramFBAPI``),
     OR publishes publicly hosted video URLs (``video_url``).
   - Uploads **local `.mp4` video files** or hosted video URLs to your Facebook Page
     via ``post_to_facebook.upload_video``.
3. **Episodic Hook-to-Suspense & Monetization Engine**:
   - Formats serialized ``Part 1 / Part 2 / Part 3`` cliffhanger captions and
     high-retention comment-trigger hooks (e.g. ``Comment "LINK" or "PART2" below``).
   - **First-Comment Link Drop (``link_in_comment``)**: Posts your affiliate / product /
     monetization URL as the **first comment** on both the published Instagram Reel and
     Facebook video so the main post avoids algorithm reach suppression.
   - **Comment Keyword Auto-Responder (``engage_comments``)**: Scans recent comments on
     Instagram Reels and Facebook posts for trigger keywords (``LINK``, ``PART2``,
     ``ANIME``, ``PRICE``, ``HOW``) and automatically replies with your monetization CTA + URL.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from tools.base_tool import (
    BaseTool,
    Determinism,
    ExecutionMode,
    ResourceProfile,
    ToolResult,
    ToolRuntime,
    ToolStability,
    ToolTier,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SOCIAL_POSTERS_DIR = REPO_ROOT / "social_media_posters"
for sub in ("common", "post-to-instagram", "post-to-facebook"):
    candidate = SOCIAL_POSTERS_DIR / sub
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

GRAPH_API_VERSION = "v25.0"
GRAPH_API_BASE_URL = f"https://graph.facebook.com/{GRAPH_API_VERSION}"


class SocialMediaPublisher(BaseTool):
    name = "social_media_publisher"
    version = "1.0.0"
    tier = ToolTier.PUBLISH
    capability = "publish"
    provider = "social_media_posters"
    stability = ToolStability.PRODUCTION
    execution_mode = ExecutionMode.SYNC
    determinism = Determinism.DETERMINISTIC
    runtime = ToolRuntime.API

    dependencies = ["requests"]
    optional_env_vars = [
        "FB_ACCESS_TOKEN",
        "META_ACCESS_TOKEN",
        "FB_PAGE_ID",
        "IG_USER_ID",
        "IG_ACCESS_TOKEN",
        "MONETIZATION_URL",
        "MONETIZATION_CTA",
        "MONETIZATION_KEYWORD",
    ]
    install_instructions = "pip install -e ./social_media_posters"

    agent_skills = []

    capabilities = [
        "publish_instagram_reel",
        "publish_facebook_video",
        "discover_meta_accounts",
        "monetize_first_comment",
        "auto_reply_keyword_comments",
        "write_publish_log",
    ]
    supports = {
        "local_offline": False,
        "free": True,
        "uploads": True,
        "instagram_reels": True,
        "facebook_page": True,
        "resumable_local_video_upload": True,
        "remote_video_url": True,
        "monetization_first_comment": True,
        "keyword_comment_autoreply": True,
    }
    best_for = [
        "auto-posting local MP4 Reels or cloud video URLs to Instagram and Facebook",
        "publishing serialized Part 1 / Part 2 / Part 3 anime or suspense Reels",
        "monetizing Reels via automatic first-comment affiliate/product link drops and keyword comment auto-replies",
    ]
    not_good_for = [
        "purely offline export packaging when no social publish is desired (use export_bundle instead)",
    ]

    input_schema = {
        "type": "object",
        "required": ["title"],
        "properties": {
            "operation": {
                "type": "string",
                "enum": ["publish", "discover_accounts", "engage_comments"],
                "default": "publish",
                "description": "Operation to run: 'publish' (post Reel to IG + FB + drop monetization comment), 'discover_accounts' (resolve FB Page + linked IG Business ID from FB_ACCESS_TOKEN), or 'engage_comments' (auto-reply to buyer/cliffhanger keywords with monetization link).",
            },
            "video_path": {
                "type": "string",
                "description": "Local path to the rendered .mp4 video OR a publicly accessible https:// video URL.",
            },
            "video_url": {
                "type": "string",
                "description": "Optional public https:// URL for the video (if hosted on cloud/CDN).",
            },
            "title": {
                "type": "string",
                "description": "Video / Reel title or hook headline.",
            },
            "description": {
                "type": "string",
                "description": "Main caption / story hook-to-suspense text.",
            },
            "hashtags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of hashtags (e.g. ['anime', 'reels', 'part1']).",
            },
            "platforms": {
                "type": "array",
                "items": {"type": "string", "enum": ["instagram", "facebook"]},
                "default": ["instagram", "facebook"],
                "description": "Target platforms to publish to.",
            },
            "part_number": {
                "type": "integer",
                "description": "Optional episode/part number (e.g., 1 for 'Part 1') to inject serialized suspense CTAs.",
            },
            "total_parts": {
                "type": "integer",
                "description": "Optional total number of parts in the series (e.g., 3 for 'Part 1/3').",
            },
            "monetization_url": {
                "type": "string",
                "description": "Affiliate, store, Patreon, or product URL to drop in the first comment and keyword replies (defaults to MONETIZATION_URL env var).",
            },
            "monetization_cta": {
                "type": "string",
                "description": "Call-to-action text for the monetization link comment.",
            },
            "monetization_keyword": {
                "type": "string",
                "description": "Trigger keyword viewers comment to receive the link/Part 2 (e.g. 'ANIME', 'PART2', 'LINK').",
            },
            "link_in_comment": {
                "type": "boolean",
                "default": True,
                "description": "Post monetization_url as the first comment on IG & FB to protect main-post organic reach.",
            },
            "engage_comments": {
                "type": "boolean",
                "default": True,
                "description": "Also scan recent IG/FB comments for trigger keywords and auto-reply with the monetization link.",
            },
            "scheduled_publish_time": {
                "type": "string",
                "description": "Optional schedule time in ISO 8601 or offset format ('+2h', '+1d').",
            },
            "dry_run": {
                "type": "boolean",
                "default": False,
                "description": "Simulate publishing and monetization without making live Graph API write calls.",
            },
        },
    }

    output_schema = {
        "type": "object",
        "properties": {
            "publish_log": {"type": "object"},
            "accounts": {"type": "object"},
            "monetization": {"type": "object"},
            "formatted_caption": {"type": "string"},
        },
    }

    resource_profile = ResourceProfile(
        cpu_cores=1, ram_mb=256, vram_mb=0, disk_mb=50, network_required=True
    )
    side_effects = [
        "uploads video to Instagram Reels and/or Facebook Page via Meta Graph API",
        "posts first-comment monetization link and replies to matching keyword comments",
    ]
    user_visible_verification = [
        "Check Instagram Reels and Facebook Page videos for the published Reel and first-comment monetization link",
    ]

    # ------------------------------------------------------------------
    # Credential & Account Auto-Discovery
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_credentials(inputs: dict[str, Any]) -> dict[str, str]:
        fb_token = (
            inputs.get("fb_access_token")
            or os.environ.get("FB_ACCESS_TOKEN")
            or os.environ.get("META_ACCESS_TOKEN")
            or ""
        ).strip()
        ig_token = (
            inputs.get("ig_access_token")
            or os.environ.get("IG_ACCESS_TOKEN")
            or fb_token
        ).strip()
        fb_page_id = (
            inputs.get("fb_page_id")
            or os.environ.get("FB_PAGE_ID")
            or ""
        ).strip()
        ig_user_id = (
            inputs.get("ig_user_id")
            or os.environ.get("IG_USER_ID")
            or ""
        ).strip()
        monetization_url = (
            inputs.get("monetization_url")
            or os.environ.get("MONETIZATION_URL")
            or os.environ.get("POST_LINK")
            or ""
        ).strip()
        monetization_cta = (
            inputs.get("monetization_cta")
            or os.environ.get("MONETIZATION_CTA")
            or "🔥 Grab the full Anime pack / exclusive link here:"
        ).strip()
        monetization_keyword = (
            inputs.get("monetization_keyword")
            or os.environ.get("MONETIZATION_KEYWORD")
            or "LINK"
        ).strip().upper()

        return {
            "fb_access_token": fb_token,
            "ig_access_token": ig_token,
            "fb_page_id": fb_page_id,
            "ig_user_id": ig_user_id,
            "monetization_url": monetization_url,
            "monetization_cta": monetization_cta,
            "monetization_keyword": monetization_keyword,
        }

    def discover_meta_accounts(
        self,
        fb_access_token: str,
        preferred_fb_page_id: str = "",
        preferred_ig_user_id: str = "",
    ) -> dict[str, Any]:
        """Auto-discover all Facebook Pages, Page Tokens, and linked Instagram Business Accounts.

        Handles the common setup where Instagram is linked to one Facebook Page while
        Facebook posts target either the same Page or a different Facebook Page under
        the same User Access Token.
        """
        if not fb_access_token:
            return {
                "discovered": False,
                "reason": "No FB_ACCESS_TOKEN provided",
            }
        try:
            resp = requests.get(
                f"{GRAPH_API_BASE_URL}/me/accounts",
                params={
                    "fields": "id,name,access_token,instagram_business_account{id,username,name,followers_count}",
                    "access_token": fb_access_token,
                },
                timeout=20,
            )
            payload = resp.json()
            pages = payload.get("data") or []
            if not pages:
                return {
                    "discovered": False,
                    "reason": payload.get("error", {}).get("message", "No Facebook Pages found on token"),
                }

            all_pages: list[dict[str, Any]] = []
            all_ig_accounts: list[dict[str, Any]] = []

            for page in pages:
                ig_acct = page.get("instagram_business_account") or {}
                all_pages.append(
                    {
                        "fb_page_id": page.get("id", ""),
                        "fb_page_name": page.get("name", ""),
                        "has_linked_instagram": bool(ig_acct.get("id")),
                        "ig_user_id": ig_acct.get("id", ""),
                        "ig_username": ig_acct.get("username", ""),
                    }
                )
                if ig_acct.get("id"):
                    all_ig_accounts.append(
                        {
                            "ig_user_id": ig_acct.get("id", ""),
                            "ig_username": ig_acct.get("username", ""),
                            "ig_name": ig_acct.get("name", ""),
                            "ig_followers_count": ig_acct.get("followers_count"),
                            "linked_via_fb_page_id": page.get("id", ""),
                            "linked_via_fb_page_name": page.get("name", ""),
                        }
                    )

            # 1. Pick the Facebook Page for Facebook publishing:
            #    - If preferred_fb_page_id (or FB_PAGE_NAME) is set, match that page
            #    - Otherwise prefer the page with a linked IG account, or fallback to pages[0]
            preferred_fb_name = (os.environ.get("FB_PAGE_NAME") or "").strip().lower()
            chosen_fb_page = pages[0]
            for page in pages:
                if preferred_fb_page_id and page.get("id") == preferred_fb_page_id:
                    chosen_fb_page = page
                    break
                if preferred_fb_name and preferred_fb_name in (page.get("name") or "").lower():
                    chosen_fb_page = page
                    break
            else:
                for page in pages:
                    if page.get("instagram_business_account"):
                        chosen_fb_page = page
                        break

            # 2. Pick the Instagram account (even if it is linked to a DIFFERENT Facebook Page!):
            chosen_ig_page = None
            for page in pages:
                ig_acct = page.get("instagram_business_account") or {}
                if not ig_acct.get("id"):
                    continue
                if preferred_ig_user_id and ig_acct.get("id") == preferred_ig_user_id:
                    chosen_ig_page = page
                    break
                if chosen_ig_page is None:
                    chosen_ig_page = page

            ig_acct = (chosen_ig_page or {}).get("instagram_business_account") or {}
            ig_page_token = (chosen_ig_page or {}).get("access_token") or fb_access_token

            return {
                "discovered": True,
                "fb_page_id": chosen_fb_page.get("id", ""),
                "fb_page_name": chosen_fb_page.get("name", ""),
                "fb_page_access_token": chosen_fb_page.get("access_token") or fb_access_token,
                "ig_user_id": ig_acct.get("id", ""),
                "ig_username": ig_acct.get("username", ""),
                "ig_followers_count": ig_acct.get("followers_count"),
                "ig_linked_fb_page_id": (chosen_ig_page or {}).get("id", ""),
                "ig_linked_fb_page_name": (chosen_ig_page or {}).get("name", ""),
                "ig_access_token": ig_page_token,
                "all_pages": all_pages,
                "all_instagram_accounts": all_ig_accounts,
            }
        except Exception as exc:
            return {
                "discovered": False,
                "reason": str(exc),
            }

    # ------------------------------------------------------------------
    # Hook-to-Suspense + Monetization Caption Builder
    # ------------------------------------------------------------------

    @staticmethod
    def build_viral_caption(
        title: str,
        description: str,
        hashtags: list[str],
        part_number: int | None,
        total_parts: int | None,
        monetization_keyword: str,
        monetization_url: str,
    ) -> str:
        lines: list[str] = []

        if part_number is not None:
            part_badge = (
                f"⚡ [PART {part_number}/{total_parts}]"
                if total_parts
                else f"⚡ [PART {part_number}]"
            )
            lines.append(f"{part_badge} {title}")
        else:
            lines.append(f"🔥 {title}")

        if description:
            lines.append("")
            lines.append(description.strip())

        # Suspense + Engagement Traction Trigger
        lines.append("")
        if part_number is not None and (not total_parts or part_number < total_parts):
            next_part = part_number + 1
            lines.append(
                f"👀 Wait until the last second... Follow right now so you don't miss PART {next_part}!"
            )
            lines.append(
                f"💬 Comment \"{monetization_keyword}\" or \"PART{next_part}\" below and I'll reply with early access + the link in the comments! 👇"
            )
        else:
            lines.append(
                f"💬 Comment \"{monetization_keyword}\" below and check the first comment for the full link! 👇"
            )

        if hashtags:
            clean_tags = [
                t if str(t).startswith("#") else f"#{str(t).lstrip('#')}"
                for t in hashtags
                if str(t).strip()
            ]
            if clean_tags:
                lines.append("")
                lines.append(" ".join(clean_tags))

        return "\n".join(lines).strip()

    # ------------------------------------------------------------------
    # Instagram & Facebook Publishing via social-media-posters
    # ------------------------------------------------------------------

    def _publish_instagram(
        self,
        *,
        video_source: str,
        caption: str,
        access_token: str,
        ig_user_id: str,
        monetization_url: str,
        monetization_cta: str,
        link_in_comment: bool,
        dry_run: bool,
    ) -> dict[str, Any]:
        if dry_run or not access_token or not ig_user_id:
            mode = "dry_run" if dry_run else "missing_credentials_preview"
            return {
                "platform": "instagram",
                "status": "draft",
                "video_id": f"ig_dryrun_{int(datetime.now(timezone.utc).timestamp())}",
                "url": f"https://www.instagram.com/reel/DRYRUN_{ig_user_id or 'IG'}/",
                "mode": mode,
                "first_comment": (
                    f"{monetization_cta} {monetization_url}".strip()
                    if link_in_comment and monetization_url
                    else None
                ),
            }

        from post_to_instagram_via_fb import InstagramFBAPI

        ig_api = InstagramFBAPI(access_token, ig_user_id)
        container_id = ig_api.upload_video_resumable(video_source, caption)
        if not ig_api.check_container_status(container_id):
            raise RuntimeError(f"Instagram media container {container_id} did not finish processing in time")

        media_id = ig_api.publish_media(container_id)
        permalink = ig_api.get_media_permalink(media_id) or f"https://www.instagram.com/p/{media_id}/"

        comment_id = None
        if link_in_comment and monetization_url:
            comment_text = f"{monetization_cta} {monetization_url}".strip()
            try:
                c_resp = requests.post(
                    f"{GRAPH_API_BASE_URL}/{media_id}/comments",
                    params={"access_token": access_token},
                    data={"message": comment_text},
                    timeout=30,
                )
                if c_resp.ok:
                    comment_id = c_resp.json().get("id")
            except Exception:
                comment_id = None

        return {
            "platform": "instagram",
            "status": "published",
            "video_id": str(media_id),
            "url": permalink,
            "first_comment_id": comment_id,
        }

    def _publish_facebook(
        self,
        *,
        video_source: str,
        title: str,
        caption: str,
        access_token: str,
        fb_page_id: str,
        monetization_url: str,
        monetization_cta: str,
        link_in_comment: bool,
        dry_run: bool,
    ) -> dict[str, Any]:
        if dry_run or not access_token or not fb_page_id:
            mode = "dry_run" if dry_run else "missing_credentials_preview"
            return {
                "platform": "facebook",
                "status": "draft",
                "video_id": f"fb_dryrun_{int(datetime.now(timezone.utc).timestamp())}",
                "url": f"https://www.facebook.com/{fb_page_id or 'PAGE'}/videos/DRYRUN/",
                "mode": mode,
                "first_comment": (
                    f"{monetization_cta} {monetization_url}".strip()
                    if link_in_comment and monetization_url
                    else None
                ),
            }

        from post_to_facebook import create_comment, get_post_permalink, upload_video

        post_id = upload_video(
            page_id=fb_page_id,
            video_path=video_source,
            description=caption,
            published=True,
            access_token=access_token,
            scheduled_publish_time=None,
            title=title,
        )
        permalink = get_post_permalink(post_id, access_token) or f"https://www.facebook.com/{post_id}"

        comment_id = None
        if link_in_comment and monetization_url and post_id:
            comment_text = f"{monetization_cta} {monetization_url}".strip()
            try:
                comment_id = create_comment(
                    fb_post_id=str(post_id),
                    message=comment_text,
                    link=monetization_url,
                    access_token=access_token,
                )
            except Exception:
                comment_id = None

        return {
            "platform": "facebook",
            "status": "published",
            "video_id": str(post_id),
            "url": permalink,
            "first_comment_id": comment_id,
        }

    # ------------------------------------------------------------------
    # Comment Keyword Auto-Responder (Monetization & Lead Capture)
    # ------------------------------------------------------------------

    def scan_and_monetize_comments(
        self,
        *,
        access_token: str,
        ig_user_id: str,
        fb_page_id: str,
        keyword: str,
        monetization_url: str,
        monetization_cta: str,
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Scan recent IG & FB comments for trigger keywords and auto-reply with the monetization link."""
        triggers = {
            keyword.upper(),
            "LINK",
            "PART 2",
            "PART2",
            "PART 3",
            "PART3",
            "ANIME",
            "PRICE",
            "HOW",
            "SOURCE",
        }
        reply_message = (
            f"{monetization_cta} {monetization_url}".strip()
            if monetization_url
            else f"{monetization_cta} — Follow our page for the next part!"
        )

        if dry_run or not access_token:
            return {
                "scanned": True,
                "mode": "dry_run" if dry_run else "missing_credentials_preview",
                "trigger_keywords": sorted(triggers),
                "reply_template": reply_message,
                "replies_sent": 0,
            }

        replies_sent: list[dict[str, str]] = []

        # 1. Scan recent Instagram media comments
        if ig_user_id:
            try:
                media_resp = requests.get(
                    f"{GRAPH_API_BASE_URL}/{ig_user_id}/media",
                    params={"fields": "id,caption,comments{id,text,username}", "limit": 5, "access_token": access_token},
                    timeout=20,
                )
                for media in media_resp.json().get("data", []):
                    for c in (media.get("comments") or {}).get("data", []):
                        text_upper = (c.get("text") or "").upper()
                        if any(tok in text_upper for tok in triggers):
                            r = requests.post(
                                f"{GRAPH_API_BASE_URL}/{c['id']}/replies",
                                params={"access_token": access_token},
                                data={"message": f"@{c.get('username', 'friend')} {reply_message}"},
                                timeout=20,
                            )
                            if r.ok:
                                replies_sent.append(
                                    {"platform": "instagram", "comment_id": c["id"], "reply_id": r.json().get("id", "")}
                                )
            except Exception:
                pass

        # 2. Scan recent Facebook Page post comments
        if fb_page_id:
            try:
                posts_resp = requests.get(
                    f"{GRAPH_API_BASE_URL}/{fb_page_id}/published_posts",
                    params={"fields": "id,comments{id,message,from}", "limit": 5, "access_token": access_token},
                    timeout=20,
                )
                for post in posts_resp.json().get("data", []):
                    for c in (post.get("comments") or {}).get("data", []):
                        text_upper = (c.get("message") or "").upper()
                        if any(tok in text_upper for tok in triggers):
                            r = requests.post(
                                f"{GRAPH_API_BASE_URL}/{c['id']}/comments",
                                params={"access_token": access_token},
                                data={"message": reply_message},
                                timeout=20,
                            )
                            if r.ok:
                                replies_sent.append(
                                    {"platform": "facebook", "comment_id": c["id"], "reply_id": r.json().get("id", "")}
                                )
            except Exception:
                pass

        return {
            "scanned": True,
            "mode": "live",
            "trigger_keywords": sorted(triggers),
            "reply_template": reply_message,
            "replies_sent": len(replies_sent),
            "details": replies_sent,
        }

    # ------------------------------------------------------------------
    # Main Tool Execution
    # ------------------------------------------------------------------

    def execute(self, inputs: dict[str, Any]) -> ToolResult:
        operation = inputs.get("operation", "publish")
        creds = self._resolve_credentials(inputs)
        dry_run = bool(inputs.get("dry_run", False))

        # Auto-discover FB Page ID & linked IG Business Account ID if needed
        discovered = {"discovered": False}
        if creds["fb_access_token"]:
            discovered = self.discover_meta_accounts(
                creds["fb_access_token"],
                preferred_fb_page_id=creds["fb_page_id"],
                preferred_ig_user_id=creds["ig_user_id"],
            )
            if discovered.get("discovered"):
                creds["fb_page_id"] = creds["fb_page_id"] or discovered.get("fb_page_id", "")
                creds["ig_user_id"] = creds["ig_user_id"] or discovered.get("ig_user_id", "")
                creds["fb_access_token"] = discovered.get("fb_page_access_token") or creds["fb_access_token"]
                creds["ig_access_token"] = discovered.get("ig_access_token") or creds["ig_access_token"] or creds["fb_access_token"]

        if operation == "discover_accounts":
            return ToolResult(
                success=True,
                data={
                    "accounts": {
                        **discovered,
                        "fb_page_id": creds["fb_page_id"],
                        "ig_user_id": creds["ig_user_id"],
                    }
                },
            )

        if operation == "engage_comments":
            monetization_report = self.scan_and_monetize_comments(
                access_token=creds["fb_access_token"],
                ig_user_id=creds["ig_user_id"],
                fb_page_id=creds["fb_page_id"],
                keyword=creds["monetization_keyword"],
                monetization_url=creds["monetization_url"],
                monetization_cta=creds["monetization_cta"],
                dry_run=dry_run,
            )
            return ToolResult(success=True, data={"monetization": monetization_report})

        # Default operation: publish
        video_source = (inputs.get("video_url") or inputs.get("video_path") or "").strip()
        if not video_source:
            return ToolResult(success=False, error="Either 'video_path' (local .mp4) or 'video_url' (https://) is required.")

        is_remote = video_source.startswith(("http://", "https://"))
        if not is_remote and not Path(video_source).expanduser().is_file():
            return ToolResult(success=False, error=f"Local video_path not found: {video_source}")

        title = inputs["title"]
        description = inputs.get("description", "")
        hashtags = inputs.get("hashtags", ["anime", "reels", "shorts", "viral"])
        platforms = inputs.get("platforms") or ["instagram", "facebook"]
        part_number = inputs.get("part_number")
        total_parts = inputs.get("total_parts")
        link_in_comment = bool(inputs.get("link_in_comment", True))

        formatted_caption = self.build_viral_caption(
            title=title,
            description=description,
            hashtags=hashtags,
            part_number=part_number,
            total_parts=total_parts,
            monetization_keyword=creds["monetization_keyword"],
            monetization_url=creds["monetization_url"],
        )

        timestamp = datetime.now(timezone.utc).isoformat()
        entries: list[dict[str, Any]] = []
        platform_results: dict[str, Any] = {}

        for platform in platforms:
            try:
                if platform == "instagram":
                    res = self._publish_instagram(
                        video_source=str(Path(video_source).expanduser()) if not is_remote else video_source,
                        caption=formatted_caption,
                        access_token=creds["ig_access_token"] or creds["fb_access_token"],
                        ig_user_id=creds["ig_user_id"],
                        monetization_url=creds["monetization_url"],
                        monetization_cta=creds["monetization_cta"],
                        link_in_comment=link_in_comment,
                        dry_run=dry_run,
                    )
                elif platform == "facebook":
                    res = self._publish_facebook(
                        video_source=str(Path(video_source).expanduser()) if not is_remote else video_source,
                        title=title,
                        caption=formatted_caption,
                        access_token=creds["fb_access_token"],
                        fb_page_id=creds["fb_page_id"],
                        monetization_url=creds["monetization_url"],
                        monetization_cta=creds["monetization_cta"],
                        link_in_comment=link_in_comment,
                        dry_run=dry_run,
                    )
                else:
                    continue

                platform_results[platform] = res
                entry: dict[str, Any] = {
                    "platform": platform,
                    "status": res["status"],
                    "timestamp": timestamp,
                    "url": res.get("url", ""),
                    "video_id": res.get("video_id", ""),
                    "visibility": "public",
                    "metadata_used": {
                        "title": title,
                        "description": formatted_caption,
                        "hashtags": hashtags,
                    },
                }
                entries.append(entry)
            except Exception as exc:
                entries.append(
                    {
                        "platform": platform,
                        "status": "failed",
                        "timestamp": timestamp,
                        "error": str(exc),
                        "metadata_used": {
                            "title": title,
                            "description": formatted_caption,
                            "hashtags": hashtags,
                        },
                    }
                )

        monetization_summary = {
            "monetization_url": creds["monetization_url"],
            "monetization_keyword": creds["monetization_keyword"],
            "link_in_comment": link_in_comment,
            "platform_results": platform_results,
        }

        if inputs.get("engage_comments", True):
            monetization_summary["comment_auto_responder"] = self.scan_and_monetize_comments(
                access_token=creds["fb_access_token"],
                ig_user_id=creds["ig_user_id"],
                fb_page_id=creds["fb_page_id"],
                keyword=creds["monetization_keyword"],
                monetization_url=creds["monetization_url"],
                monetization_cta=creds["monetization_cta"],
                dry_run=dry_run,
            )

        publish_log = {
            "version": "1.0",
            "entries": entries,
            "metadata": {
                "provider": "social_media_posters",
                "part_number": part_number,
                "total_parts": total_parts,
                "monetization": monetization_summary,
            },
        }

        try:
            from schemas.artifacts import validate_artifact

            validate_artifact("publish_log", publish_log)
        except Exception as exc:
            return ToolResult(success=False, error=f"publish_log failed schema validation: {exc}")

        return ToolResult(
            success=True,
            data={
                "publish_log": publish_log,
                "accounts": {
                    "fb_page_id": creds["fb_page_id"],
                    "ig_user_id": creds["ig_user_id"],
                    **discovered,
                },
                "monetization": monetization_summary,
                "formatted_caption": formatted_caption,
            },
        )
