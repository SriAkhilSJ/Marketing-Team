const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createCanvas } = require("@napi-rs/canvas");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { callVelonaChat, parseJsonSafely, resolveEnvConfig } = require("./velonaClient");
const { OUTPUT_DIR } = require("./config");
const { retrieveContextFromRag, rememberGeneratedReel } = require("./memoryRagEngine");

const VIDEO_STYLES = {
  fireship_code: {
    id: "fireship_code",
    name: "Fireship / Claude Code Breakdown",
    accent: "#00f2fe",
    secondary: "#7c3aed",
    bgTop: "#090d16",
    bgBottom: "#0f172a"
  },
  data_counter: {
    id: "data_counter",
    name: "Live ₹ Revenue & Metric Counter",
    accent: "#10b981",
    secondary: "#3b82f6",
    bgTop: "#06120e",
    bgBottom: "#0f172a"
  },
  chat_story: {
    id: "chat_story",
    name: "Animated iMessage / DM Funnel Story",
    accent: "#f59e0b",
    secondary: "#ec4899",
    bgTop: "#130b1c",
    bgBottom: "#0f172a"
  },
  minimal_wealth: {
    id: "minimal_wealth",
    name: "Dan Koe / Minimalist Motion System",
    accent: "#f8fafc",
    secondary: "#38bdf8",
    bgTop: "#050505",
    bgBottom: "#111827"
  },
  quiz_challenge: {
    id: "quiz_challenge",
    name: "Interactive Timer Hook & Reveal",
    accent: "#f43f5e",
    secondary: "#eab308",
    bgTop: "#180812",
    bgBottom: "#0f172a"
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
    "How My AI Agent Audits My Profile & Renders 60fps Code Reels on Autopilot";

  const targetQuestion =
    analysisReport?.recommendedNextReel?.targetQuestion ||
    "How do you connect Facebook to auto-post Reels to Instagram and earn money with 1 text API key?";

  // 0. Retrieve relevant context from RAG Knowledge Base + Episodic Post Memory (Anti-Duplicate Guard)
  const ragContext = retrieveContextFromRag(`${targetTopic} ${targetQuestion} ${settings.niche}`);

  // 1. Ask Velona LLM (DeepSeek / GLM / Claude / GPT) with injected RAG Memory Context
  const systemPrompt =
    "You are an expert viral Instagram/Facebook Reels scriptwriter and Remotion motion-graphics developer with persistent RAG memory. " +
    "Use the retrieved RAG Knowledge Base facts and Winning Past Episodes below. " +
    "NEVER repeat any hook from pastHooksToAvoid. " +
    "Create a 4-scene high-retention vertical Reel (Hook -> Problem/Why Slideshows Fail -> Code Solution -> Monetization CTA). " +
    "Output strict JSON with keys: " +
    "title (string), hookText (string, max 9 words), visualStyle (string), " +
    "caption (string with hook, bullet points, CTA to comment the trigger keyword, and hashtags), " +
    "voiceoverFull (string), " +
    "scenes (array of 4 objects, each with: badge, headline, voiceover, codeLines (array of 4 short code lines), metricLabel, metricValue, highlightWord).";

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
    settings
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
    llmModelUsed: llmRes.ok ? llmRes.model : `${settings.llmModel} (Built-in Code Studio)`,
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

  // 4. Save newly generated Reel into persistent Episodic Memory so the agent remembers it forever
  rememberGeneratedReel(reelResult);

  return reelResult;
}

function buildSceneSpec(parsed, { targetTopic, targetQuestion, triggerKeyword, styleKey, settings }) {
  const envCfg = resolveEnvConfig(settings);
  const activeBaseUrl = envCfg.baseUrl || "$VELONA_BASE_URL";
  const activeModel = envCfg.model || "$LLM_MODEL";

  const defaultScenes = [
    {
      badge: "01 // SCROLL-STOP HOOK",
      headline: "Stop Using Static AI Slideshows",
      voiceover: "Stop using cheap AI image slideshows for Reels. Our agent writes real 60fps video in code using environment variables from your terminal.",
      codeLines: [
        "// 1. Read Env Config (Zero Hardcoding)",
        "const { VELONA_BASE_URL, LLM_MODEL } = process.env;",
        "// 2. Audit IG + FB Profile via Graph API",
        "const audit = await agent.analyzeProfile(fbToken);"
      ],
      metricLabel: "3-SEC HOOK RETENTION",
      metricValue: "84.6%",
      highlightWord: "60fps"
    },
    {
      badge: "02 // PROFILE ANALYSIS",
      headline: "Agent Audits Your IG & FB First",
      voiceover: "First, the agent connects to your Facebook Page, discovers your linked Instagram, and finds which hooks got the most saves.",
      codeLines: [
        "GET /me/accounts?fields=instagram_business_account",
        "savesWeight = 3.0; sharesWeight = 3.0;",
        `winningFormat = '${styleKey}' // +14.2x views`,
        "nextTopic = comments.mineTopQuestion();"
      ],
      metricLabel: "SAVE RATE BOOST",
      metricValue: "+14.2x",
      highlightWord: "saves"
    },
    {
      badge: "03 // CODE-TO-VIDEO ENGINE",
      headline: `Powered by ${activeModel}`,
      voiceover: `Then it calls ${activeModel} via your configured base URL to render kinetic typography, charts, and voiceover for pennies.`,
      codeLines: [
        `POST ${activeBaseUrl}/chat/completions`,
        `model: '${activeModel}'`,
        "renderFrames({ fps: 24, size: '540x960' });",
        "costInr: '~₹0.08 per Reel (UPI Top-Up)'"
      ],
      metricLabel: "COST PER REEL",
      metricValue: "₹0.08",
      highlightWord: "code"
    },
    {
      badge: "04 // AUTO-POST & EARN",
      headline: `Comment '${triggerKeyword}' For The Repo`,
      voiceover: `It auto-posts to Instagram and Facebook and DMs your payment link to every comment. Comment ${triggerKeyword} and I'll send you the full code.`,
      codeLines: [
        "await meta.publishReel({ igId, fbPageId, mp4 });",
        `if (comment.includes('${triggerKeyword}')) {`,
        "  await meta.sendPrivateReplyDM(comment.id, offerUrl);",
        "}"
      ],
      metricLabel: "AUTO-DM CONVERSION",
      metricValue: "71.4%",
      highlightWord: triggerKeyword
    }
  ];

  const scenes =
    Array.isArray(parsed?.scenes) && parsed.scenes.length >= 3
      ? parsed.scenes.slice(0, 4).map((s, i) => ({
          badge: s.badge || defaultScenes[i].badge,
          headline: s.headline || defaultScenes[i].headline,
          voiceover: s.voiceover || defaultScenes[i].voiceover,
          codeLines:
            Array.isArray(s.codeLines) && s.codeLines.length > 0
              ? s.codeLines.slice(0, 4)
              : defaultScenes[i].codeLines,
          metricLabel: s.metricLabel || defaultScenes[i].metricLabel,
          metricValue: s.metricValue || defaultScenes[i].metricValue,
          highlightWord: s.highlightWord || defaultScenes[i].highlightWord
        }))
      : defaultScenes;

  const hookText =
    parsed?.hookText ||
    (targetTopic.length <= 58 ? targetTopic : "My AI Agent Audits My Profile & Writes Video in Code ⚡");

  const voiceoverFull =
    parsed?.voiceoverFull || scenes.map((s) => s.voiceover).join(" ");

  const caption =
    parsed?.caption ||
    `${hookText}\n\n` +
      `Most creators waste money on expensive video APIs or post low-retention image slideshows.\n\n` +
      `Here is how this Autonomous Agent works on autopilot:\n` +
      `1️⃣ Connects via a single Facebook Page token (auto-discovers your linked Instagram)\n` +
      `2️⃣ Audits your past Reels, Saves, Shares & unanswered comment questions\n` +
      `3️⃣ Uses 1 Text-to-Text API key (Velona.in / Claude) to write 60fps Code-to-Video animations + neural voiceover\n` +
      `4️⃣ Auto-publishes to Instagram & Facebook + DMs your offer link to commenters\n\n` +
      `👇 Comment "${triggerKeyword}" below and my agent will instantly DM you the setup & blueprint (${settings.monetizationOffer})!\n\n` +
      `#aiagents #instagramreels #remotion #coding #automation #passiveincome #indiedev #contentautomation`;

  return {
    title: parsed?.title || targetTopic,
    hookText,
    visualStyle: styleKey,
    targetQuestion,
    caption,
    voiceoverFull,
    scenes
  };
}

/**
 * Generates clean, copy-pasteable Remotion (.tsx) source code for the Reel
 * so the user also has full React/Remotion project code for every video.
 */
function generateRemotionTsxCode(spec, styleCfg) {
  const scenesJson = JSON.stringify(spec.scenes, null, 2);
  return `// Auto-Generated by Marketing-Team Autonomous Code-to-Video Agent
// Style: ${styleCfg.name} | Resolution: 1080x1920 (9:16 Vertical Reel)
import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  spring,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Audio
} from 'remotion';

const SCENES = ${scenesJson};

export const AutonomousCodeReel: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const framesPerScene = 3 * fps; // 3 seconds per scene

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(180deg, ${styleCfg.bgTop} 0%, ${styleCfg.bgBottom} 100%)',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif'
      }}
    >
      {SCENES.map((scene, index) => (
        <Sequence
          key={index}
          from={index * framesPerScene}
          durationInFrames={framesPerScene}
        >
          <SceneView scene={scene} accent="${styleCfg.accent}" secondary="${styleCfg.secondary}" />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const SceneView: React.FC<{ scene: any; accent: string; secondary: string }> = ({
  scene,
  accent,
  secondary
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 14, stiffness: 140 } });
  const translateY = interpolate(entrance, [0, 1], [45, 0]);

  return (
    <AbsoluteFill style={{ padding: 64, justifyContent: 'space-between' }}>
      <div style={{ transform: \`translateY(\${translateY}px)\`, opacity: entrance }}>
        <div
          style={{
            display: 'inline-block',
            padding: '10px 22px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            border: \`2px solid \${accent}\`,
            color: accent,
            fontWeight: 800,
            fontSize: 24
          }}
        >
          {scene.badge}
        </div>
        <h1 style={{ fontSize: 68, fontWeight: 900, lineHeight: 1.08, marginTop: 28 }}>
          {scene.headline}
        </h1>
      </div>

      {/* Programmatic Code / Motion Card */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          borderRadius: 28,
          padding: 40,
          border: '1px solid rgba(148, 163, 184, 0.25)',
          boxShadow: \`0 24px 60px rgba(0, 0, 0, 0.55)\`
        }}
      >
        {scene.codeLines.map((line: string, idx: number) => (
          <pre
            key={idx}
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 28,
              color: line.startsWith('//') ? '#94a3b8' : accent,
              margin: '14px 0'
            }}
          >
            {line}
          </pre>
        ))}
      </div>

      {/* Karaoke Caption Footer */}
      <div
        style={{
          background: 'rgba(0,0,0,0.68)',
          padding: '28px 34px',
          borderRadius: 24,
          fontSize: 38,
          fontWeight: 800,
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
 * Renders a real 9:16 vertical H.264 MP4 video with animated frames + synthesized audio track
 * using @napi-rs/canvas piped into @ffmpeg-installer/ffmpeg.
 */
async function renderMp4FromCodeSpec({ spec, styleCfg, outputPath }) {
  const width = 540;
  const height = 960;
  const fps = 24;
  const secondsPerScene = 2.5;
  const framesPerScene = Math.round(fps * secondsPerScene); // 60 frames/scene
  const totalScenes = spec.scenes.length;
  const totalFrames = framesPerScene * totalScenes; // 240 frames = 10.0s
  const totalDurationSec = totalFrames / fps;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      // Video input: raw RGBA frames from canvas
      "-f",
      "rawvideo",
      "-vcodec",
      "rawvideo",
      "-pix_fmt",
      "rgba",
      "-s",
      `${width}x${height}`,
      "-r",
      String(fps),
      "-i",
      "pipe:0",
      // Synthesized ambient tech pulse audio stream (Instagram & Facebook require an audio track!)
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=0.08*sin(2*PI*110*t)+0.05*sin(2*PI*220*t)*(1+0.6*sin(2*PI*2.5*t))+0.03*sin(2*PI*440*t)*exp(-mod(t\\,0.5)*6):s=44100:d=${totalDurationSec}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath
    ];

    const ff = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderrLog = "";
    ff.stderr.on("data", (chunk) => {
      stderrLog += chunk.toString();
    });

    ff.on("error", (err) => reject(err));
    ff.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderrLog.slice(-300)}`));
      }
    });

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

