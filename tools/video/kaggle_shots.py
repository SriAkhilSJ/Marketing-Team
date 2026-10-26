"""Compile an anime reel brief into a GPU shot list for the Kaggle render farm.

This module is deliberately dependency-free and CPU-only: it produces the
``shotlist.json`` that a Kaggle kernel feeds to ``wan_video`` / ``ltx_video_local``.
Keeping the prompts, geometry and seeds out of the kernel means the expensive GPU
cell stays a dumb loop, and the interesting part (art direction, continuity,
frame math) can be unit-tested on any laptop.

Every shot is true text-to-video generation.  Nothing here interpolates or pans
a still image — ``operation`` is ``text_to_video`` unless the caller explicitly
supplies a ``reference_image``, in which case that shot becomes ``image_to_video``.

Geometry is not free-form.  Wan's VAE needs frame counts on ``temporal * k + 1``
and both spatial dimensions on a multiple of 32, so the numbers are snapped here
rather than being left for the kernel to discover via a CUDA assert.

Usage::

    python -m tools.video.kaggle_shots --title "The Ashborn" --out shotlist.json
    python -m tools.video.kaggle_shots --out shotlist.json --check
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SHOTLIST_SCHEMA_VERSION = 1

# Render profiles.  A Kaggle T4 is 16GB but Turing, so it has no bf16 kernels and
# no fp8; 480x832 keeps a 97-frame clip inside the card with sequential offload.
# The hq profile trades ~3.4x the per-step cost for 704x1280.
PROFILES: dict[str, dict[str, Any]] = {
    "kaggle-t4-9x16": {
        "width": 480,
        "height": 832,
        "fps": 24,
        "steps": 20,
        "guidance": 5.0,
        "temporal_scale": 4,
        "spatial_alignment": 32,
        "description": "T4-safe vertical 9:16. ~7 min per 4s shot with sequential offload.",
    },
    "kaggle-t4-9x16-hq": {
        "width": 704,
        "height": 1280,
        "fps": 24,
        "steps": 30,
        "guidance": 5.0,
        "temporal_scale": 4,
        "spatial_alignment": 32,
        "description": "Near-native Wan vertical geometry. Long waits; watch the 30 GPU-h/week cap.",
    },
}

DEFAULT_PROFILE = "kaggle-t4-9x16"

# The style bible is repeated verbatim in every shot prompt.  Wan follows a short
# prompt more faithfully than a long one, so this is the part that must be
# consistent rather than verbose: it is what stops shot 4 from becoming CGI.
STYLE_BIBLE = (
    "1990s cel-shaded 2D anime, hand-inked line work, flat color with hard "
    "two-tone shadows, dramatic rim light, 24fps theatrical anime film, "
    "painted background art by hand, film grain"
)

# Identity tokens.  Character drift between independently generated shots is the
# single biggest failure mode of T2V anime, so these strings never change across
# a shot list; only the action clause does.
DEFAULT_CHARACTER_SHEET = (
    "one protagonist: sharp-featured teenager with messy ink-black hair, "
    "a crimson scarf and a torn grey travelling cloak, same character design "
    "in every shot"
)

ANIME_NEGATIVE_PROMPT = (
    "photorealistic, 3d render, cgi, live action, motion blur smear, "
    "extra fingers, deformed hands, warped face, text overlay, watermark, "
    "subtitle, logo, jump cut, static frame, oversaturated, low quality, "
    "compressed artifacts, multiple protagonists, different character"
)

# Four beats, matching the structure `tools/video/anime_reel_generator.py` already
# uses for 9:16 reels so a generated shot can drop into that timeline.
BEATS: tuple[dict[str, str], ...] = (
    {
        "id": "hook",
        "camera": "slow push-in, low angle, shallow depth of field",
        "action": "the protagonist snaps awake in a rain-soaked alley as crimson light floods in from off-screen",
        "motion": "rain falling, cloak whipping, embers drifting up past camera",
    },
    {
        "id": "rising",
        "camera": "tracking shot following from behind, handheld sway",
        "action": "the protagonist sprints through a collapsing stone corridor as the floor breaks apart behind them",
        "motion": "debris tumbling, dust clouds rolling, lanterns swinging",
    },
    {
        "id": "twist",
        "camera": "whip-pan to a tight close-up, then pull back fast",
        "action": "the protagonist's eyes ignite with white-hot power as the cloak burns away into ash",
        "motion": "aura flaring outward, ash spiralling upward, air distorting",
    },
    {
        "id": "cliffhanger",
        "camera": "static wide shot, slight crane down",
        "action": "a towering masked figure steps out of the smoke and raises one hand toward the protagonist",
        "motion": "smoke parting, cloak settling, embers orbiting the raised hand",
    },
)


def snap_spatial(value: int, alignment: int = 32) -> int:
    """Snap a pixel dimension onto the VAE/transformer alignment grid."""
    if alignment <= 0:
        raise ValueError("alignment must be positive")
    return max(alignment, int(round(value / alignment)) * alignment)


def snap_frames(frames: int, temporal_scale: int = 4) -> int:
    """Snap a frame count onto Wan's ``temporal * k + 1`` grid."""
    if frames < 1:
        raise ValueError("frames must be >= 1")
    if temporal_scale <= 0:
        raise ValueError("temporal_scale must be positive")
    k = max(1, int(round((frames - 1) / temporal_scale)))
    return k * temporal_scale + 1


