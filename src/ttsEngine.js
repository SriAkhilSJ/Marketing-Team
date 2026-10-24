/**
 * Microsoft Edge Neural TTS Engine (via Python edge-tts — free, no key needed)
 *
 * Uses the same neural voices as Microsoft Edge browser's Read Aloud feature.
 * Falls back gracefully to lavfi sine-wave audio if Python / edge-tts is unavailable.
 *
 * Voice reference (best for Reels):
 *  en-US-ChristopherNeural   — deep, confident Male  ✅ default
 *  en-US-GuyNeural           — friendly Male
 *  en-US-AndrewMultilingualNeural — premium Male
 *  en-US-AriaNeural          — warm Female
 *  en-US-JennyNeural         — energetic Female
 *  en-IN-NeerjaNeural        — Indian English Female
 *  hi-IN-MadhurNeural        — Hindi Male
 *
 * Set TTS_VOICE in .env to pick a voice, or pass voice= to synthesize().
 */

"use strict";

const { execFile, spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ─── helpers ────────────────────────────────────────────────────────────────

/** Resolve the Python binary that has edge-tts installed. */
function resolvePythonBin() {
  // Try the env var first (user can point to a specific venv)
  const envPy = process.env.PYTHON_BIN || process.env.PYTHON_PATH;
  if (envPy) return envPy;

  // Common Windows / POSIX locations
  const candidates = ["python", "python3", "py"];
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ["-m", "edge_tts", "--version"], { timeout: 4000 });
      if (r.status === 0 || (r.stderr && r.stderr.toString().includes("edge"))) {
        return bin;
      }
      // edge_tts may not have --version; check if the module exists
      const check = spawnSync(bin, ["-c", "import edge_tts; print('ok')"], { timeout: 3000 });
      if (check.status === 0) return bin;
    } catch (_) { /* try next */ }
  }
  return null;
}

