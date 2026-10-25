# SETUP

Everything needed to go from a clean machine to a published reel, plus the instructions
to hand a desktop agent so it does the work instead of guessing.

Two halves, and they are separable:

| Half | What it does | Needs |
|---|---|---|
| **Generation** (this repo) | script → stills → motion → voice → MP4 | Python 3.10+, Node 18+ (22 for HyperFrames), ffmpeg |
| **Distribution** (OpenPost) | upload → publish/schedule → analytics → reply inbox | Docker, one container |

Generation works offline with zero keys. Distribution needs OpenPost running. You can
install them in either order; nothing below requires the other until §6.

---

## 1. Prerequisites

| Tool | Version | Why | Check |
|---|---|---|---|
| Python | **3.10+** (3.11 verified) | every tool in `tools/` | `python3 --version` |
| Node.js | **18+**, **22+ for HyperFrames** (22.22 verified) | Remotion, HyperFrames, `npx hyperframes` | `node --version` |
| npm | 9+ (10.9 verified) | the HyperFrames CLI is pulled via `npx` | `npm --version` |
| ffmpeg | any recent build | every render, mux and poster frame | `ffmpeg -version` |
| git | any | clone, and the agents assume it | `git --version` |
| Docker + Compose | optional | **only** for OpenPost | `docker compose version` |
| Chromium | any build | **only** for HyperFrames renders | `make hyperframes-doctor` |

> **Windows:** use WSL2. The render paths assume POSIX paths and `make`.

---

## 2. Install

```bash
git clone https://github.com/SriAkhilSJ/Marketing-Team
cd Marketing-Team
make setup
```

`make setup` does five things: creates `.venv` (via `uv` if present, else `venv`),
installs `requirements.txt`, runs `npm install` in `remotion-composer/`, tries `piper-tts`
(free offline TTS), warms the `npx` HyperFrames cache, and copies `.env.example` → `.env`.

If `make` is unavailable, the same steps by hand:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd remotion-composer && npm install && cd ..
pip install piper-tts                      # optional, offline TTS
npx --yes hyperframes --version            # warms the cache
cp .env.example .env
```

`make install-gpu` adds `diffusers transformers accelerate` for local image/video models.
Skip it unless you have an NVIDIA GPU — it is several GB.

**Chromium, only if you render with HyperFrames.** The CLI needs *a* Chromium binary; it will
try to download one and that fails on locked-down networks. Point it at one you already have:

```bash
export HYPERFRAMES_BROWSER_PATH=/path/to/chrome        # or chromium, or a headless shell
```

Put that line in your shell profile, not in a script — every render and snapshot needs it.
`make hyperframes-doctor` tells you whether it was found.

---

## 3. Verify — four gates, in this order

Do not start creative work until all four say yes. Each one fails for a *reason*.

```bash
# 1. dependencies resolve and tools register
make preflight

# 2. the HyperFrames runtime can actually capture pixels
make hyperframes-doctor

# 3. tests (needs the dev deps: make install-dev)
make install-dev && make test

# 4. OpenPost wiring (only if you set it up in §4)
python3 -m tools.publishers.openpost doctor
```

**Expected:** (1) a provider menu — most capabilities show `0/N configured` on a clean
install, which is normal and means "no API keys", not "broken". (2) `runtime_available:
true`. (3) green. (4) `setup complete: yes`.

A `0/N configured` menu is not a failure. This repo is designed so the zero-key path —
HyperFrames + locally synthesised audio + ffmpeg — produces real video.

---

## 4. OpenPost (distribution)

```bash
git clone https://github.com/getopenpost/openpost
cd openpost
docker compose up -d
```

That serves the app and its API on **`http://localhost:8080`**.

> **Port clash, and it bites.** OpenPost's compose pins `8080:8080`. If anything else on
> your machine already holds 8080, either change OpenPost's mapping (`"8090:8080"`) or
> stop the other service. Symptom of getting this wrong: the browser shows the *other*
> app while the API returns 404s.

Then, in the OpenPost UI:

1. **Settings → Personal → Developer → create token.** Scopes `api:read` + `api:write`.
   Bind it to one workspace; give it an expiry.
2. **Settings → Workspace → Social accounts → connect** the accounts you post from.
3. Per account, switch on **Analytics** and **Inbox activity**. These are *separate*
   switches from publishing — a connected account will happily publish while both are
   off and collect nothing.

Back in this repo, fill in `.env`:

```bash
OPENPOST_BASE_URL=http://127.0.0.1:8080
OPENPOST_TOKEN=op_...
OPENPOST_WORKSPACE_ID=ws_...
```

Find the workspace id with `python3 -m tools.publishers.openpost workspaces`, then confirm:

```bash
python3 -m tools.publishers.openpost doctor
```

Full detail, including the API traps and how to use the numbers honestly:
[`docs/OPENPOST.md`](docs/OPENPOST.md).

---

## 5. Optional API keys

`.env` is gitignored. Add nothing to start; add these to unlock cloud providers.
`make preflight` shows exactly what each one enables.

| Key | Unlocks |
|---|---|
| `FB_ACCESS_TOKEN` (or `META_ACCESS_TOKEN`) | direct Instagram Reels + Facebook Page posting, no OpenPost needed |
| `OPENROUTER_API_KEY` | any LLM-backed tool |
| `FAL_KEY` | FLUX, Veo, Kling, MiniMax and the rest through fal.ai |
| `OPENAI_API_KEY` | OpenAI-hosted models |
| `OPENPOST_*` | see §4 |

**Never** commit `.env`. Never paste a token into a composition, a script, or a chat.

---

## 6. First run

Zero keys, zero accounts, real output:

```bash
make demo          # renders the bundled zero-key demos
make demo-list     # what they are
```

A vertical reel through the tool API. `projects/` is gitignored and may not exist yet —
create it, scaffold a workspace, author `index.html`, then render it:

```bash
mkdir -p projects/first
```

```python
from tools.video.hyperframes_compose import HyperFramesCompose

comp = HyperFramesCompose()

# 1. materialise index.html + assets, no render
comp.execute({"operation": "scaffold_workspace", "workspace_path": "projects/first/compose"})
#    now edit projects/first/compose/index.html

# 2. render the authored HTML (scaffolding is skipped, your file is preserved)
result = comp.execute({
    "operation": "render_existing",
    "workspace_path": "projects/first/compose",
    "output_path": "projects/first/render.mp4",
    "fps": 24,                      # the tool defaults to 30
})
print(result.success, result.error or result.data.get("output_path"))
```

`render_existing` runs the full check (lint, runtime, layout, motion, contrast) and refuses
to render on a non-zero exit; it also fails if `index.html` changed during the render.
Run `npx hyperframes check` yourself while iterating so you are not debugging two things.
If the render reports `HyperFrames runtime not available: ffmpeg not found on PATH`, fix the
environment — do not switch runtimes to work around it.

Then publish it, once §4 is done:

```bash
python3 -m tools.publishers.openpost publish projects/first/render.mp4 \
    --caption "Six hundred years of darkness, and he still can't fold a croissant." \
    --account acc_instagram --profile instagram.reel
```

---

## 7. Desktop agent instructions

Give your desktop agent the prompt below **before** it touches anything, and paste it again
if the conversation gets long. It is written to be pasted verbatim.

### 7.1 Bootstrap prompt — paste this first

```text
You are setting up OpenMontage on my machine. Work in the repo at ./Marketing-Team.

RULES
- Read SETUP.md and AGENT_GUIDE.md before your first command. AGENT_GUIDE.md is binding.
- Run `make setup`, then the four gates in SETUP.md §3, in order. Report each gate as
  PASS or FAIL with the exact command output line that decided it.
- Never invent a version number, a flag, or a config key. If a command is not in
  SETUP.md, AGENT_GUIDE.md, or the tool's own --help, you do not know it exists.
- Never edit .env yourself and never print its contents. If a key is missing, tell me
  which key and which file, then stop.
- Do not run `git commit`, `git push`, or `git checkout` in this repo.
- If a step fails twice, stop and show me the exact error. Do not try a third variation
  silently.

ORDER
1. Check prerequisites from SETUP.md §1 (python, node, npm, ffmpeg, git). Report versions.
2. `make setup`. Surface any [skip] line — those are the fragile steps.
3. Gate 1 `make preflight` — paste the provider menu summary, not the raw envelope.
4. Gate 2 `make hyperframes-doctor` — it must say runtime_available: true.
5. Gate 3 `make test`.
6. Stop and ask me before installing Docker or starting OpenPost (§4).
7. After OpenPost, run `python3 -m tools.publishers.openpost doctor` and paste the
   PASS/FAIL lines verbatim.

REPORTING
Tell me, in this order: what passed, what failed, what I must decide. No preamble,
no summary of what you are about to do, no restating my request.
```