def frames_for_seconds(seconds: float, fps: int, temporal_scale: int = 4) -> int:
    """Frame count for a target duration, snapped to the temporal grid."""
    if seconds <= 0:
        raise ValueError("seconds must be positive")
    return snap_frames(int(round(seconds * fps)), temporal_scale)


def _shot_prompt(beat: dict[str, str], style: str, characters: str, extra: str = "") -> str:
    parts = [
        beat["action"],
        beat["camera"],
        beat["motion"],
        characters,
        style,
    ]
    if extra:
        parts.insert(0, extra)
    return ", ".join(p for p in parts if p)


def build_shotlist(
    *,
    title: str,
    premise: str = "",
    part: int = 1,
    total_parts: int = 1,
    profile: str = DEFAULT_PROFILE,
    seconds_per_shot: float = 4.0,
    character_sheet: str = DEFAULT_CHARACTER_SHEET,
    style: str = STYLE_BIBLE,
    seed: int = 1234,
    model_variant: str = "wan2.2-ti2v-5b",
    reference_images: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build a deterministic, GPU-ready shot list for one reel part.

    ``reference_images`` maps a beat id to an image path that already exists on
    the render machine.  Those beats switch to ``image_to_video``; the rest stay
    pure ``text_to_video``.
    """
    if profile not in PROFILES:
        raise ValueError(f"Unknown profile {profile!r}. Available: {', '.join(sorted(PROFILES))}")
    if part < 1 or total_parts < 1 or part > total_parts:
        raise ValueError("part must be within 1..total_parts")
    if not title.strip():
        raise ValueError("title is required")

    cfg = PROFILES[profile]
    width = snap_spatial(cfg["width"], cfg["spatial_alignment"])
    height = snap_spatial(cfg["height"], cfg["spatial_alignment"])
    frames = frames_for_seconds(seconds_per_shot, cfg["fps"], cfg["temporal_scale"])

    shots: list[dict[str, Any]] = []
    for index, beat in enumerate(BEATS):
        ref = (reference_images or {}).get(beat["id"])
        shot_seed = seed + index * 101 + (part - 1) * 7919
        shots.append(
            {
                "index": index,
                "beat": beat["id"],
                "part": part,
                "operation": "image_to_video" if ref else "text_to_video",
                "prompt": _shot_prompt(beat, style, character_sheet, premise),
                "negative_prompt": ANIME_NEGATIVE_PROMPT,
                "width": width,
                "height": height,
                "frames": frames,
                "fps": cfg["fps"],
                "num_inference_steps": cfg["steps"],
                "guidance_scale": cfg["guidance"],
                "seed": shot_seed,
                "model_variant": model_variant,
                "reference_image": ref,
                "filename": f"part{part:02d}_beat{index + 1}_{beat['id']}.mp4",
            }
        )

    return {
        "schema_version": SHOTLIST_SCHEMA_VERSION,
        "title": title.strip(),
        "premise": premise.strip(),
        "part": part,
        "total_parts": total_parts,
        "profile": profile,
        "profile_config": cfg,
        "style_bible": style,
        "character_sheet": character_sheet,
        "aspect": "9:16",
        "total_duration_seconds": round(len(shots) * frames / cfg["fps"], 2),
        "shots": shots,
    }


def validate_shotlist(data: dict[str, Any]) -> list[str]:
    """Return a list of human-readable problems; empty means renderable."""
    problems: list[str] = []
    if data.get("schema_version") != SHOTLIST_SCHEMA_VERSION:
        problems.append(
            f"schema_version must be {SHOTLIST_SCHEMA_VERSION}, got {data.get('schema_version')!r}"
        )
    shots = data.get("shots")
    if not isinstance(shots, list) or not shots:
        problems.append("shots must be a non-empty list")
        return problems

    profile = PROFILES.get(data.get("profile", ""), {})
    temporal = profile.get("temporal_scale", 4)
    align = profile.get("spatial_alignment", 32)

    for pos, shot in enumerate(shots):
        label = shot.get("filename") or f"shots[{pos}]"
        if not shot.get("prompt"):
            problems.append(f"{label}: prompt is empty")
        if shot.get("operation") not in {"text_to_video", "image_to_video"}:
            problems.append(f"{label}: unsupported operation {shot.get('operation')!r}")
        if shot.get("operation") == "image_to_video" and not shot.get("reference_image"):
            problems.append(f"{label}: image_to_video requires reference_image")
        for dim in ("width", "height"):
            value = shot.get(dim)
            if not isinstance(value, int) or value <= 0 or value % align:
                problems.append(f"{label}: {dim}={value!r} must be a positive multiple of {align}")
        frames = shot.get("frames")
        if not isinstance(frames, int) or frames < 1 or (frames - 1) % temporal:
            problems.append(f"{label}: frames={frames!r} must satisfy frames % {temporal} == 1")
        if shot.get("fps", 0) <= 0:
            problems.append(f"{label}: fps must be positive")
        if not isinstance(shot.get("seed"), int):
            problems.append(f"{label}: seed must be an int for reproducibility")
    return problems


def estimate_gpu_seconds(shotlist: dict[str, Any]) -> float:
    """Rough wall-clock estimate, reusing the model measured in wan_video.py.

    Under sequential offload every denoising step streams the transformer across
    PCIe, which costs a flat per-step penalty independent of resolution, plus a
    term proportional to the pixels being denoised.
    """
    stream_per_step = 4.1
    seconds_per_step_per_mpx_frame = 0.47
    load_seconds = 15.0
    total = load_seconds
    for shot in shotlist.get("shots", []):
        mpx = (shot["width"] * shot["height"]) / 1_000_000
        total += shot["num_inference_steps"] * (stream_per_step + shot["frames"] * mpx * seconds_per_step_per_mpx_frame)
    return round(total, 1)


def write_shotlist(path: str | Path, data: dict[str, Any]) -> Path:
    problems = validate_shotlist(data)
    if problems:
        raise ValueError("Invalid shot list:\n  " + "\n  ".join(problems))
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a Kaggle GPU shot list for an anime reel.")
    parser.add_argument("--title", default="Untitled Reel")
    parser.add_argument("--premise", default="")
    parser.add_argument("--part", type=int, default=1)
    parser.add_argument("--total-parts", type=int, default=1)
    parser.add_argument("--profile", default=DEFAULT_PROFILE, choices=sorted(PROFILES))
    parser.add_argument("--seconds-per-shot", type=float, default=4.0)
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--out", default="shotlist.json")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate an existing shot list at --out instead of writing a new one.",
    )
    args = parser.parse_args(argv)

    if args.check:
        existing = json.loads(Path(args.out).read_text(encoding="utf-8"))
        problems = validate_shotlist(existing)
        if problems:
            print("INVALID:")
            for problem in problems:
                print(f"  - {problem}")
            return 1
        print(f"OK: {len(existing['shots'])} shots, ~{estimate_gpu_seconds(existing)}s GPU on one T4")
        return 0

    data = build_shotlist(
        title=args.title,
        premise=args.premise,
        part=args.part,
        total_parts=args.total_parts,
        profile=args.profile,
        seconds_per_shot=args.seconds_per_shot,
        seed=args.seed,
    )
    out = write_shotlist(args.out, data)
    print(f"Wrote {out} — {len(data['shots'])} shots, {data['total_duration_seconds']}s of video")
    print(f"Estimated GPU time on one T4: {estimate_gpu_seconds(data)}s (sequential offload)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
