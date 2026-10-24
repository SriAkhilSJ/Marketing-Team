const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createCanvas } = require("@napi-rs/canvas");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { callVelonaChat, parseJsonSafely } = require("./velonaClient");
const { OUTPUT_DIR } = require("./config");
const { retrieveContextFromRag, rememberGeneratedReel } = require("./memoryRagEngine");
const { buildReelVoiceover, isEdgeTtsAvailable } = require("./ttsEngine");

const VIDEO_STYLES = {
  fireship_code: {
    id: "fireship_code",
    name: "Monochrome Code & Telemetry System",
    accent: "#ffffff",
    secondary: "#a1a1aa",
    bgTop: "#000000",
    bgBottom: "#09090b"
  },
  minimal_wealth: {
    id: "minimal_wealth",
    name: "Dan Koe / Minimalist Motion System",
    accent: "#ffffff",
    secondary: "#71717a",
    bgTop: "#000000",
    bgBottom: "#050505"
  },
  data_counter: {
    id: "data_counter",
    name: "Monochrome Data Benchmark & Counter",
    accent: "#f4f4f5",
    secondary: "#a1a1aa",
    bgTop: "#000000",
    bgBottom: "#0a0a0c"
  },
  chat_story: {
    id: "chat_story",
    name: "Animated DM Funnel & Signal Story",
    accent: "#ffffff",
    secondary: "#d4d4d8",
    bgTop: "#000000",
    bgBottom: "#09090b"
  },
  quiz_challenge: {
    id: "quiz_challenge",
    name: "Interactive Timer Hook & Reveal",
    accent: "#ffffff",
    secondary: "#a1a1aa",
    bgTop: "#000000",
    bgBottom: "#09090b"
  }
};

/**
 * Generates the viral hook, 4-scene script, caption, Remotion (.tsx) code,
 * and renders both the 9:16 MP4 Reel and 4 Carousel PNG slides.
 */
async function generateCodeToVideoReel({ settings, analysisReport, customTopic = "", preferredStyle = "" }) {
  const styleKey = preferredStyle || settings.preferredVideoStyle || "fireship_code";
  const styleCfg = VIDEO_STYLES[styleKey] || VIDEO_STYLES.fireship_code;
  const triggerKeyword = (settings.dmTriggerKeyword || "AUTO").toUpperCase();

  const targetTopic =
    customTopic.trim() ||
    analysisReport?.recommendedNextReel?.title ||
    "How Autonomous AI Agents Build & Publish 60fps Motion Reels From Code";

  const targetQuestion =
    analysisReport?.recommendedNextReel?.targetQuestion ||
    "How does programmatic code-to-video outperform static image slideshows for organic reach?";

  // 0. Retrieve relevant context from RAG Knowledge Base + Episodic Post Memory (Anti-Duplicate Guard)
  const ragContext = retrieveContextFromRag(`${targetTopic} ${targetQuestion} ${settings.niche}`);

  // 1. Ask Velona LLM (DeepSeek / GLM / Claude / GPT) with injected RAG Memory Context
  const systemPrompt =
    "You are an elite viral Instagram/Facebook Reels director and Remotion/Canvas motion-graphics engineer. " +
    "Every single scene MUST be 100% focused on the user's exact topic — NEVER insert generic ads about API URLs or LLM pricing unless the topic explicitly asks for it. " +
    "NEVER repeat any hook from pastHooksToAvoid. " +
    "Create a 4-scene vertical motion-graphics Reel: " +
    "Scene 1 (01 // HOOK - bold scroll-stopping thesis), " +
    "Scene 2 (02 // ARCHITECTURE - the core bottleneck vs system flow), " +
    "Scene 3 (03 // EXECUTION - step-by-step code/system implementation), " +
    "Scene 4 (04 // BLUEPRINT - actionable takeaway + CTA to comment the trigger keyword). " +
    "Output strict JSON with keys: " +
    "title (string), hookText (string, max 10 words), visualStyle (string), " +
    "caption (string with hook, 3 bullet insights, CTA to comment the trigger keyword, and hashtags), " +
    "voiceoverFull (string), " +
    "scenes (array of 4 objects, each with: badge, layout ('kinetic_hook'|'system_diagram'|'live_telemetry'|'action_cta'), headline (max 8 words), voiceover (1-2 crisp sentences, max 26 words), codeLines (array of 4 concise code or architecture lines about the topic), nodes (array of 3 short stage labels for diagrams), metricLabel (uppercase string), metricValue (short ASCII string like '84.6%' or '14.2x' or '60 FPS' — never use ₹ symbol), highlightWord (single word)).";

  const userPrompt = JSON.stringify({
    topic: targetTopic,
    audienceQuestionToAnswer: targetQuestion,
    niche: settings.niche,
    brandVoice: settings.brandVoice,
    monetizationOffer: settings.monetizationOffer,
    dmTriggerKeyword: triggerKeyword,
    visualStyle: styleKey,
    ragKnowledgeFacts: ragContext.matchedKnowledgeDocs.map((d) => ({
      title: d.title,
      content: d.content,
      similarity: d.similarityScore
    })),
    winningEpisodesFromMemory: ragContext.winningEpisodes.map((e) => ({
      hookText: e.hookText,
      saveRate: e.saveRate
    })),
    pastHooksToAvoid: ragContext.winningEpisodes.map((e) => e.hookText)
  });

  const llmRes = await callVelonaChat({
    settings,
    systemPrompt,
    userPrompt,
    temperature: 0.65,
    maxTokens: 1600,
    jsonMode: true
  });

  const parsed = llmRes.ok ? parseJsonSafely(llmRes.content) : null;

  const spec = buildSceneSpec(parsed, {
    targetTopic,
    targetQuestion,
    triggerKeyword,
    styleKey,
    settings,
    ragContext
  });

  const reelId = `reel_${Date.now()}`;
  const remotionCode = generateRemotionTsxCode(spec, styleCfg);
  const codeFilePath = path.join(OUTPUT_DIR, "code", `${reelId}.tsx`);
  fs.writeFileSync(codeFilePath, remotionCode, "utf8");

  // 2. Render real 9:16 MP4 video using @napi-rs/canvas + FFmpeg
  const mp4Filename = `${reelId}.mp4`;
  const mp4FilePath = path.join(OUTPUT_DIR, "reels", mp4Filename);
  await renderMp4FromCodeSpec({
    spec,
    styleCfg,
    outputPath: mp4FilePath
  });

  // 3. Render 4-Slide Carousel PNGs for Instagram & Facebook Feed
  const carouselUrls = await renderCarouselSlides({
    reelId,
    spec,
    styleCfg,
    triggerKeyword
  });

  const reelResult = {
    id: reelId,
    createdAt: new Date().toISOString(),
    status: settings.automationMode === "review_first" ? "PENDING_REVIEW" : "READY_TO_PUBLISH",
    title: spec.title,
    hookText: spec.hookText,
    visualStyle: styleKey,
    visualStyleName: styleCfg.name,
    llmModelUsed: llmRes.ok ? llmRes.model : `${settings.llmModel || "Code-to-Video"} (Procedural Studio)`,
    caption: spec.caption,
    voiceoverFull: spec.voiceoverFull,
    dmTriggerKeyword: triggerKeyword,
    scenes: spec.scenes,
    videoUrl: `/output/reels/${mp4Filename}`,
    localMp4Path: mp4FilePath,
    remotionCodeUrl: `/output/code/${reelId}.tsx`,
    remotionCode,
    carouselUrls,
    ragMemoryUsed: {
      velonaMemorySessionId: ragContext.velonaMemorySessionId,
      matchedDocs: ragContext.matchedKnowledgeDocs.map((d) => ({
        id: d.id,
        title: d.title,
        similarityScore: d.similarityScore
      })),
      dedupCheck: ragContext.dedupCheck
    }
  };

  // 4. Save newly generated Reel into persistent Episodic Memory
  rememberGeneratedReel(reelResult);

  return reelResult;
}

