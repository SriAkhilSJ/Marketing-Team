# Kaggle MCP: rendering anime reels on free GPU

This document wires a **Kaggle MCP server** into an MCP client so an agent can push,
start, poll and collect GPU renders of this repo's local Wan text-to-video tooling.
It replaces the manual "open Kaggle, paste notebook, click Run All" loop.

The interesting constraint: a Kaggle notebook **cannot accept inbound connections**.
No MCP server you host can reach *into* a running kernel. So the Kaggle MCP is a
**control plane over the Kaggle API**, not a socket into the GPU. Data moves as
kernel pushes, kernel outputs and dataset files — which is exactly what the server
exposes.

## What is actually available

Two servers, both real:

| Server | Transport | Auth | Tools |
|---|---|---|---|
| **Official** — `https://www.kaggle.com/mcp` | Remote HTTP | OAuth 2.0 | Notebooks (create/push/start/cancel/status/output), competitions, datasets, models, benchmarks |
| **Community** — `kaggle-mcp-server` (PyPI) | Local stdio | `KAGGLE_API_TOKEN` (`KGAT_…`) | ~52 tools: the above plus dataset creation/file upload, discussion search, kernel logs |

`kaggle-mcp-server` is the better fit for automation because it can **upload dataset
files** and read **kernel logs**, which the official server does not expose. The
official server is better fit for a human-in-the-loop session because OAuth means no
long-lived token sitting in a config file.

## Client wiring

The repo ships `.mcp.json` at the root with both servers declared.

### Claude Code

```bash
claude mcp add --transport stdio kaggle -- npx -y mcp-remote https://www.kaggle.com/mcp
# or accept the checked-in project config, then approve it:
claude mcp list
```

Project-scoped config is `.mcp.json` (already committed) — Claude Code asks for
approval on first use.

### Cursor

Settings → MCP → **Add new MCP server**, or add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "kaggle": { "command": "npx", "args": ["-y", "mcp-remote", "https://www.kaggle.com/mcp"] }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows). Same `mcpServers` block.

### VS Code / Copilot

`.vscode/mcp.json` — note the key is `servers`, **not** `mcpServers`:

```json
{
  "servers": {
    "kaggle": { "type": "http", "url": "https://www.kaggle.com/mcp" }
  }
}
```

### Automation without a browser

```bash
pip install kaggle-mcp-server
export KAGGLE_API_TOKEN=KGAT_xxxxxxxxxxxxxxxx   # kaggle.com/settings -> API -> Create token
uvx kaggle-mcp-server
```

Alternatively the plain `kaggle` CLI does everything below without MCP at all —
MCP only helps when you want an agent to drive it conversationally:

```bash
pip install kaggle
mkdir -p ~/.kaggle && cp kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json
kaggle kernels push -p kaggle/anime_reel_t2v
kaggle kernels status  YOURUSERNAME/anime-reel-t2v
kaggle kernels output  YOURUSERNAME/anime-reel-t2v -p ./renders
```

## The round trip

```
tools/video/kaggle_shots.py        # CPU: brief -> shotlist.json (prompts, 9:16 geometry, seeds)
        |
        v
kaggle/anime_reel_t2v/kernel.py    # GPU: loop shots -> wan_video (local Wan 2.2) -> clips/*.mp4
        |
        v
/kaggle/working/final.mp4           # concat in beat order
/kaggle/working/render_report.json  # per-shot status, seconds, errors — survives a timeout
        |
        v
kaggle kernels output -> renders/   # then Remotion captions/music, then tools/publishers/
```

Step 1, on any machine:

```bash
python -m tools.video.kaggle_shots \
  --title "The Ashborn" \
  --premise "Part 1: a scavenger wakes with a power the masked order wants buried" \
  --profile kaggle-t4-9x16 \
  --out shotlist.json
python -m tools.video.kaggle_shots --out shotlist.json --check
```

The CLI prints an estimated T4 runtime from the same per-step cost model
`tools/video/wan_video.py` uses, so you can see the GPU-hour bill before spending it.

Step 2, hand the shot list to the kernel by **one** of:

- put `shotlist.json` in the kernel directory and push the directory,
- upload it as a private dataset and set `SHOTLIST_PATH=/kaggle/input/<dataset>/shotlist.json`,
- set the `SHOTLIST_JSON` environment variable to the raw JSON (small lists only).

Step 3, through MCP: create-or-push the notebook, `start`, poll status, then read the
output files. Through the CLI, the three commands above.

## What the free tier will and will not do

| | Reality | Consequence for anime work |
|---|---|---|
| GPU | T4 (16GB) or 2×T4, Turing arch | No bf16, no fp8. Engine auto-falls back to fp16; 5B fits with sequential offload |
| Quota | ~30 GPU-h/week | At ~7 min per 4s shot, ~250 shots/week — 8–10 reels, not a series |
| Session | 12h hard cap | Loop persists `render_report.json` per shot; rerun resumes from disk |
| Disk | ~20GB `/kaggle/working` | Delete pip caches; one 5B checkpoint download is ~10GB |
| Network | Outbound only, internet toggle | HF + GitHub reachable from the kernel, nothing reachable *from outside* |
| Model | 5B TI2V (`wan2.2-ti2v-5b`) | Real motion, but character drift across independently sampled shots |

The A14B variant (`wan2.2-t2v-a14b`, 28B resident) needs ~40GB and will not run here.
On a single 16GB T4 it OOMs even with sequential offload.

## Anime-specific failure modes

1. **Character drift.** Independently sampled shots produce a different protagonist
   each time. Fix: keep `character_sheet` identical across the list (the compiler
   already repeats it in every prompt) and, when it matters, render beat 1 first,
   export its best frame, and pass it as `reference_image` for the rest — which
   switches those shots to `image_to_video`.
2. **CGI drift.** Long prompts push Wan toward rendered-looking output. The style
   bible is kept short and repeated; do not append adjectives per shot.
3. **Static frames.** The default Chinese negative prompt in `_wan_engine.py`
   suppresses this hard; `ANIME_NEGATIVE_PROMPT` in `kaggle_shots.py` carries the
   English equivalent, including `static frame`.
4. **Frame-count asserts.** Wan needs `frames % 4 == 1` and both dimensions on a
   multiple of 32. `snap_frames`/`snap_spatial` handle this; `--check` catches
   hand-edited lists before a GPU is billed.

## Not solved here

- Audio: Wan 2.2 has no native audio. Narration comes from the repo's TTS tools,
  music from the existing providers, and both get muxed in `remotion-composer/`.
- Captions and publish: `tools/video/remotion_caption_burn.py` and
  `tools/publishers/social_media_publisher.py` already exist — the Kaggle kernel
  stops at `final.mp4` on purpose, because they need no GPU.