function drawCodeVideoFrame({
  ctx,
  width,
  height,
  spec,
  scene,
  sceneIdx,
  totalScenes,
  sceneProgress,
  globalProgress,
  styleCfg
}) {
  // 1. Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, styleCfg.bgTop);
  grad.addColorStop(1, styleCfg.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle animated cyber grid
  ctx.strokeStyle = "rgba(148, 163, 184, 0.07)";
  ctx.lineWidth = 1;
  const gridOffset = Math.round(globalProgress * 120) % 40;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = gridOffset; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Glowing orb top-right
  const orbGrad = ctx.createRadialGradient(width * 0.82, height * 0.18, 10, width * 0.82, height * 0.18, 220);
  orbGrad.addColorStop(0, hexToRgba(styleCfg.accent, 0.22));
  orbGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = orbGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Top Progress Bar & Scene Indicator
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(28, 26, width - 56, 6);
  ctx.fillStyle = styleCfg.accent;
  ctx.fillRect(28, 26, Math.round((width - 56) * globalProgress), 6);

  // Spring entrance animation factor
  const springEase = 1 - Math.pow(1 - Math.min(1, sceneProgress * 3.8), 3);
  const slideY = Math.round((1 - springEase) * 28);

  // 3. Scene Badge (dynamically sized to text width)
  ctx.save();
  ctx.translate(0, slideY);
  ctx.font = "bold 13px sans-serif";
  const badgeTextW = Math.ceil(ctx.measureText(scene.badge).width);
  drawRoundedRect(ctx, 28, 52, Math.max(210, badgeTextW + 34), 34, 17);
  ctx.fillStyle = hexToRgba(styleCfg.accent, 0.14);
  ctx.fill();
  ctx.strokeStyle = styleCfg.accent;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = styleCfg.accent;
  ctx.fillText(scene.badge, 44, 74);

  // Live Style Tag right-aligned
  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 12px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`CLAUDE CODE-TO-VIDEO // ${sceneIdx + 1}/${totalScenes}`, width - 28, 73);
  ctx.textAlign = "left";

  // 4. Headline
  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 31px sans-serif";
  wrapText(ctx, scene.headline, 28, 128, width - 56, 38);
  ctx.restore();

  // 5. Center Programmatic Motion Graphics Card (varies by style!)
  const cardTop = 225;
  const cardH = 385;
  drawRoundedRect(ctx, 28, cardTop, width - 56, cardH, 20);
  ctx.fillStyle = "rgba(15, 23, 42, 0.90)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // macOS Window Dots + Header inside card
  const dotColors = ["#ef4444", "#f59e0b", "#10b981"];
  dotColors.forEach((col, idx) => {
    ctx.beginPath();
    ctx.arc(52 + idx * 18, cardTop + 24, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });

  ctx.fillStyle = "#94a3b8";
  ctx.font = "12px monospace";
  ctx.fillText(`velona-agent://${spec.visualStyle}.tsx`, 115, cardTop + 28);

  if (spec.visualStyle === "data_counter") {
    // Animated Bar Comparison + Ticking Metric
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("LIVE PROFILE AUDIT COMPARISON", 48, cardTop + 68);

    // Bar 1: Static Slideshow
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "14px sans-serif";
    ctx.fillText("Pollinations Static Slideshow (1.1% Saves)", 48, cardTop + 104);
    drawRoundedRect(ctx, 48, cardTop + 114, 110, 22, 8);
    ctx.fillStyle = "#475569";
    ctx.fill();

    // Bar 2: Claude Code-to-Video (Animated width)
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("Claude Code-to-Video Reel (8.4% Saves)", 48, cardTop + 168);
    const barW = Math.max(40, Math.round((width - 120) * Math.min(1, sceneProgress * 1.8)));
    drawRoundedRect(ctx, 48, cardTop + 178, barW, 28, 8);
    ctx.fillStyle = styleCfg.accent;
    ctx.fill();

    // Big Metric Box
    drawRoundedRect(ctx, 48, cardTop + 232, width - 96, 125, 16);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 13px monospace";
    ctx.fillText(scene.metricLabel, 68, cardTop + 266);
    ctx.fillStyle = styleCfg.accent;
    ctx.font = "bold 46px sans-serif";
    ctx.fillText(scene.metricValue, 68, cardTop + 325);
  } else if (spec.visualStyle === "chat_story") {
    // Animated DM Funnel Chat Bubbles
    const messages = [
      { from: "them", text: `Commented "${spec.scenes[3]?.highlightWord || "AUTO"}" on your Reel! 🔥` },
      { from: "agent", text: "Hey! 👋 Sending your AI Reel Agent Blueprint + setup link right now:" },
      { from: "agent", text: `⚡ Instant Access -> ${scene.metricValue} (${scene.metricLabel})` }
    ];
    messages.forEach((m, idx) => {
      const appearAt = idx * 0.25;
      if (sceneProgress >= appearAt) {
        const bubbleY = cardTop + 62 + idx * 96;
        const isAgent = m.from === "agent";
        const bubbleX = isAgent ? 76 : 48;
        const bubbleW = width - 124;
        drawRoundedRect(ctx, bubbleX, bubbleY, bubbleW, 74, 16);
        ctx.fillStyle = isAgent ? hexToRgba(styleCfg.accent, 0.18) : "rgba(255,255,255,0.08)";
        ctx.fill();
        ctx.strokeStyle = isAgent ? styleCfg.accent : "rgba(255,255,255,0.15)";
        ctx.stroke();

        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 15px sans-serif";
        wrapText(ctx, m.text, bubbleX + 18, bubbleY + 28, bubbleW - 32, 22);
      }
    });
  } else {
    // Default / Fireship Code Terminal + Live Metric Card
    const lines = scene.codeLines || [];
    lines.forEach((line, i) => {
      const lineAppear = i * 0.16;
      if (sceneProgress >= lineAppear) {
        const charProgress = Math.min(1, (sceneProgress - lineAppear) * 3.2);
        const visibleText = line.slice(0, Math.max(1, Math.round(line.length * charProgress)));
        const y = cardTop + 76 + i * 42;

        ctx.fillStyle = "#475569";
        ctx.font = "14px monospace";
        ctx.fillText(String(i + 1).padStart(2, "0"), 48, y);

        ctx.fillStyle = line.trim().startsWith("//")
          ? "#94a3b8"
          : line.includes("POST") || line.includes("GET")
          ? "#38bdf8"
          : styleCfg.accent;
        ctx.font = "bold 14px monospace";
        ctx.fillText(visibleText, 78, y, width - 124);
      }
    });

    // Metric Highlight Box inside bottom of terminal
    drawRoundedRect(ctx, 48, cardTop + 250, width - 96, 110, 14);
    ctx.fillStyle = hexToRgba(styleCfg.accent, 0.1);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(styleCfg.accent, 0.45);
    ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 12px monospace";
    ctx.fillText(scene.metricLabel, 68, cardTop + 280);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 40px sans-serif";
    ctx.fillText(scene.metricValue, 68, cardTop + 332);

    ctx.fillStyle = styleCfg.accent;
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "right";
    ctx.fillText("● AUTOPILOT VERIFIED", width - 68, cardTop + 326);
    ctx.textAlign = "left";
  }

  // 6. Word-by-Word Karaoke Subtitles Box (Bottom Third)
  const subBoxY = 645;
  const subBoxH = 210;
  drawRoundedRect(ctx, 28, subBoxY, width - 56, subBoxH, 20);
  ctx.fillStyle = "rgba(2, 6, 23, 0.86)";
  ctx.fill();
  ctx.strokeStyle = hexToRgba(styleCfg.accent, 0.4);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const words = (scene.voiceover || "").split(/\s+/).filter(Boolean);
  const activeWordIndex = Math.min(words.length - 1, Math.floor(sceneProgress * words.length));

  drawKaraokeWords({
    ctx,
    words,
    activeWordIndex,
    highlightWord: scene.highlightWord,
    accent: styleCfg.accent,
    x: 48,
    y: subBoxY + 48,
    maxWidth: width - 96,
    lineHeight: 34
  });

  // 7. Footer Watermark / CTA Bar
  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText("⚡ VELONA.IN TEXT-TO-VIDEO AGENT", 28, height - 34);
  ctx.fillStyle = styleCfg.accent;
  ctx.textAlign = "right";
  ctx.fillText("IG REELS + FACEBOOK AUTO-POST", width - 28, height - 34);
  ctx.textAlign = "left";
}

async function renderCarouselSlides({ reelId, spec, styleCfg, triggerKeyword }) {
  const urls = [];
  const w = 720;
  const h = 900; // 4:5 Instagram Portrait Carousel Ratio

  for (let i = 0; i < spec.scenes.length; i++) {
    const scene = spec.scenes[i];
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, styleCfg.bgTop);
    grad.addColorStop(1, styleCfg.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Slide pill (dynamically sized to badge text width)
    const pillLabel = `${scene.badge} (${i + 1}/4)`;
    ctx.font = "bold 16px sans-serif";
    const pillW = Math.max(260, Math.ceil(ctx.measureText(pillLabel).width) + 44);
    drawRoundedRect(ctx, 48, 48, pillW, 42, 21);
    ctx.fillStyle = hexToRgba(styleCfg.accent, 0.16);
    ctx.fill();
    ctx.strokeStyle = styleCfg.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = styleCfg.accent;
    ctx.fillText(pillLabel, 68, 75);

    // Headline
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 44px sans-serif";
    wrapText(ctx, scene.headline, 48, 155, w - 96, 54);

    // Code block
    drawRoundedRect(ctx, 48, 280, w - 96, 320, 22);
    ctx.fillStyle = "rgba(15, 23, 42, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.stroke();

    (scene.codeLines || []).forEach((line, idx) => {
      ctx.fillStyle = line.startsWith("//") ? "#94a3b8" : styleCfg.accent;
      ctx.font = "bold 17px monospace";
      ctx.fillText(line, 74, 345 + idx * 56, w - 148);
    });

    // Voiceover / Key Takeaway
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "26px sans-serif";
    wrapText(ctx, scene.voiceover, 48, 665, w - 96, 38);

    // Footer CTA
    ctx.fillStyle = styleCfg.accent;
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(
      i < 3 ? "Swipe for next step →" : `Comment '${triggerKeyword}' and I'll DM you the link ⚡`,
      48,
      h - 48
    );

    const filename = `${reelId}_slide_${i + 1}.png`;
    const filePath = path.join(OUTPUT_DIR, "carousels", filename);
    fs.writeFileSync(filePath, canvas.toBuffer("image/png"));
    urls.push(`/output/carousels/${filename}`);
  }

  return urls;
}

function drawKaraokeWords({ ctx, words, activeWordIndex, highlightWord, accent, x, y, maxWidth, lineHeight }) {
  ctx.font = "bold 23px sans-serif";
  let cursorX = x;
  let cursorY = y;

  words.forEach((word, idx) => {
    const cleanWord = word.replace(/[^a-zA-Z0-9₹$]/g, "").toLowerCase();
    const isTargetHighlight =
      highlightWord && cleanWord === highlightWord.replace(/[^a-zA-Z0-9₹$]/g, "").toLowerCase();
    const isActive = idx === activeWordIndex;
    const isSpoken = idx <= activeWordIndex;

    const metrics = ctx.measureText(word + " ");
    if (cursorX + metrics.width > x + maxWidth) {
      cursorX = x;
      cursorY += lineHeight;
    }

    if (isActive) {
      drawRoundedRect(ctx, cursorX - 4, cursorY - 22, metrics.width + 2, 30, 6);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = "#020617";
    } else if (isTargetHighlight) {
      ctx.fillStyle = "#facc15";
    } else if (isSpoken) {
      ctx.fillStyle = "#f8fafc";
    } else {
      ctx.fillStyle = "rgba(148, 163, 184, 0.55)";
    }

    ctx.fillText(word, cursorX, cursorY);
    cursorX += metrics.width;
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = (text || "").split(" ");
  let line = "";
  let curY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
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

function hexToRgba(hex, alpha) {
  const clean = (hex || "#00f2fe").replace("#", "");
  const bigint = parseInt(clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

module.exports = {
  VIDEO_STYLES,
  generateCodeToVideoReel
};