### 7.2 Standing instructions — paste when you start working

```text
Working rules for this repo (Marketing-Team / OpenMontage):

BEFORE ANY CREATIVE WORK
- Read AGENT_GUIDE.md. Run `make preflight` and present the capability menu as
  "N of M configured" per family. State which render runtime you will use and why.
- If HyperFrames is available, offer both composition runtimes. Do not pick silently.

RENDERING
- Render runtime is chosen at proposal and locked in edit_decisions. Never swap it
  mid-project without telling me.
- HyperFrames needs an explicit Chromium: export HYPERFRAMES_BROWSER_PATH=<binary>.
- 24 fps for vertical social. 1080x1920. Report the real measured duration from
  ffprobe, never the intended duration.

VERIFY BEFORE CLAIMING
- A render is not done until ffprobe confirms codec, resolution, fps and duration, and
  you have sampled frames at MID-SHOT times (t + 1.5s), not at cut boundaries.
- A video with no audio stream is a failure, not a stylistic choice. Check for it.

PUBLISHING
- Never publish without showing me the caption, the target accounts, and the scheduled
  time first, and getting an explicit yes.
- Use `python3 -m tools.publishers.openpost doctor` to prove the wiring before blaming
  a publish failure on the code.
- Never send OPENPOST_TOKEN to an absolute (third-party) upload URL.

FILE HYGIENE
- Do not commit renders, models, or anything over ~10 MB. Projects go in projects/.
- Do not modify .env, anything in .git, or anything in .venv.
- Do not delete files to "clean up" unless I asked for exactly that.

HONESTY
- If something is untested, say "untested". If you could not verify it, say so.
- If a repo or model's licence forbids monetised use, say that before recommending it.
```

### 7.3 Per-agent notes

| Agent | Where the instructions go |
|---|---|
| **Claude Code / Cursor / Codex CLI** | `AGENTS.md` and `CLAUDE.md` already point at `AGENT_GUIDE.md`; keep them. Paste §7.1 as the first message. |
| **Claude Desktop / ChatGPT desktop** | No repo awareness. Paste §7.1, and give it shell access to the repo folder — without a shell it can only read files. |
| **Cowork / computer-use agents** | Grant the repo folder only. Do not grant your home directory: `.env` lives one level up from any project folder. |
| **Any agent** | If it cannot run `make`, it can still read `AGENT_GUIDE.md` and `docs/OPENPOST.md` and give you exact commands for you to paste. |

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `make preflight` shows `0/N configured` everywhere | no API keys | expected. Zero-key path still renders. |
| `hyperframes: npm package not resolvable` | `npx` cold cache or offline | `make hyperframes-warm`, check network |
| HyperFrames render hangs or exits with `BeginFrame did not run` | no Chromium found | `export HYPERFRAMES_BROWSER_PATH=/path/to/chrome`; the "BeginFrame" line itself is benign |
| Render is silent | no `<audio>` in the composition, or TTS files missing | `hasAudio: true` should appear in the render trace; check the TTS step |
| Video looks black | elements without `data-start` are hidden by the runtime | add `data-start`; sample a frame mid-shot to confirm |
| One-frame black flash at every cut | fade-out and fade-in at the same timestamp | overlap them by ~0.1 s |
| OpenPost 404s while the page loads | port 8080 collision | see §4 port-clash note |
| `openpost doctor` says `missing_scope` | OAuth lacks the permission | reconnect the account after adding the scope |
| `.env` keys ignored | `make` copied `.env.example` only once | `.env` exists — edit it, don't re-run setup |
| `pip install` fails with `externally-managed-environment` | system Python (PEP 668) | use the venv: `source .venv/bin/activate` |

---

## 9. What is free, and what is not

| Free, no account | Costs money | Licence blocks monetising |
|---|---|---|
| HyperFrames, Remotion, ffmpeg | fal.ai / OpenAI / Google / ElevenLabs calls | **Qwen-Image-2.1** (colibri's only image model) — non-commercial |
| Kokoro + Piper TTS | OpenPost's optional AI features (your own OpenRouter/fal key) | some locally-run diffusion weights — check each |
| OpenPost self-hosted (AGPL-3.0) | OpenPost Hosted (waitlist) | — |
| This repo (AGPL-3.0) | GPU time for local models | — |

Open source does not mean licence-free *output*. A model can be free to download and still
forbid selling what it generates. Check the model, not the repo, before monetising.
