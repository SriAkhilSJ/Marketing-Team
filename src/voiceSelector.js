/**
 * Auto Voice Selector — tests all Edge TTS voices on a sample Reels script,
 * scores each by file size (proxy for fluency/naturalness since edge-tts
 * neural voices produce more bytes for the same text when the rhythm is
 * smooth and expressive), and sets the winner as TTS_VOICE in .env.
 *
 * Usage:
 *   node src/voiceSelector.js                     # test & auto-pick best
 *   node src/voiceSelector.js --lang en            # only English voices
 *   node src/voiceSelector.js --lang hi            # only Hindi voices
 *   node src/voiceSelector.js --lang all           # all 14 voices (default)
 *   node src/voiceSelector.js --sample "your text" # custom sample text
 */

"use strict";

const { execFile, spawnSync } = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ─── Voice catalog ──────────────────────────────────────────────────────────
const VOICES = [
  // ── English US ────────────────────────────────────────────────────
  { id: "en-US-ChristopherNeural",         lang: "en", gender: "M", label: "Christopher  (US ♂ deep & confident)"     },
  { id: "en-US-GuyNeural",                 lang: "en", gender: "M", label: "Guy          (US ♂ friendly, casual)"     },
  { id: "en-US-AndrewMultilingualNeural",  lang: "en", gender: "M", label: "Andrew Multi (US ♂ premium)"              },
  { id: "en-US-EricNeural",                lang: "en", gender: "M", label: "Eric         (US ♂ authoritative)"        },
  { id: "en-US-AriaNeural",                lang: "en", gender: "F", label: "Aria         (US ♀ warm, natural)"        },
  { id: "en-US-JennyNeural",               lang: "en", gender: "F", label: "Jenny        (US ♀ energetic)"            },
  { id: "en-US-MichelleNeural",            lang: "en", gender: "F", label: "Michelle     (US ♀ friendly)"             },
  // ── English UK / AU ───────────────────────────────────────────────
  { id: "en-GB-RyanNeural",                lang: "en", gender: "M", label: "Ryan         (GB ♂ British professional)" },
  { id: "en-GB-SoniaNeural",               lang: "en", gender: "F", label: "Sonia        (GB ♀ British warm)"         },
  { id: "en-AU-WilliamNeural",             lang: "en", gender: "M", label: "William      (AU ♂ Australian)"           },
  // ── English India ─────────────────────────────────────────────────
  { id: "en-IN-NeerjaExpressiveNeural",    lang: "en", gender: "F", label: "Neerja Exp   (IN ♀ Indian expressive)"    },
  { id: "en-IN-NeerjaNeural",              lang: "en", gender: "F", label: "Neerja       (IN ♀ Indian English)"       },
  // ── Hindi ─────────────────────────────────────────────────────────
  { id: "hi-IN-MadhurNeural",              lang: "hi", gender: "M", label: "Madhur       (HI ♂ Hindi Male)"           },
  { id: "hi-IN-SwaraNeural",               lang: "hi", gender: "F", label: "Swara        (HI ♀ Hindi Female)"         },
];

// ─── Scoring ────────────────────────────────────────────────────────────────
/**
 * Score a voice based on:
 *  - bytes generated (larger = more expressive/fluent audio)
 *  - generation time (faster = better latency for live render)
 * We weight bytes 70% and speed 30%.
 */
function scoreVoice({ bytes, ms, maxBytes, minMs }) {
  const byteScore  = bytes  / maxBytes;          // 0–1, higher is better
  const speedScore = minMs  / ms;                // 0–1, lower ms = higher score
  return 0.70 * byteScore + 0.30 * speedScore;
}

// ─── Python resolution ──────────────────────────────────────────────────────
function resolvePython() {
  const envPy = process.env.PYTHON_BIN || process.env.PYTHON_PATH;
  if (envPy) return envPy;
  for (const bin of ["python", "python3", "py"]) {
    try {
      const r = spawnSync(bin, ["-c", "import edge_tts; print('ok')"], { timeout: 3000 });
      if (r.status === 0) return bin;
    } catch (_) {}
  }
  return null;
}

