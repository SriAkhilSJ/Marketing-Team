"""OpenMontage 9:16 Anime Hook-to-Suspense Reel Generator (LLM + Free Edge-TTS + Pillow/FFmpeg).

Generates serialized ``Part 1 / Part 2 / Part 3`` 9:16 vertical (1080x1920) Anime / Suspense
Reels into ``projects/<project_id>/renders/final.mp4`` using:
1. Any OpenAI-compatible LLM key (``OPENAI_API_KEY`` / ``VELONA_API_KEY`` + ``OPENAI_BASE_URL``)
   with automatic high-retention Hook-to-Suspense Script Doctor fallback when no LLM key is set.
2. Free Microsoft Edge Neural TTS (``edge-tts``) with automatic FFmpeg synth audio fallback.
3. 4-Beat Procedural Anime / Manhwa Visual Renderer (1080x1920 @ 24fps):
   - Beat 1 (0–3s): THE HOOK — Manga speed-lines, glowing crimson/cyan aura, PART badge, dramatic hook title.
   - Beat 2 (3–6s): RISING TENSION — Dark fantasy dungeon / cyber-shonen parallax skyline + energy particles.
   - Beat 3 (6–9s): THE TWIST — Split-panel manga awakening / forbidden power surge + waveform HUD.
   - Beat 4 (9–12s): CLIFFHANGER — "TO BE CONTINUED IN PART N+1" + Comment Keyword Trigger CTA.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
PROJECTS_DIR = REPO_ROOT / "projects"


def _load_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]
        if bold
        else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
    )
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def generate_anime_script_via_llm(
    topic: str,
    part_number: int = 1,
    total_parts: int = 3,
    keyword: str = "LINK",
) -> dict[str, Any]:
    """Generate a 4-beat Hook-to-Suspense Anime Reel script using an OpenAI-compatible LLM or smart fallback."""
    api_key = (
        os.environ.get("OPENAI_API_KEY")
        or os.environ.get("VELONA_API_KEY")
        or ""
    ).strip()
    base_url = (
        os.environ.get("OPENAI_BASE_URL")
        or os.environ.get("VELONA_BASE_URL")
        or "https://velona.in/v1"
    ).strip().rstrip("/")
    model = (
        os.environ.get("OPENAI_MODEL")
        or os.environ.get("VELONA_MODEL")
        or "deepseek/deepseek-v4-flash"
    ).strip()

    next_part = min(part_number + 1, total_parts)
    if api_key:
        prompt = (
            f"Write a high-retention 9:16 Anime / Manhwa short video script for Topic: '{topic}' "
            f"(Episode Part {part_number} of {total_parts}). "
            f"Return ONLY valid JSON with keys: "
            f"title (string, max 55 chars), "
            f"caption (string, suspenseful 2-sentence summary), "
            f"hashtags (array of 6 strings without #), "
            f"beats (array of 4 objects, each with: beat_type ['HOOK','TENSION','TWIST','CLIFFHANGER'], "
            f"headline [string, max 28 chars, ALL CAPS], "
            f"subtext [string, max 48 chars], "
            f"narration [string, 12-16 words spoken voiceover]). "
            f"Beat 4 MUST end on an unresolved cliffhanger teasing Part {next_part} and telling viewers to comment '{keyword}'."
        )
        try:
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You are an elite viral Anime & Manhwa short-drama scriptwriter. Output strict JSON only."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.7,
                },
                timeout=25,
            )
            if resp.ok:
                content = resp.json()["choices"][0]["message"]["content"]
                content = re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
                match = re.search(r"\{[\s\S]*\}", content)
                if match:
                    parsed = json.loads(match.group(0))
                    if isinstance(parsed.get("beats"), list) and len(parsed["beats"]) >= 4:
                        return parsed
        except Exception:
            pass

    # Deterministic Hook-to-Suspense Anime Script Doctor Fallback
    clean_topic = topic.strip() or "The E-Rank Hunter Who Awakened the Forbidden Shadow"
    short_title = clean_topic[:52]
    return {
        "title": short_title,
        "caption": (
            f"Everyone mocked him at the awakening altar—until the ancient seal shattered in Part {part_number}. "
            f"What happens when the S-Rank Guild realizes who he really is?"
        ),
        "hashtags": ["anime", "manhwa", "animeshorts", "darkfantasy", f"part{part_number}", "reels"],
        "beats": [
            {
                "beat_type": "HOOK",
                "headline": "ZERO MANA DETECTED?!",
                "subtext": f"PART {part_number}/{total_parts} • {short_title[:34].upper()}",
                "narration": f"Part {part_number}. Every guild laughed when the crystal registered zero mana.",
            },
            {
                "beat_type": "TENSION",
                "headline": "THE DUNGEON SEAL BROKE",
                "subtext": "S-RANK BOSS EMERGED FROM THE ABYSS",
                "narration": "Then the double-dungeon gates locked shut, and the statue's eyes turned blood red.",
            },
            {
                "beat_type": "TWIST",
                "headline": "SYSTEM AWAKENING: SHADOW",
                "subtext": "SECRET CLASS UNLOCKED AT 0.01 SECONDS",
                "narration": "A hidden screen appeared before his eyes: Will you accept the Forbidden Monarch contract?",
            },
            {
                "beat_type": "CLIFFHANGER",
                "headline": f"FOLLOW FOR PART {next_part}",
                "subtext": f"COMMENT '{keyword}' FOR EARLY ACCESS + LINK",
                "narration": f"Just as his shadow stood up on its own—cut to black. Follow for Part {next_part} and comment {keyword} below!",
            },
        ],
    }


async def _synthesize_edge_tts(text: str, out_mp3: Path, voice: str = "en-US-ChristopherNeural") -> bool:
    try:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice, rate="+8%")
        await communicate.save(str(out_mp3))
        return out_mp3.is_file() and out_mp3.stat().st_size > 1000
    except Exception:
        return False


def _ensure_audio_track(narration_text: str, out_audio: Path, target_duration: float = 12.0, voice: str = "en-US-ChristopherNeural") -> float:
    """Synthesize Edge-TTS voiceover mixed with dark anime sub-bass ambience, or fallback to synth audio."""
    raw_tts = out_audio.parent / "tts_raw.mp3"
    ok = False
    try:
        ok = asyncio.run(_synthesize_edge_tts(narration_text, raw_tts, voice=voice))
    except Exception:
        ok = False

    if ok:
        # Probe actual TTS duration
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(raw_tts)],
            capture_output=True,
            text=True,
        )
        try:
            dur = max(8.0, min(20.0, float(probe.stdout.strip()) + 0.8))
        except Exception:
            dur = target_duration

        # Mix voiceover with subtle cinematic dark-anime drone + hook impact hit
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(raw_tts),
                "-f", "lavfi", "-i", f"sine=frequency=65:duration={dur}",
                "-filter_complex",
                f"[0:a]apad=whole_dur={dur},volume=1.35[v];[1:a]volume=0.06,afade=t=out:st={dur-1.5}:d=1.5[bg];[v][bg]amix=inputs=2:duration=first[out]",
                "-map", "[out]",
                "-c:a", "aac", "-b:a", "192k",
                str(out_audio),
            ],
            check=False,
        )
        if out_audio.is_file() and out_audio.stat().st_size > 500:
            return dur

    # Pure FFmpeg cinematic dark-synth fallback
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "lavfi",
            "-i", f"aevalsrc=0.12*sin(2*PI*110*t)+0.08*sin(2*PI*220*t)*exp(-2*mod(t,3)):s=44100:d={target_duration}",
            "-c:a", "aac", "-b:a", "128k",
            str(out_audio),
        ],
        check=True,
    )
    return target_duration


def _wrap_text(text: str, max_chars: int = 26) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= max_chars:
            cur = f"{cur} {w}".strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:3]


def render_anime_reel_project(
    topic: str,
    part_number: int = 1,
    total_parts: int = 3,
    keyword: str = "LINK",
    voice: str = "en-US-ChristopherNeural",
    project_id: str | None = None,
) -> dict[str, Any]:
    """Render a complete 9:16 Anime Hook-to-Suspense Reel MP4 into projects/<project_id>/renders/final.mp4."""
    slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:28] or "anime-ep"
    pid = project_id or f"{slug}-part{part_number}-{int(time.time()) % 100000}"
    project_dir = PROJECTS_DIR / pid
    renders_dir = project_dir / "renders"
    artifacts_dir = project_dir / "artifacts"
    frames_dir = project_dir / ".frames"
    for d in (renders_dir, artifacts_dir, frames_dir):
        d.mkdir(parents=True, exist_ok=True)

    script_data = generate_anime_script_via_llm(
        topic=topic,
        part_number=part_number,
        total_parts=total_parts,
        keyword=keyword,
    )

    # Write OpenMontage project.json and script.json so Backlot displays the production live
    (project_dir / "project.json").write_text(
        json.dumps(
            {
                "project_id": pid,
                "title": f"[Part {part_number}/{total_parts}] {script_data['title']}",
                "pipeline_type": "animation",
                "style": "anime-ghibli",
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    (artifacts_dir / "script.json").write_text(json.dumps(script_data, indent=2), encoding="utf-8")

    beats = script_data["beats"][:4]
    full_narration = " ".join(b.get("narration", "") for b in beats)
    audio_path = project_dir / "voiceover.m4a"
    duration = _ensure_audio_track(full_narration, audio_path, target_duration=12.0, voice=voice)

    fps = 24
    total_frames = int(round(duration * fps))
    frames_per_beat = max(1, total_frames // 4)

    font_badge = _load_font(34, bold=True)
    font_headline = _load_font(62, bold=True)
    font_sub = _load_font(32, bold=False)
    font_caption = _load_font(42, bold=True)

    # Palettes per beat (Crimson Hook -> Abyss Blue Tension -> Violet Awakening Twist -> Gold Cliffhanger)
    palettes = [
        ((10, 8, 18), (255, 46, 99), (0, 245, 212)),
        ((6, 12, 28), (0, 180, 255), (120, 90, 255)),
        ((16, 6, 30), (199, 75, 255), (255, 215, 0)),
        ((18, 8, 12), (255, 184, 0), (255, 46, 99)),
    ]

    W, H = 1080, 1920
    for f_idx in range(total_frames):
        beat_idx = min(3, f_idx // frames_per_beat)
        beat = beats[beat_idx]
        local_t = (f_idx % frames_per_beat) / max(1, frames_per_beat)
        bg_col, accent_col, sec_col = palettes[beat_idx]

        img = Image.new("RGB", (W, H), bg_col)
        draw = ImageDraw.Draw(img)

        # 1. Manga speed-lines / radial energy rays from center
        cx, cy = W // 2, int(H * 0.42)
        for ray in range(0, 360, 12):
            ang = math.radians(ray + f_idx * 1.8)
            r_inner = 180 + int(40 * math.sin(local_t * math.pi * 2 + ray))
            r_outer = 980
            x1 = cx + int(r_inner * math.cos(ang))
            y1 = cy + int(r_inner * math.sin(ang))
            x2 = cx + int(r_outer * math.cos(ang))
            y2 = cy + int(r_outer * math.sin(ang))
            col = accent_col if (ray // 12) % 2 == 0 else sec_col
            dim_col = (col[0] // 4, col[1] // 4, col[2] // 4)
            draw.line([(x1, y1), (x2, y2)], fill=dim_col, width=3)

        # 2. Concentric Anime Awakening Aura Rings + Silhouette Emblem
        for ring in range(4):
            rad = int(130 + ring * 58 + (local_t * 45))
            ring_col = accent_col if ring % 2 == 0 else sec_col
            draw.ellipse(
                [cx - rad, cy - rad, cx + rad, cy + rad],
                outline=ring_col,
                width=4 if ring == 0 else 2,
            )

        # Glowing Anime Eyes / Awakening Crest inside the core
        eye_y = cy - 12
        glow_pulse = int(8 * math.sin(f_idx * 0.4))
        draw.polygon(
            [(cx - 95, eye_y), (cx - 35, eye_y - 22 - glow_pulse), (cx - 25, eye_y + 10)],
            fill=accent_col,
        )
        draw.polygon(
            [(cx + 95, eye_y), (cx + 35, eye_y - 22 - glow_pulse), (cx + 25, eye_y + 10)],
            fill=accent_col,
        )

        # 3. Floating Ember / Mana Particles
        for p in range(22):
            px = int((p * 173 + f_idx * (4 + (p % 3))) % (W - 120)) + 60
            py = int((H * 0.85 - ((p * 211 + f_idx * (9 + (p % 5))) % int(H * 0.75))))
            pr = 3 + (p % 5)
            p_col = accent_col if p % 2 == 0 else sec_col
            draw.ellipse([px - pr, py - pr, px + pr, py + pr], fill=p_col)

        # 4. Top Episodic Badge Bar
        draw.rounded_rectangle([70, 95, W - 70, 175], radius=18, fill=(22, 22, 34), outline=accent_col, width=3)
        badge_text = f"⚡ EPISODE PART {part_number} OF {total_parts}  •  {beat.get('beat_type', 'SCENE')}"
        draw.text((105, 118), badge_text, fill=(255, 255, 255), font=font_badge)

        # 5. Manga Impact Headline Box (Middle-Lower)
        headline_lines = _wrap_text(str(beat.get("headline", "")).upper(), max_chars=20)
        box_top = 1030
        box_bottom = box_top + 90 + len(headline_lines) * 76
        draw.rounded_rectangle(
            [65, box_top, W - 65, box_bottom],
            radius=22,
            fill=(14, 14, 24),
            outline=accent_col,
            width=4,
        )
        y_cursor = box_top + 28
        for line in headline_lines:
            draw.text((100, y_cursor), line, fill=accent_col, font=font_headline)
            y_cursor += 74

        sub_line = str(beat.get("subtext", ""))[:46]
        draw.text((100, box_bottom - 48), sub_line, fill=(210, 215, 230), font=font_sub)

        # 6. Word-Synced Karaoke Subtitle Strip (Bottom Safe Area)
        narration = str(beat.get("narration", ""))
        words = narration.split()
        if words:
            active_word_idx = min(len(words) - 1, int(local_t * len(words)))
            window_start = max(0, (active_word_idx // 5) * 5)
            window_words = words[window_start : window_start + 5]
            sub_y = 1520
            draw.rounded_rectangle(
                [70, sub_y - 25, W - 70, sub_y + 95],
                radius=20,
                fill=(8, 8, 14),
                outline=(80, 85, 110),
                width=2,
            )
            x_cursor = 105
            for w_i, word in enumerate(window_words):
                is_active = (window_start + w_i) == active_word_idx
                w_col = (255, 230, 0) if is_active else (245, 245, 250)
                draw.text((x_cursor, sub_y + 12), word, fill=w_col, font=font_caption)
                x_cursor += max(75, len(word) * 28 + 26)

        # 7. Progress Bar at very bottom
        prog_w = int((W - 140) * ((f_idx + 1) / total_frames))
        draw.rectangle([70, 1790, W - 70, 1806], fill=(35, 35, 50))
        draw.rectangle([70, 1790, 70 + prog_w, 1806], fill=accent_col)

        frame_file = frames_dir / f"frame_{f_idx:04d}.jpg"
        img.save(frame_file, "JPEG", quality=88)

    output_mp4 = renders_dir / "final.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-framerate", str(fps),
            "-i", str(frames_dir / "frame_%04d.jpg"),
            "-i", str(audio_path),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            str(output_mp4),
        ],
        check=True,
    )

    # Clean up intermediate JPEGs
    for f in frames_dir.glob("*.jpg"):
        try:
            f.unlink()
        except Exception:
            pass
    try:
        frames_dir.rmdir()
    except Exception:
        pass

    return {
        "project_id": pid,
        "video_path": str(output_mp4),
        "media_url": f"/media/{pid}/renders/final.mp4",
        "title": script_data["title"],
        "description": script_data["caption"],
        "hashtags": script_data["hashtags"],
        "beats": beats,
        "duration_seconds": round(duration, 2),
        "part_number": part_number,
        "total_parts": total_parts,
    }