/**
 * Extracts meaningful noun/domain concepts from any user topic so procedural scenes,
 * diagrams, and code blocks read naturally and are 100% tailored to the requested subject.
 */
function extractTopicKeywords(topic) {
  const stopWords = new Set([
    "how", "why", "what", "when", "where", "who", "the", "and", "for", "with",
    "from", "that", "this", "your", "our", "into", "using", "uses", "make",
    "makes", "can", "will", "about", "never", "always", "every", "automatically",
    "generates", "generate", "generating", "generated", "creates", "create",
    "creating", "builds", "build", "building", "writes", "write", "writing",
    "renders", "render", "rendering", "automates", "automate", "automating",
    "repeat", "repeating", "stop", "stops", "without", "instead", "most", "more"
  ]);
  const allowedTwoChar = new Set(["ai", "ui", "ux", "ig", "fb", "dm", "js", "ts", "db", "ml", "3d", "4k", "go"]);

  const words = String(topic || "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => {
      const lower = w.toLowerCase();
      if (stopWords.has(lower)) return false;
      return w.length >= 3 || allowedTwoChar.has(lower);
    });

  const formatConcept = (w, fallback) => {
    if (!w) return fallback;
    if (w.length <= 3 && allowedTwoChar.has(w.toLowerCase())) return w.toUpperCase();
    if (w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  };

  const k1 = formatConcept(words[0], "AI");
  const k2 = formatConcept(words[1], "Motion");
  const k3 = formatConcept(words[2], "Reels");
  const k4 = formatConcept(words[3], "Code");
  const slug = [k1, k2, k3]
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .join("_");

  return { k1, k2, k3, k4, slug: slug || "motion_engine", rawWords: words };
}

/** Truncates cleanly at a whole-word boundary so words are never cut in half. */
function truncateAtWord(text, maxLen = 58) {
  const clean = String(text || "").trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim();
}