// ─── Single voice test ──────────────────────────────────────────────────────
function testVoice(pyBin, voice, text, tmpDir) {
  return new Promise((resolve) => {
    const outPath = path.join(tmpDir, `voice_test_${voice.id}.mp3`);
    const t0 = Date.now();
    execFile(
      pyBin,
      ["-m", "edge_tts", "--voice", voice.id, "--text", text, "--write-media", outPath],
      { timeout: 30000 },
      (err) => {
        const ms = Date.now() - t0;
        if (err || !fs.existsSync(outPath)) {
          resolve({ voice, ok: false, bytes: 0, ms, score: 0 });
          return;
        }
        const bytes = fs.statSync(outPath).size;
        try { fs.unlinkSync(outPath); } catch (_) {}
        resolve({ voice, ok: bytes > 500, bytes, ms, score: 0 });
      }
    );
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function runVoiceSelector() {
  // Parse CLI flags
  const args   = process.argv.slice(2);
  const langFlag   = args[args.indexOf("--lang")   + 1] || "all";
  const sampleFlag = args[args.indexOf("--sample") + 1] || null;
  const quietFlag  = args.includes("--quiet");

  const SAMPLE_TEXT = sampleFlag ||
    "Stop using static AI slideshows for Reels. " +
    "Our agent writes real sixty frames per second video in code, " +
    "publishes to Instagram and Facebook automatically, " +
    "and sends payment links to every commenter — all for less than one rupee per Reel.";

  const ENGLISH_SAMPLE = SAMPLE_TEXT;
  const HINDI_SAMPLE   =
    "स्टैटिक AI स्लाइडशो से बाहर निकलो। " +
    "हमारा एजेंट कोड में असली साठ फ्रेम वीडियो बनाता है, " +
    "Instagram और Facebook पर अपने आप पोस्ट करता है, " +
    "और हर कमेंटर को पेमेंट लिंक भेजता है।";

  const pyBin = resolvePython();
  if (!pyBin) {
    console.error("❌  Python with edge-tts not found. Install: pip install edge-tts");
    process.exit(1);
  }

  // Filter voices
  let voices = VOICES;
  if (langFlag !== "all") {
    voices = VOICES.filter((v) => v.lang === langFlag);
    if (!voices.length) {
      console.error(`❌  No voices for lang "${langFlag}". Use: en | hi | all`);
      process.exit(1);
    }
  }

  const tmpDir = os.tmpdir();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  🎙️  AUTO VOICE SELECTOR — Microsoft Edge Neural TTS Tester  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`\nTesting ${voices.length} voice(s) | lang filter: ${langFlag} | Python: ${pyBin}\n`);

  // Run all tests (concurrency = 3 to avoid rate-limiting)
  const results = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < voices.length; i += CONCURRENCY) {
    const batch = voices.slice(i, i + CONCURRENCY);
    const sample = batch[0].lang === "hi" ? HINDI_SAMPLE : ENGLISH_SAMPLE;
    const batchResults = await Promise.all(batch.map((v) => testVoice(pyBin, v, sample, tmpDir)));
    batchResults.forEach((r) => {
      const status = r.ok ? "✅" : "❌";
      const kbStr  = r.ok ? `${(r.bytes / 1024).toFixed(1)} KB` : "failed";
      const msStr  = `${r.ms}ms`;
      if (!quietFlag) {
        console.log(`  ${status}  ${r.voice.label.padEnd(40)} │ ${kbStr.padEnd(9)} │ ${msStr}`);
      }
      results.push(r);
    });
  }

  const successful = results.filter((r) => r.ok);
  if (!successful.length) {
    console.error("\n❌  All voice tests failed. Check your internet connection.");
    process.exit(1);
  }

  // Score
  const maxBytes = Math.max(...successful.map((r) => r.bytes));
  const minMs    = Math.min(...successful.map((r) => r.ms));
  successful.forEach((r) => {
    r.score = scoreVoice({ bytes: r.bytes, ms: r.ms, maxBytes, minMs });
  });
  successful.sort((a, b) => b.score - a.score);

  const winner = successful[0];

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("🏆  RESULTS (ranked by score):\n");
  successful.slice(0, 5).forEach((r, i) => {
    const medal = ["🥇", "🥈", "🥉", "4.", "5."][i];
    const bar   = "█".repeat(Math.round(r.score * 20)).padEnd(20, "░");
    console.log(`  ${medal}  ${r.voice.label.padEnd(40)} │ score: ${r.score.toFixed(3)} [${bar}]`);
  });

  console.log(`\n✅  WINNER: ${winner.voice.id}`);
  console.log(`   ${winner.voice.label}`);
  console.log(`   Bytes: ${(winner.bytes / 1024).toFixed(1)} KB | Time: ${winner.ms}ms | Score: ${winner.score.toFixed(3)}`);

  // Persist winner to .env
  const envFile = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envFile)) {
    let envContent = fs.readFileSync(envFile, "utf8");
    if (envContent.includes("TTS_VOICE=")) {
      envContent = envContent.replace(/^TTS_VOICE=.*/m, `TTS_VOICE=${winner.voice.id}`);
    } else {
      envContent += `\nTTS_VOICE=${winner.voice.id}\n`;
    }
    fs.writeFileSync(envFile, envContent, "utf8");
    console.log(`\n💾  Saved TTS_VOICE=${winner.voice.id} → .env`);
  } else {
    console.log(`\n💡  Set in terminal: TTS_VOICE=${winner.voice.id}`);
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  🎉  Agent will now use: ${winner.voice.id.padEnd(34)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Return winner for programmatic use
  return winner.voice.id;
}

// ─── Run if called directly ──────────────────────────────────────────────────
if (require.main === module) {
  runVoiceSelector().catch((err) => {
    console.error("Voice selector error:", err.message);
    process.exit(1);
  });
}

module.exports = { runVoiceSelector, VOICES };