/** Check (synchronously, once) whether edge-tts is available. */
let _edgeTtsAvailable = null;
function isEdgeTtsAvailable() {
  if (_edgeTtsAvailable !== null) return _edgeTtsAvailable;
  const bin = resolvePythonBin();
  if (!bin) { _edgeTtsAvailable = false; return false; }
  const r = spawnSync(bin, ["-c", "import edge_tts; print('ok')"], { timeout: 4000 });
  _edgeTtsAvailable = (r.status === 0 && r.stdout && r.stdout.toString().includes("ok"));
  return _edgeTtsAvailable;
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Synthesise `text` to an MP3 file using Microsoft Edge neural TTS.
 *
 * @param {object} opts
 * @param {string}  opts.text          Full voiceover text to speak.
 * @param {string}  [opts.outputMp3]   Absolute path for the output MP3. If omitted a temp file is used.
 * @param {string}  [opts.voice]       Edge TTS voice name (e.g. "en-US-ChristopherNeural").
 * @param {string}  [opts.rate]        Speaking rate offset, e.g. "+10%", "-5%"  (default "+0%").
 * @param {string}  [opts.pitch]       Pitch offset, e.g. "+5Hz" (default "+0Hz").
 * @returns {Promise<{ ok: boolean, mp3Path: string|null, engine: string, error?: string }>}
 */
async function synthesise({ text, outputMp3, voice, rate, pitch } = {}) {
  const resolvedVoice = voice || process.env.TTS_VOICE || "en-US-ChristopherNeural";
  const resolvedRate  = rate  || process.env.TTS_RATE   || "+0%";
  const resolvedPitch = pitch || process.env.TTS_PITCH  || "+0Hz";
  const mp3Path = outputMp3 || path.join(os.tmpdir(), `edge_tts_${Date.now()}.mp3`);

  if (!isEdgeTtsAvailable()) {
    return {
      ok:     false,
      mp3Path: null,
      engine: "unavailable",
      error:  "edge-tts Python module not found. Install with: pip install edge-tts"
    };
  }

  const pyBin = resolvePythonBin();
  const args  = [
    "-m", "edge_tts",
    "--voice",        resolvedVoice,
    "--text",         text,
    "--rate",         resolvedRate,
    "--pitch",        resolvedPitch,
    "--write-media",  mp3Path
  ];

  return new Promise((resolve) => {
    execFile(pyBin, args, { timeout: 60000 }, (err, _stdout, stderr) => {
      if (err || !fs.existsSync(mp3Path) || fs.statSync(mp3Path).size < 500) {
        resolve({
          ok:     false,
          mp3Path: null,
          engine: "edge-tts",
          error:  (err?.message || stderr || "Unknown error generating TTS audio").slice(0, 200)
        });
      } else {
        resolve({ ok: true, mp3Path, engine: `edge-tts:${resolvedVoice}` });
      }
    });
  });
}

/**
 * Generate one voiceover MP3 per scene and return a combined full-voiceover MP3.
 * If TTS fails for any reason the function returns null so the caller can fall
 * back to the synthetic lavfi audio.
 *
 * @param {object} opts
 * @param {Array<{voiceover:string}>} opts.scenes
 * @param {string}  opts.reelId
 * @param {string}  opts.outputDir   Directory to write MP3 files into.
 * @param {string}  [opts.voice]
 * @returns {Promise<string|null>}   Absolute path to the merged voiceover MP3, or null on failure.
 */
async function buildReelVoiceover({ scenes, reelId, outputDir, voice }) {
  if (!isEdgeTtsAvailable()) return null;

  // Combine all scene voiceovers with a short pause between scenes
  const fullScript = scenes.map((s) => s.voiceover).join("  "); // double-space = natural pause
  const mp3Path    = path.join(outputDir, `${reelId}_voice.mp3`);

  const result = await synthesise({ text: fullScript, outputMp3: mp3Path, voice });
  if (!result.ok) {
    console.warn(`[TTS] Edge TTS failed: ${result.error}. Falling back to synthetic audio.`);
    return null;
  }

  console.log(`[TTS] ✅ Microsoft Edge Neural Voice generated → ${mp3Path} (${fs.statSync(mp3Path).size} bytes)`);
  return mp3Path;
}

/** All known English voices (great for Reels) — exposed for the Web UI selector. */
const EDGE_TTS_VOICES = [
  { id: "en-US-ChristopherNeural",         label: "Christopher (US ♂ – deep, confident) ★ default" },
  { id: "en-US-GuyNeural",                 label: "Guy (US ♂ – friendly, casual)" },
  { id: "en-US-AndrewMultilingualNeural",  label: "Andrew Multilingual (US ♂ – premium)" },
  { id: "en-US-EricNeural",                label: "Eric (US ♂ – authoritative)" },
  { id: "en-US-AriaNeural",                label: "Aria (US ♀ – warm, natural)" },
  { id: "en-US-JennyNeural",               label: "Jenny (US ♀ – energetic)" },
  { id: "en-US-MichelleNeural",            label: "Michelle (US ♀ – friendly)" },
  { id: "en-GB-RyanNeural",                label: "Ryan (UK ♂ – British professional)" },
  { id: "en-GB-SoniaNeural",               label: "Sonia (UK ♀ – British warm)" },
  { id: "en-AU-WilliamNeural",             label: "William (AU ♂ – Australian)" },
  { id: "en-IN-NeerjaExpressiveNeural",    label: "Neerja (IN ♀ – Indian English expressive)" },
  { id: "en-IN-NeerjaNeural",              label: "Neerja (IN ♀ – Indian English)" },
  { id: "hi-IN-MadhurNeural",              label: "Madhur (HI ♂ – Hindi Male)" },
  { id: "hi-IN-SwaraNeural",               label: "Swara (HI ♀ – Hindi Female)" }
];

module.exports = { synthesise, buildReelVoiceover, isEdgeTtsAvailable, EDGE_TTS_VOICES };
