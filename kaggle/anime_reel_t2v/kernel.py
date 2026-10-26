"""Kaggle kernel: render an anime reel shot list with local Wan text-to-video.

Push this directory with either the official Kaggle MCP server's notebook tools or

    kaggle kernels push -p kaggle/anime_reel_t2v

then poll it, and fetch ``/kaggle/working/anime_reel_output.zip`` from the kernel
output.  See ``docs/KAGGLE_MCP.md`` for the client wiring.

Design notes that matter on a free T4:

* Weights are not cached between runs.  A 12h session cap minus ~10 min of model
  download is the real budget, so the loop renders the shortest useful clips first
  and resumes from whatever is already on disk.
* T4 is Turing: no bf16, no fp8.  ``precision="auto"`` labels the run bf16 but the
  engine downgrades the dtype to fp16 when ``torch.cuda.is_bf16_supported()`` is
  false, so a 5B checkpoint fits in 16GB with sequential offload.
* The shot list is the only input.  Prompts, geometry and seeds are computed on a
  CPU in ``tools/video/kaggle_shots.py`` so this cell stays boring.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import traceback
import zipfile
from pathlib import Path

WORK = Path("/kaggle/working")
REPO_DIR = WORK / "repo"
OUT_DIR = WORK / "clips"
REPORT_PATH = WORK / "render_report.json"
ZIP_PATH = WORK / "anime_reel_output.zip"

# Kaggle "Add-ons -> Environment variables" or a private dataset-mounted file.
REPO_URL = os.environ.get("REPO_URL", "https://github.com/SriAkhilSJ/Marketing-Team.git")
REPO_REF = os.environ.get("REPO_REF", "main")
# Inline JSON wins over a path, so a client can push a shot list without a dataset.
SHOTLIST_JSON = os.environ.get("SHOTLIST_JSON", "").strip()
SHOTLIST_PATH = os.environ.get("SHOTLIST_PATH", "").strip()


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def setup() -> None:
    if not REPO_DIR.exists():
        run(["git", "clone", "--depth", "1", "--branch", REPO_REF, REPO_URL, str(REPO_DIR)])
    else:
        run(["git", "-C", str(REPO_DIR), "pull", "--ff-only"])

    # Kaggle images ship torch, but the diffusers stack moves fast enough that
    # pinning to the repo's own requirement set is the only reproducible option.
    run([sys.executable, "-m", "pip", "install", "-q", "-r", str(REPO_DIR / "requirements-gpu.txt")])
    run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-q",
            "diffusers>=0.35",
            "transformers>=4.46",
            "accelerate>=1.0",
            "bitsandbytes>=0.44",
            "safetensors",
            "imageio-ffmpeg",
            "ftfy",
        ]
    )


def load_shotlist() -> dict:
    if SHOTLIST_JSON:
        return json.loads(SHOTLIST_JSON)
    if SHOTLIST_PATH:
        return json.loads(Path(SHOTLIST_PATH).read_text(encoding="utf-8"))
    default = REPO_DIR / "shotlist.json"
    if default.exists():
        return json.loads(default.read_text(encoding="utf-8"))
    raise SystemExit(
        "No shot list found. Set SHOTLIST_JSON, SHOTLIST_PATH, or upload shotlist.json "
        "as a dataset file. Generate one with tools/video/kaggle_shots.py."
    )


def render(shotlist: dict) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(REPO_DIR))

    import torch

    from tools.video.kaggle_shots import estimate_gpu_seconds, validate_shotlist
    from tools.video.wan_video import WanVideo

    problems = validate_shotlist(shotlist)
    if problems:
        raise SystemExit("Shot list is invalid:\n  " + "\n  ".join(problems))

    print(f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU (!!)'}")
    if torch.cuda.is_available():
        vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
        print(f"VRAM: {vram:.1f} GB, bf16 supported: {torch.cuda.is_bf16_supported()}")
    print(f"Shots: {len(shotlist['shots'])}, estimated GPU seconds: {estimate_gpu_seconds(shotlist)}")

    tool = WanVideo()
    status = tool.get_status()
    print(f"wan_video status: {status}")
    if str(status) != "ToolStatus.AVAILABLE":
        # Not fatal on its own — the error usually names the missing package.
        print(f"install_instructions: {tool.install_instructions}")

    report: dict = {"title": shotlist.get("title"), "profile": shotlist.get("profile"), "shots": []}

    for shot in shotlist["shots"]:
        target = OUT_DIR / shot["filename"]
        entry = {"filename": shot["filename"], "beat": shot["beat"], "status": "pending"}

        if target.exists() and target.stat().st_size > 0:
            entry["status"] = "skipped_existing"
            report["shots"].append(entry)
            print(f"skip {shot['filename']} (already rendered)")
            continue

        inputs = {
            "prompt": shot["prompt"],
            "negative_prompt": shot.get("negative_prompt"),
            "operation": shot.get("operation", "text_to_video"),
            "model_variant": shot.get("model_variant", "wan2.2-ti2v-5b"),
            "width": shot["width"],
            "height": shot["height"],
            "num_frames": shot["frames"],
            "fps": shot["fps"],
            "num_inference_steps": shot["num_inference_steps"],
            "guidance_scale": shot["guidance_scale"],
            "seed": shot["seed"],
            # auto-precision + auto offload is the right call: the engine reads the
            # actual card, which is a T4 here and something else on a paid host.
            "precision": shot.get("precision", "auto"),
            "offload_mode": shot.get("offload_mode", "auto"),
        }
        if shot.get("reference_image"):
            inputs["reference_image"] = shot["reference_image"]

        started = time.time()
        try:
            result = tool.execute(inputs)
            if not getattr(result, "success", False):
                entry.update(status="failed", error=getattr(result, "error", "unknown error"))
            else:
                produced = None
                for artifact in getattr(result, "artifacts", []) or []:
                    path = artifact.get("path") if isinstance(artifact, dict) else getattr(artifact, "path", None)
                    if path and str(path).endswith((".mp4", ".webm", ".gif")):
                        produced = Path(path)
                        break
                if produced and produced.exists():
                    target.write_bytes(produced.read_bytes())
                    entry["status"] = "rendered"
                else:
                    entry.update(status="failed", error="no video artifact returned")
        except Exception as exc:  # noqa: BLE001 - a bad shot must not kill the batch
            entry.update(status="failed", error=f"{type(exc).__name__}: {exc}")
            traceback.print_exc()

        entry["seconds"] = round(time.time() - started, 1)
        report["shots"].append(entry)
        print(f"{entry['status']}: {shot['filename']} ({entry.get('seconds', 0)}s) {entry.get('error', '')}")

        # Persist after every shot: a 12h cap kill loses at most one clip.
        REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")

    rendered = [s for s in report["shots"] if s["status"] in {"rendered", "skipped_existing"}]
    report["summary"] = {
        "total": len(report["shots"]),
        "rendered": len(rendered),
        "failed": len(report["shots"]) - len(rendered),
        "clip_seconds": round(sum(s["seconds"] for s in report["shots"] if "seconds" in s), 1),
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def assemble(shotlist: dict, report: dict) -> None:
    """Concat rendered clips in beat order. Captions/music stay in Remotion later."""
    clips = [OUT_DIR / s["filename"] for s in shotlist["shots"] if (OUT_DIR / s["filename"]).exists()]
    if not clips:
        print("nothing to assemble")
        return
    concat_file = WORK / "concat.txt"
    concat_file.write_text("".join(f"file '{clip}'\n" for clip in clips), encoding="utf-8")
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "18",
            str(WORK / "final.mp4"),
        ]
    )


def zip_outputs() -> None:
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in WORK.rglob("*"):
            if path.is_file() and path != ZIP_PATH and "repo" not in path.parts and ".git" not in path.parts:
                archive.write(path, path.relative_to(WORK))
    print(f"wrote {ZIP_PATH} ({ZIP_PATH.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    setup()
    shotlist = load_shotlist()
    report = render(shotlist)
    if report["summary"]["rendered"]:
        try:
            assemble(shotlist, report)
        except Exception as exc:  # noqa: BLE001 - assembly is optional
            print(f"assemble failed: {exc}")
            traceback.print_exc()
    zip_outputs()
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