/** Sanitizes strings so Windows/Linux canvas never renders missing Unicode boxes (▯). */
function toAsciiSafe(str) {
  return String(str || "")
    .replace(/₹/g, "Rs.")
    .replace(/[⚡🔥🚀🧠🎙️🎬📲✅🛑👇🔎➕🗂️📚⚙️💾🔊⬇️]/g, "")
    .replace(/[•●]/g, "*")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSceneSpec(parsed, { targetTopic, targetQuestion, triggerKeyword, styleKey, settings, ragContext }) {
  const cleanTopic = toAsciiSafe(targetTopic || "Autonomous Code-to-Video Motion System");
  const { k1, k2, k3, k4, slug } = extractTopicKeywords(cleanTopic);
  const shortHook = truncateAtWord(cleanTopic, 60);
  const matchedDoc = ragContext?.matchedKnowledgeDocs?.find((d) => !d.title.includes("E2E Test")) || ragContext?.matchedKnowledgeDocs?.[0];
  const ragFact = toAsciiSafe(matchedDoc?.title || "RAG Knowledge Vault");

  const layouts = ["kinetic_hook", "system_diagram", "live_telemetry", "action_cta"];

  // Topic-driven procedural scenes (Zero hardcoded LLM model names, URLs, or ₹0.08 filler)
  const dynamicScenes = [
    {
      badge: "01 // THE THESIS",
      layout: "kinetic_hook",
      headline: shortHook,
      voiceover: `${cleanTopic}. Most creators rely on manual editing or static templates, while programmatic motion systems scale retention automatically.`,
      codeLines: [
        `// target: ${slug}.ts`,
        `const thesis = analyzeTopic("${k1} ${k2} ${k3}");`,
        `const signal = lockHookRetention({ fps: 30 });`,
        `export default compileMotionSequence(thesis, signal);`
      ],
      nodes: [k1.toUpperCase(), k2.toUpperCase(), k3.toUpperCase()],
      metricLabel: "HOOK RETENTION INDEX",
      metricValue: "88.4%",
      highlightWord: k1
    },
    {
      badge: "02 // SYSTEM ARCHITECTURE",
      layout: "system_diagram",
      headline: `Why Manual ${k2} ${k3} Workflows Fail`,
      voiceover: `When you replace manual bottlenecks with an automated ${k1} ${k3} pipeline, every frame and insight compounds from ${ragFact}.`,
      codeLines: [
        `pipeline.ingest("${k1.toLowerCase()}_signal");`,
        `pipeline.connectContext("${ragFact.slice(0, 26)}");`,
        `pipeline.transform({ target: "${k2.toLowerCase()}_${k3.toLowerCase()}" });`,
        `pipeline.verifyOutput({ zeroDuplicates: true });`
      ],
      nodes: [`1. ${k1.toUpperCase()}`, `2. ${k2.toUpperCase()}`, `3. ${k3.toUpperCase()}`],
      metricLabel: "THROUGHPUT GAIN",
      metricValue: "+14.2x",
      highlightWord: k3
    },
    {
      badge: "03 // LIVE EXECUTION",
      layout: "live_telemetry",
      headline: `Compiling ${k1} ${k3} Directly From ${k4}`,
      voiceover: `Watch the execution engine compile vector geometry, kinetic typography, and synchronized audio directly into a high-retention vertical master.`,
      codeLines: [
        `[01] initCanvas({ width: 540, height: 960, fps: 30 })`,
        `[02] renderVectors("${slug}", { spring: 140 })`,
        `[03] syncAudioTrack({ mode: "neural_voiceover" })`,
        `[04] encodeMasterMp4({ codec: "h264_yuv420p" })`
      ],
      nodes: ["COMPILE", "RENDER 30FPS", "MUX AUDIO"],
      metricLabel: "FRAME PRECISION",
      metricValue: "30 FPS",
      highlightWord: "compile"
    },
    {
      badge: "04 // THE BLUEPRINT",
      layout: "action_cta",
      headline: `Deploy This ${k1} ${k3} System Today`,
      voiceover: `Want the complete ${cleanTopic} workflow and source architecture? Comment ${triggerKeyword} below and the system will send you the blueprint.`,
      codeLines: [
        `Step 1: Map ${k1} ${k2} inputs & RAG memory`,
        `Step 2: Compile procedural 9:16 ${k3} scenes`,
        `Step 3: Auto-publish & trigger DM workflow`,
        `> Trigger keyword active: "${triggerKeyword}"`
      ],
      nodes: ["AUDIT", "EXECUTE", `DM "${triggerKeyword}"`],
      metricLabel: "BLUEPRINT ACCESS",
      metricValue: `COMMENT "${triggerKeyword}"`,
      highlightWord: triggerKeyword
    }
  ];

  const rawSceneList = parsed?.scenes || parsed?.slides || parsed?.scene_list || [];

  const scenes =
    Array.isArray(rawSceneList) && rawSceneList.length >= 3
      ? rawSceneList.slice(0, 4).map((s, i) => {
          const fallback = dynamicScenes[i] || dynamicScenes[0];
          const rawCode = s.codeLines || s.code_lines || s.lines || s.code;
          const normalizedCode = Array.isArray(rawCode)
            ? rawCode.map((l) => toAsciiSafe(l)).filter(Boolean).slice(0, 4)
            : typeof rawCode === "string"
            ? rawCode
                .split(/\r?\n/)
                .map((l) => toAsciiSafe(l))
                .filter(Boolean)
                .slice(0, 4)
            : fallback.codeLines;

          const rawNodes = Array.isArray(s.nodes) && s.nodes.length >= 3
            ? s.nodes.slice(0, 3).map((n) => toAsciiSafe(n).toUpperCase())
            : fallback.nodes;

          return {
            badge: toAsciiSafe(s.badge || fallback.badge).toUpperCase(),
            layout: layouts[i] || s.layout || fallback.layout,
            headline: toAsciiSafe(s.headline || s.title || s.hook || fallback.headline),
            voiceover: toAsciiSafe(s.voiceover || s.narration || s.script || s.text || fallback.voiceover),
            codeLines: normalizedCode.length > 0 ? normalizedCode : fallback.codeLines,
            nodes: rawNodes,
            metricLabel: toAsciiSafe(s.metricLabel || s.metric_label || fallback.metricLabel).toUpperCase(),
            metricValue: toAsciiSafe(String(s.metricValue || s.metric_value || fallback.metricValue)),
            highlightWord: toAsciiSafe(s.highlightWord || s.highlight_word || fallback.highlightWord)
          };
        })
      : dynamicScenes;

  const hookText = toAsciiSafe(
    parsed?.hookText ||
      parsed?.hook_text ||
      parsed?.hook ||
      (cleanTopic.length <= 58 ? cleanTopic : `${cleanTopic.slice(0, 55)}...`)
  );

  const voiceoverFull = toAsciiSafe(
    parsed?.voiceoverFull || scenes.map((s) => s.voiceover).join(" ")
  );

  const caption =
    parsed?.caption ||
    `${hookText}\n\n` +
      `Topic Breakdown — ${cleanTopic}:\n` +
      `01 // ${scenes[0].headline}\n` +
      `02 // ${scenes[1].headline}\n` +
      `03 // ${scenes[2].headline}\n` +
      `04 // ${scenes[3].headline}\n\n` +
      `Comment "${triggerKeyword}" below and the agent will DM you the complete architecture & blueprint (${settings.monetizationOffer || "Full Stack Blueprint"}).\n\n` +
      `#monochrome #codevideo #aiagents #motiondesign #automation #instagramreels #remotion`;

  return {
    title: toAsciiSafe(parsed?.title || targetTopic),
    hookText,
    visualStyle: styleKey,
    targetQuestion: toAsciiSafe(targetQuestion),
    caption,
    voiceoverFull,
    scenes
  };
}

/**
 * Generates clean, copy-pasteable Remotion (.tsx) source code for the Reel
 * in a crisp Monochrome Black theme.
 */
function generateRemotionTsxCode(spec, styleCfg) {
  const scenesJson = JSON.stringify(spec.scenes, null, 2);
  return `// Auto-Generated by Autonomous Code-to-Video Engine (Monochrome Edition)
// Topic: ${spec.title}
// Style: ${styleCfg.name} | Resolution: 1080x1920 (9:16 Vertical Reel @ 30fps)
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

const SCENES = ${scenesJson};

export const AutonomousCodeReel: React.FC = () => {
  const { fps } = useVideoConfig();
  const framesPerScene = 3 * fps;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000000',
        color: '#ffffff',
        fontFamily: 'Inter, JetBrains Mono, monospace'
      }}
    >
      {SCENES.map((scene, index) => (
        <Sequence
          key={index}
          from={index * framesPerScene}
          durationInFrames={framesPerScene}
        >
          <SceneView scene={scene} sceneIndex={index} totalScenes={SCENES.length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: any; sceneIndex: number; totalScenes: number }> = ({
  scene,
  sceneIndex,
  totalScenes
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 16, stiffness: 150 } });
  const translateY = interpolate(entrance, [0, 1], [36, 0]);

  return (
    <AbsoluteFill style={{ padding: 64, justifyContent: 'space-between', background: '#000000' }}>
      <div style={{ transform: \`translateY(\${translateY}px)\`, opacity: entrance }}>
        <div
          style={{
            display: 'inline-block',
            padding: '8px 20px',
            borderRadius: 999,
            background: '#09090b',
            border: '1px solid #3f3f46',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: '0.08em'
          }}
        >
          {scene.badge} // 0{sceneIndex + 1}/0{totalScenes}
        </div>
        <h1 style={{ fontSize: 64, fontWeight: 900, lineHeight: 1.08, marginTop: 28, color: '#ffffff' }}>
          {scene.headline}
        </h1>
      </div>

      <div
        style={{
          background: '#09090b',
          borderRadius: 24,
          padding: 40,
          border: '1px solid #27272a'
        }}
      >
        {scene.codeLines.map((line: string, idx: number) => (
          <pre
            key={idx}
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 26,
              color: idx === 0 ? '#a1a1aa' : '#ffffff',
              margin: '14px 0'
            }}
          >
            {line}
          </pre>
        ))}
      </div>

      <div
        style={{
          background: '#09090b',
          border: '1px solid #27272a',
          padding: '28px 34px',
          borderRadius: 20,
          fontSize: 34,
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center'
        }}
      >
        {scene.voiceover}
      </div>
    </AbsoluteFill>
  );
};
`;
}

/**
 * Renders a real 9:16 vertical H.264 MP4 video at 30fps with procedural motion graphics
 * + Microsoft Edge Neural TTS voiceover (or synthesized monochrome pulse track if offline).
 */
async function renderMp4FromCodeSpec({ spec, styleCfg, outputPath }) {
  const width = 540;
  const height = 960;
  const fps = 30;
  const secondsPerScene = 3.0;
  const framesPerScene = Math.round(fps * secondsPerScene); // 90 frames/scene
  const totalScenes = spec.scenes.length;
  const totalFrames = framesPerScene * totalScenes; // 360 frames = 12.0s
  const totalDurationSec = totalFrames / fps;

  // Step 1: Try Microsoft Edge Neural TTS
  const reelId = path.basename(outputPath, ".mp4");
  const audioDir = path.dirname(outputPath);
  let voiceMp3 = null;
  if (isEdgeTtsAvailable()) {
    try {
      voiceMp3 = await buildReelVoiceover({
        scenes: spec.scenes,
        reelId,
        outputDir: audioDir,
        voice: process.env.TTS_VOICE || "en-US-ChristopherNeural"
      });
    } catch (e) {
      console.warn("[TTS] Voiceover generation failed, using synthetic audio:", e.message);
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Step 2: Spawn FFmpeg to encode 30fps H.264 MP4
  return new Promise((resolve, reject) => {
    let args;

    if (voiceMp3) {
      args = [
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", `${width}x${height}`,
        "-r", String(fps),
        "-i", "pipe:0",
        "-i", voiceMp3,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-af", `apad,atrim=0:${totalDurationSec}`,
        "-shortest",
        "-movflags", "+faststart",
        outputPath
      ];
    } else {
      args = [
        "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-pix_fmt", "rgba",
        "-s", `${width}x${height}`,
        "-r", String(fps),
        "-i", "pipe:0",
        "-f", "lavfi",
        "-i", `aevalsrc=0.06*sin(2*PI*98*t)+0.04*sin(2*PI*196*t)*(1+0.5*sin(2*PI*2*t)):s=44100:d=${totalDurationSec}`,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        outputPath
      ];
    }

    const ff = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderrLog = "";
    ff.stderr.on("data", (chunk) => {
      stderrLog += chunk.toString();
    });

    ff.on("error", (err) => reject(err));
    ff.on("close", (code) => {
      if (voiceMp3 && fs.existsSync(voiceMp3)) {
        try {
          fs.unlinkSync(voiceMp3);
        } catch (_) {}
      }
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrLog.slice(-400)}`));
      }
    });

    // Step 3: Stream rendered frames into FFmpeg stdin
    let frameIdx = 0;
    function writeNextFrame() {
      while (frameIdx < totalFrames) {
        const sceneIdx = Math.min(totalScenes - 1, Math.floor(frameIdx / framesPerScene));
        const sceneFrame = frameIdx % framesPerScene;
        const sceneProgress = sceneFrame / framesPerScene;
        const globalProgress = frameIdx / totalFrames;

        drawCodeVideoFrame({
          ctx,
          width,
          height,
          spec,
          scene: spec.scenes[sceneIdx],
          sceneIdx,
          totalScenes,
          sceneProgress,
          globalProgress,
          styleCfg
        });

        const rawBuf = canvas.data();
        const canContinue = ff.stdin.write(rawBuf);
        frameIdx++;
        if (!canContinue) {
          ff.stdin.once("drain", writeNextFrame);
          return;
        }
      }
      ff.stdin.end();
    }

    writeNextFrame();
  });
}

/**
 * Monochrome Procedural Motion Graphics Renderer
 * Draws distinct, topic-driven vector motion graphics for each scene.
 */
function drawCodeVideoFrame({
  ctx,
  width,
  height,
  spec,
  scene,
  sceneIdx,
  totalScenes,
  sceneProgress,
  globalProgress
}) {
  // 1. Pure Monochrome Black Background (#000000 -> #08080a)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, "#000000");
  bgGrad.addColorStop(0.5, "#050507");
  bgGrad.addColorStop(1, "#000000");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle architectural monochrome grid + scrolling scanline
  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  const gridOffset = Math.round(globalProgress * 144) % 36;
  for (let x = 28; x < width; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = gridOffset; y < height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Subtle monochrome radial spotlight behind active stage
  const spotGrad = ctx.createRadialGradient(width * 0.5, 420, 10, width * 0.5, 420, 260);
  spotGrad.addColorStop(0, "rgba(255, 255, 255, 0.07)");
  spotGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = spotGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Top Timeline Progress Bar + Scene Segment Ticks
  const barX = 28;
  const barY = 24;
  const barW = width - 56;
  ctx.fillStyle = "#18181b";
  ctx.fillRect(barX, barY, barW, 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(barX, barY, Math.max(6, Math.round(barW * globalProgress)), 4);

  // Segment dividers
  for (let i = 1; i < totalScenes; i++) {
    const sx = barX + Math.round((barW / totalScenes) * i);
    ctx.fillStyle = "#000000";
    ctx.fillRect(sx - 1, barY - 1, 3, 6);
  }

  // Spring entrance physics
  const springEase = 1 - Math.pow(1 - Math.min(1, sceneProgress * 4.2), 3);
  const slideY = Math.round((1 - springEase) * 20);

  // 3. Header Badge + Scene Counter
  ctx.save();
  ctx.translate(0, slideY);

  ctx.font = "bold 11px monospace";
  const badgeLabel = toAsciiSafe(scene.badge || `0${sceneIdx + 1} // SCENE`);
  const badgeW = Math.min(310, Math.max(150, Math.ceil(ctx.measureText(badgeLabel).width) + 28));
  drawRoundedRect(ctx, 28, 44, badgeW, 28, 14);
  ctx.fillStyle = "#09090b";
  ctx.fill();
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Pulsing status dot drawn with vector arc (no Unicode glyph issues)
  ctx.beginPath();
  ctx.arc(42, 58, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.fillStyle = "#e4e4e7";
  ctx.fillText(badgeLabel, 53, 62);

  // Scene counter right-aligned
  ctx.fillStyle = "#71717a";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`SCENE 0${sceneIdx + 1} / 0${totalScenes}`, width - 28, 62);
  ctx.textAlign = "left";

  // 4. Topic Headline (max 3 lines, clipped cleanly above y=218)
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  wrapTextBounded(ctx, toAsciiSafe(scene.headline), 28, 108, width - 56, 34, 3);
  ctx.restore();

  // 5. Center Procedural Motion Stage (y = 222 .. 632)
  const stageTop = 222;
  const stageH = 410;
  drawRoundedRect(ctx, 28, stageTop, width - 56, stageH, 18);
  ctx.fillStyle = "#070709";
  ctx.fill();
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Top bar inside motion stage
  ctx.strokeStyle = "#18181b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, stageTop + 38);
  ctx.lineTo(width - 28, stageTop + 38);
  ctx.stroke();

  // Monochrome window dots
  const monoDots = ["#52525b", "#a1a1aa", "#ffffff"];
  monoDots.forEach((col, idx) => {
    ctx.beginPath();
    ctx.arc(48 + idx * 14, stageTop + 19, 4, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });

  const stageTitle =
    sceneIdx === 0
      ? "STAGE_01 // SIGNAL_RADAR.TSX"
      : sceneIdx === 1
      ? "STAGE_02 // SYSTEM_TOPOLOGY.TSX"
      : sceneIdx === 2
      ? "STAGE_03 // TELEMETRY_EXEC.TSX"
      : "STAGE_04 // ACTION_PROTOCOL.TSX";

  ctx.fillStyle = "#71717a";
  ctx.font = "11px monospace";
  ctx.fillText(stageTitle, 96, stageTop + 23);

  ctx.fillStyle = "#a1a1aa";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(sceneProgress * 100)}%`, width - 44, stageTop + 23);
  ctx.textAlign = "left";

  // Dispatch procedural scene renderer based on scene index or style
  ctx.save();
  drawRoundedRect(ctx, 29, stageTop + 39, width - 58, stageH - 40, 16);
  ctx.clip();

  if (spec.visualStyle === "chat_story" && sceneIdx === 1) {
    drawMonochromeChatStage(ctx, width, stageTop, scene, sceneProgress);
  } else if (sceneIdx === 0) {
    drawScene1KineticRadar(ctx, width, stageTop, scene, sceneProgress, globalProgress);
  } else if (sceneIdx === 1) {
    drawScene2ArchitectureFlow(ctx, width, stageTop, scene, sceneProgress);
  } else if (sceneIdx === 2) {
    drawScene3CodeAndTelemetry(ctx, width, stageTop, scene, sceneProgress);
  } else {
    drawScene4BlueprintCta(ctx, width, stageTop, scene, sceneProgress, spec.dmTriggerKeyword || "AUTO");
  }
  ctx.restore();

  // 6. Windowed Karaoke Subtitle Box (y = 650 .. 882) — Strictly Clipped!
  const subBoxY = 650;
  const subBoxH = 232;
  drawRoundedRect(ctx, 28, subBoxY, width - 56, subBoxH, 18);
  ctx.fillStyle = "#09090b";
  ctx.fill();
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Small caption header inside subtitle card
  ctx.fillStyle = "#71717a";
  ctx.font = "bold 10px monospace";
  ctx.fillText("VOICEOVER TRANSCRIPT // SYNCED", 46, subBoxY + 24);

  ctx.fillStyle = "#52525b";
  ctx.textAlign = "right";
  ctx.fillText("30 FPS MONOCHROME", width - 46, subBoxY + 24);
  ctx.textAlign = "left";

  // Clip karaoke words inside the box so text never overflows
  ctx.save();
  drawRoundedRect(ctx, 32, subBoxY + 34, width - 64, subBoxH - 42, 12);
  ctx.clip();

  const words = toAsciiSafe(scene.voiceover || "").split(/\s+/).filter(Boolean);
  const activeWordIndex = Math.min(words.length - 1, Math.floor(sceneProgress * words.length));

  drawWindowedKaraokeWords({
    ctx,
    words,
    activeWordIndex,
    highlightWord: scene.highlightWord,
    x: 46,
    y: subBoxY + 68,
    maxWidth: width - 92,
    lineHeight: 34,
    maxVisibleLines: 4
  });
  ctx.restore();

  // 7. Clean Monochrome Footer Bar (Non-overlapping)
  ctx.fillStyle = "#52525b";
  ctx.font = "bold 11px monospace";
  ctx.fillText("CODE-TO-VIDEO STUDIO", 28, height - 26);

  ctx.fillStyle = "#a1a1aa";
  ctx.textAlign = "right";
  ctx.fillText("9:16 VERTICAL MASTER", width - 28, height - 26);
  ctx.textAlign = "left";
}

/**
 * SCENE 1: Kinetic Radar Ring + 32-Bar Frequency Waveform + Core Thesis Card
 */
function drawScene1KineticRadar(ctx, width, stageTop, scene, sceneProgress, globalProgress) {
  const centerX = width / 2;
  const radarY = stageTop + 145;

  // Concentric monochrome radar rings
  for (let r = 1; r <= 3; r++) {
    const radius = r * 32 + ((sceneProgress * 28) % 24);
    const alpha = Math.max(0.05, 0.28 - r * 0.07);
    ctx.beginPath();
    ctx.arc(centerX, radarY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Rotating vector sweep line
  const angle = globalProgress * Math.PI * 8;
  ctx.beginPath();
  ctx.moveTo(centerX, radarY);
  ctx.lineTo(centerX + Math.cos(angle) * 86, radarY + Math.sin(angle) * 86);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center node
  ctx.beginPath();
  ctx.arc(centerX, radarY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Node pill tags Left / Center / Right
  const nodes = scene.nodes || ["SIGNAL", "SYSTEM", "SCALE"];
  nodes.slice(0, 3).forEach((label, idx) => {
    const pillW = 132;
    const pillX = 48 + idx * 156;
    const pillY = stageTop + 236;
    const isActive = sceneProgress >= idx * 0.25;
    drawRoundedRect(ctx, pillX, pillY, pillW, 32, 8);
    ctx.fillStyle = isActive ? "#ffffff" : "#121215";
    ctx.fill();
    ctx.strokeStyle = isActive ? "#ffffff" : "#27272a";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = isActive ? "#000000" : "#a1a1aa";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(label).slice(0, 14), pillX + pillW / 2, pillY + 20);
    ctx.textAlign = "left";
  });

  // 32-Bar Procedural Audio/Signal Waveform + Metric Readout Card
  const cardY = stageTop + 284;
  drawRoundedRect(ctx, 48, cardY, width - 96, 106, 14);
  ctx.fillStyle = "#0e0e12";
  ctx.fill();
  ctx.strokeStyle = "#27272a";
  ctx.stroke();

  ctx.fillStyle = "#71717a";
  ctx.font = "bold 11px monospace";
  ctx.fillText(scene.metricLabel || "SIGNAL RETENTION", 66, cardY + 28);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 36px sans-serif";
  ctx.fillText(scene.metricValue || "88.4%", 66, cardY + 76);

  // Procedural animated waveform bars on the right half of the metric box
  const numBars = 18;
  const barStartX = 250;
  const baseLineY = cardY + 84;
  for (let b = 0; b < numBars; b++) {
    const wave =
      Math.abs(Math.sin(sceneProgress * Math.PI * 4 + b * 0.55)) * 0.7 +
      Math.abs(Math.cos(sceneProgress * Math.PI * 2 - b * 0.3)) * 0.3;
    const bh = Math.max(8, Math.round(wave * 54));
    const bx = barStartX + b * 12;
    ctx.fillStyle = b / numBars <= sceneProgress ? "#ffffff" : "#3f3f46";
    ctx.fillRect(bx, baseLineY - bh, 7, bh);
  }
}

/**
 * SCENE 2: 3-Node System Architecture Diagram with Animated Data Packets + Benchmark Bars
 */
function drawScene2ArchitectureFlow(ctx, width, stageTop, scene, sceneProgress) {
  const nodes = scene.nodes || ["1. INPUT", "2. ENGINE", "3. OUTPUT"];
  const nodeY = stageTop + 72;
  const nodeW = 132;
  const nodeH = 74;
  const positions = [48, 204, 360];

  // Connecting lines + traveling data pulse dots between nodes
  for (let i = 0; i < 2; i++) {
    const x1 = positions[i] + nodeW;
    const x2 = positions[i + 1];
    const lineY = nodeY + nodeH / 2;

    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, lineY);
    ctx.lineTo(x2, lineY);
    ctx.stroke();

    // Animated packet moving along connector
    const packetT = (sceneProgress * 2.5 + i * 0.5) % 1;
    const px = x1 + (x2 - x1) * packetT;
    ctx.beginPath();
    ctx.arc(px, lineY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // Draw the 3 architecture nodes
  positions.forEach((nx, idx) => {
    const isActive = sceneProgress >= idx * 0.28;
    drawRoundedRect(ctx, nx, nodeY, nodeW, nodeH, 12);
    ctx.fillStyle = isActive ? "#18181b" : "#0b0b0e";
    ctx.fill();
    ctx.strokeStyle = isActive ? "#ffffff" : "#27272a";
    ctx.lineWidth = isActive ? 1.8 : 1;
    ctx.stroke();

    ctx.fillStyle = "#71717a";
    ctx.font = "bold 10px monospace";
    ctx.fillText(`NODE 0${idx + 1}`, nx + 14, nodeY + 24);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(String(nodes[idx] || "").slice(0, 13), nx + 14, nodeY + 50);
  });

  // Benchmark Comparison Card (Static Workflow vs Programmatic System)
  const compY = stageTop + 172;
  drawRoundedRect(ctx, 48, compY, width - 96, 120, 12);
  ctx.fillStyle = "#0c0c0f";
  ctx.fill();
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Bar 1: Legacy Manual / Static
  ctx.fillStyle = "#a1a1aa";
  ctx.font = "11px monospace";
  ctx.fillText("LEGACY MANUAL / STATIC TEMPLATE", 64, compY + 28);
  drawRoundedRect(ctx, 64, compY + 36, 110, 14, 4);
  ctx.fillStyle = "#3f3f46";
  ctx.fill();

  // Bar 2: Autonomous Code Pipeline (Animated width)
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px monospace";
  ctx.fillText("AUTONOMOUS CODE PIPELINE", 64, compY + 76);
  const maxBarW = width - 128;
  const animBarW = Math.max(40, Math.round(maxBarW * Math.min(1, sceneProgress * 1.45)));
  drawRoundedRect(ctx, 64, compY + 84, animBarW, 18, 4);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  // Bottom Metric Strip
  const metricY = stageTop + 310;
  drawRoundedRect(ctx, 48, metricY, width - 96, 80, 12);
  ctx.fillStyle = "#121216";
  ctx.fill();
  ctx.strokeStyle = "#3f3f46";
  ctx.stroke();

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "bold 11px monospace";
  ctx.fillText(scene.metricLabel || "THROUGHPUT GAIN", 66, metricY + 28);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText(scene.metricValue || "+14.2x", 66, metricY + 62);

  ctx.fillStyle = "#d4d4d8";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "right";
  ctx.fillText("[VERIFIED ARCHITECTURE]", width - 66, metricY + 48);
  ctx.textAlign = "left";
}

/**
 * SCENE 3: Clean Monochrome Code Execution + Live Animated Telemetry Sparkline Curve
 */
function drawScene3CodeAndTelemetry(ctx, width, stageTop, scene, sceneProgress) {
  const lines = (scene.codeLines || []).slice(0, 4);

  // Code execution lines (complete lines reveal cleanly with [OK] badges)
  lines.forEach((rawLine, i) => {
    const lineStart = i * 0.2;
    const isVisible = sceneProgress >= lineStart;
    const isCompleted = sceneProgress >= lineStart + 0.22;
    const y = stageTop + 74 + i * 38;

    drawRoundedRect(ctx, 48, y - 22, width - 96, 32, 8);
    ctx.fillStyle = isVisible ? "#101014" : "#09090b";
    ctx.fill();
    ctx.strokeStyle = isVisible ? "#27272a" : "#18181b";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Status pill on left
    ctx.fillStyle = isCompleted ? "#ffffff" : isVisible ? "#a1a1aa" : "#3f3f46";
    ctx.font = "bold 10px monospace";
    ctx.fillText(isCompleted ? "[OK]" : isVisible ? "[..]" : "[--]", 58, y - 2);

    if (isVisible) {
      const cleanLine = toAsciiSafe(rawLine).replace(/^\[\d+\]\s*/, "");
      const trimmed = cleanLine.length > 42 ? `${cleanLine.slice(0, 40)}..` : cleanLine;
      ctx.fillStyle = isCompleted ? "#f4f4f5" : "#ffffff";
      ctx.font = "12px monospace";
      ctx.fillText(trimmed, 96, y - 2);
    }
  });

  // Live Telemetry Sparkline Card (y = stageTop + 218 .. stageTop + 390)
  const chartY = stageTop + 218;
  const chartH = 172;
  drawRoundedRect(ctx, 48, chartY, width - 96, chartH, 14);
  ctx.fillStyle = "#0c0c10";
  ctx.fill();
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#71717a";
  ctx.font = "bold 11px monospace";
  ctx.fillText(scene.metricLabel || "FRAME PRECISION", 66, chartY + 26);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(scene.metricValue || "30 FPS", 66, chartY + 60);

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "11px monospace";
  ctx.textAlign = "right";
  ctx.fillText("LIVE TELEMETRY // ACTIVE", width - 66, chartY + 26);
  ctx.textAlign = "left";

  // Draw procedural monochrome telemetry curve inside the bottom of the card
  const plotLeft = 66;
  const plotRight = width - 66;
  const plotW = plotRight - plotLeft;
  const plotBottom = chartY + 150;
  const plotTop = chartY + 78;

  const samplePts = [0.18, 0.26, 0.22, 0.45, 0.42, 0.68, 0.64, 0.86, 0.95];
  const activeCount = Math.max(2, Math.ceil(samplePts.length * Math.min(1, sceneProgress * 1.15)));

  // Area fill under curve
  ctx.beginPath();
  for (let i = 0; i < activeCount; i++) {
    const px = plotLeft + (plotW * i) / (samplePts.length - 1);
    const py = plotBottom - samplePts[i] * (plotBottom - plotTop);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  const lastIdx = activeCount - 1;
  const lastX = plotLeft + (plotW * lastIdx) / (samplePts.length - 1);
  const lastY = plotBottom - samplePts[lastIdx] * (plotBottom - plotTop);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.lineTo(lastX, plotBottom);
  ctx.lineTo(plotLeft, plotBottom);
  ctx.closePath();
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fill();

  // Glowing tracking dot at head of telemetry curve
  ctx.beginPath();
  ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

/**
 * SCENE 4: Action Blueprint Checklist + High-Contrast Inverted Monochrome CTA Card
 */
function drawScene4BlueprintCta(ctx, width, stageTop, scene, sceneProgress, triggerKeyword) {
  const steps = (scene.codeLines || []).slice(0, 3);

  steps.forEach((stepText, idx) => {
    const isChecked = sceneProgress >= idx * 0.22;
    const rowY = stageTop + 60 + idx * 66;
    drawRoundedRect(ctx, 48, rowY, width - 96, 54, 12);
    ctx.fillStyle = isChecked ? "#141418" : "#0b0b0e";
    ctx.fill();
    ctx.strokeStyle = isChecked ? "#52525b" : "#27272a";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Vector checkmark badge (No Unicode missing glyph boxes)
    const cx = 74;
    const cy = rowY + 27;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = isChecked ? "#ffffff" : "#27272a";
    ctx.fill();

    if (isChecked) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy);
      ctx.lineTo(cx - 1, cy + 4);
      ctx.lineTo(cx + 5, cy - 4);
      ctx.stroke();
    }

    const cleanStep = toAsciiSafe(stepText).replace(/^[✓x>*\-\s]+/i, "");
    const displayStep = cleanStep.length > 42 ? `${cleanStep.slice(0, 40)}...` : cleanStep;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(displayStep, 98, rowY + 32);
  });

  // High-Contrast Inverted Monochrome CTA Card (Pure White #ffffff with Black #000000 typography)
  const ctaY = stageTop + 266;
  const ctaH = 122;
  drawRoundedRect(ctx, 48, ctaY, width - 96, ctaH, 16);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.fillStyle = "#52525b";
  ctx.font = "bold 11px monospace";
  ctx.fillText("INSTANT AUTOMATED DM TRIGGER", 68, ctaY + 32);

  ctx.fillStyle = "#000000";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(`COMMENT "${triggerKeyword}" BELOW`, 68, ctaY + 72);

  ctx.fillStyle = "#27272a";
  ctx.font = "bold 12px monospace";
  ctx.fillText("-> FULL ARCHITECTURE & SOURCE SENT TO YOUR DM", 68, ctaY + 102);
}

/**
 * Optional Chat Funnel Stage for `chat_story` style
 */
function drawMonochromeChatStage(ctx, width, stageTop, scene, sceneProgress) {
  const messages = [
    { from: "user", label: "VIEWER COMMENT", text: `Commented "${scene.highlightWord || "AUTO"}" on this Reel` },
    { from: "agent", label: "AUTONOMOUS AGENT", text: `Verified trigger. Sending the ${toAsciiSafe(scene.headline).slice(0, 28)} blueprint:` },
    { from: "agent", label: "DELIVERED", text: `${scene.metricLabel}: ${scene.metricValue}` }
  ];

  messages.forEach((m, idx) => {
    if (sceneProgress >= idx * 0.25) {
      const by = stageTop + 62 + idx * 106;
      const isAgent = m.from === "agent";
      const bx = isAgent ? 74 : 48;
      const bw = width - 122;

      drawRoundedRect(ctx, bx, by, bw, 88, 14);
      ctx.fillStyle = isAgent ? "#ffffff" : "#141418";
      ctx.fill();
      ctx.strokeStyle = isAgent ? "#ffffff" : "#3f3f46";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = isAgent ? "#52525b" : "#a1a1aa";
      ctx.font = "bold 10px monospace";
      ctx.fillText(m.label, bx + 18, by + 24);

      ctx.fillStyle = isAgent ? "#000000" : "#ffffff";
      ctx.font = "bold 14px sans-serif";
      wrapTextBounded(ctx, m.text, bx + 18, by + 48, bw - 36, 20, 2);
    }
  });
}

/**
 * Renders 4 Monochrome 4:5 Portrait Carousel PNG slides for Instagram & Facebook Feed.
 */
async function renderCarouselSlides({ reelId, spec, triggerKeyword }) {
  const urls = [];
  const w = 720;
  const h = 900;

  for (let i = 0; i < spec.scenes.length; i++) {
    const scene = spec.scenes[i];
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");

    // Pure Black Monochrome Canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);

    // Subtle architectural grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    for (let x = 36; x < w; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 36; y < h; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Slide badge pill
    const pillLabel = `${toAsciiSafe(scene.badge)} // 0${i + 1}/04`;
    ctx.font = "bold 15px monospace";
    const pillW = Math.max(240, Math.ceil(ctx.measureText(pillLabel).width) + 44);
    drawRoundedRect(ctx, 48, 48, pillW, 40, 20);
    ctx.fillStyle = "#09090b";
    ctx.fill();
    ctx.strokeStyle = "#3f3f46";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(pillLabel, 68, 74);

    // Headline
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 40px sans-serif";
    wrapTextBounded(ctx, toAsciiSafe(scene.headline), 48, 148, w - 96, 50, 3);

    // Monochrome Code / System Card
    drawRoundedRect(ctx, 48, 300, w - 96, 300, 20);
    ctx.fillStyle = "#09090b";
    ctx.fill();
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    (scene.codeLines || []).slice(0, 4).forEach((line, idx) => {
      ctx.fillStyle = idx === 0 ? "#a1a1aa" : "#ffffff";
      ctx.font = "bold 16px monospace";
      ctx.fillText(toAsciiSafe(line).slice(0, 52), 74, 360 + idx * 52, w - 148);
    });

    // Metric pill inside card
    drawRoundedRect(ctx, 74, 535, w - 148, 44, 10);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#000000";
    ctx.font = "bold 15px monospace";
    ctx.fillText(`${toAsciiSafe(scene.metricLabel)}: ${toAsciiSafe(scene.metricValue)}`, 92, 563);

    // Key takeaway voiceover
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "24px sans-serif";
    wrapTextBounded(ctx, toAsciiSafe(scene.voiceover), 48, 660, w - 96, 34, 4);

    // Footer CTA
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px monospace";
    ctx.fillText(
      i < 3 ? "SWIPE FOR NEXT STAGE ->" : `COMMENT "${triggerKeyword}" FOR THE BLUEPRINT ->`,
      48,
      h - 44
    );

    const filename = `${reelId}_slide_${i + 1}.png`;
    const filePath = path.join(OUTPUT_DIR, "carousels", filename);
    fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
    urls.push(`/output/carousels/${filename}`);
  }

  return urls;
}

/**
 * Windowed Karaoke Word Renderer:
 * Pre-computes wrapped lines and slides the visible window so active words
 * are ALWAYS centered inside the subtitle box and NEVER overflow!
 */
function drawWindowedKaraokeWords({
  ctx,
  words,
  activeWordIndex,
  highlightWord,
  x,
  y,
  maxWidth,
  lineHeight,
  maxVisibleLines = 4
}) {
  ctx.font = "bold 22px sans-serif";
  if (!words.length) return;

  // 1. Group words into wrapped lines first
  const lines = [];
  let currentLine = [];
  let currentWidth = 0;

  words.forEach((word, idx) => {
    const wWidth = ctx.measureText(word + " ").width;
    if (currentLine.length > 0 && currentWidth + wWidth > maxWidth) {
      lines.push(currentLine);
      currentLine = [{ word, idx, width: wWidth }];
      currentWidth = wWidth;
    } else {
      currentLine.push({ word, idx, width: wWidth });
      currentWidth += wWidth;
    }
  });
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // 2. Find which line contains activeWordIndex
  let activeLineIdx = 0;
  lines.forEach((line, lIdx) => {
    if (line.some((item) => item.idx === activeWordIndex)) {
      activeLineIdx = lIdx;
    }
  });

  // 3. Compute sliding window of maxVisibleLines so active line is always visible
  let startLine = Math.max(0, activeLineIdx - 1);
  if (startLine + maxVisibleLines > lines.length) {
    startLine = Math.max(0, lines.length - maxVisibleLines);
  }
  const visibleLines = lines.slice(startLine, startLine + maxVisibleLines);

  // 4. Render visible lines cleanly inside the box
  visibleLines.forEach((line, rowOffset) => {
    let cursorX = x;
    const cursorY = y + rowOffset * lineHeight;

    line.forEach((item) => {
      const cleanWord = item.word.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const cleanHighlight = (highlightWord || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const isActive = item.idx === activeWordIndex;
      const isSpoken = item.idx < activeWordIndex;
      const isTarget = cleanHighlight && cleanWord === cleanHighlight;

      if (isActive) {
        drawRoundedRect(ctx, cursorX - 5, cursorY - 21, item.width + 2, 28, 6);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.fillStyle = "#000000";
      } else if (isTarget || isSpoken) {
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.fillStyle = "#52525b";
      }

      ctx.fillText(item.word, cursorX, cursorY);
      cursorX += item.width;
    });
  });
}

function wrapTextBounded(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let curY = y;
  let lineCount = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lineCount++;
      if (lineCount >= maxLines) {
        ctx.fillText(`${line.trim()}...`, x, curY, maxWidth);
        return;
      }
      ctx.fillText(line.trim(), x, curY, maxWidth);
      line = words[n] + " ";
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line.trim()) {
    ctx.fillText(line.trim(), x, curY, maxWidth);
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

module.exports = {
  VIDEO_STYLES,
  generateCodeToVideoReel
};
