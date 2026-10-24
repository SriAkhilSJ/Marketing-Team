const { loadState, saveState } = require("./config");
const { analyzeProfileAndPlanActions } = require("./profileAnalyzer");
const { generateCodeToVideoReel } = require("./codeVideoEngine");
const { publishReelCrossPlatform, replyAndSendMonetizationDm } = require("./metaGraphClient");
const { rememberContactedUser } = require("./memoryRagEngine");

/**
 * Runs the complete Autonomous Loop:
 *   1. Analyze Profile Content (IG + FB via single Facebook Page connection)
 *   2. Auto-Reply & Send Monetization DMs to pending comment leads
 *   3. Write Hook, Script & Render 60fps Code-to-Video Reel (.mp4) + 4-Slide Carousel (.png)
 *   4. Auto-Publish to Instagram & Facebook (or Queue in Hybrid Dashboard)
 */
async function runFullAutopilotCycle({ customTopic = "", preferredStyle = "", forcePublish = false } = {}) {
  const state = loadState();
  const { settings } = state;
  const cycleSteps = [];

  // Step 1: Analyze Profile
  const analysisReport = await analyzeProfileAndPlanActions(state);
  cycleSteps.push({
    step: "1. Profile & Content Analysis",
    status: "COMPLETED",
    detail: analysisReport.summaryDiagnosis
  });

  // Step 2: Execute Comment Auto-Replies & Monetization DM Funnel
  let dmProcessedCount = 0;
  if (settings.autoReplyComments || settings.autoDmLeads) {
    const dmResult = await processPendingCommentActions(state);
    dmProcessedCount = dmResult.processedCount;
    cycleSteps.push({
      step: "2. Comment Replies & Auto-DM Money Funnel",
      status: "COMPLETED",
      detail: `Replied & sent Private DM offer links to ${dmResult.processedCount} commenters (${dmResult.leadsCount} '${settings.dmTriggerKeyword}' keyword leads, ${dmResult.questionsCount} audience questions).`
    });
  }

  // Step 3: Generate Code-to-Video Reel + Carousel
  const reelItem = await generateCodeToVideoReel({
    settings,
    analysisReport,
    customTopic,
    preferredStyle
  });

  cycleSteps.push({
    step: "3. Claude Code-to-Video + Carousel Render",
    status: "COMPLETED",
    detail: `Rendered 9:16 MP4 Reel (${reelItem.videoUrl}) + Remotion .tsx code + 4 Carousel slides using style '${reelItem.visualStyleName}'.`
  });

  // Step 4: Publish or Queue based on automationMode
  const shouldAutoPublish =
    forcePublish || settings.automationMode === "full_autopilot";

  if (shouldAutoPublish) {
    const pubResult = await publishReelCrossPlatform({
      settings,
      reelItem,
      localMp4Path: reelItem.localMp4Path
    });
    reelItem.status = "PUBLISHED";
    reelItem.publishedAt = new Date().toISOString();
    reelItem.publishResult = pubResult;

    cycleSteps.push({
      step: "4. Cross-Platform Auto-Publish (FB -> IG + FB)",
      status: "PUBLISHED",
      detail: `IG: ${pubResult.instagram.message} | FB: ${pubResult.facebook.message}`
    });
  } else {
    reelItem.status = "READY_FOR_1CLICK_PUBLISH";
    cycleSteps.push({
      step: "4. Queued in Hybrid Studio Dashboard",
      status: "READY",
      detail: "Video & Carousel rendered and ready for 1-click publish (or switch mode to Full Autopilot for instant publishing)."
    });
  }

  state.contentQueue = [reelItem, ...(state.contentQueue || [])].slice(0, 15);
  state.actionHistory = [
    {
      id: `cycle_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "FULL_AUTOPILOT_CYCLE",
      reelId: reelItem.id,
      reelTitle: reelItem.title,
      dmProcessedCount,
      steps: cycleSteps
    },
    ...(state.actionHistory || [])
  ].slice(0, 30);

  saveState(state);

  return {
    analysisReport,
    reelItem,
    dmProcessedCount,
    cycleSteps
  };
}

/**
 * Processes unanswered comments across Instagram & Facebook posts:
 *   - Keyword comments (e.g., "AUTO") get a public reply + Private DM with monetization link
 *   - Questions get a helpful on-brand public reply + DM invite
 */
async function processPendingCommentActions(state) {
  const { settings, profileSnapshot } = state;
  const triggerKeyword = (settings.dmTriggerKeyword || "AUTO").toUpperCase();
  let processedCount = 0;
  let leadsCount = 0;
  let questionsCount = 0;
  const actionLogs = [];

  for (const post of profileSnapshot.recentPosts || []) {
    for (const comment of post.topComments || []) {
      if (comment.replied) continue;

      const isKeywordLead = (comment.text || "").toUpperCase().includes(triggerKeyword);
      const publicReplyText = isKeywordLead
        ? `Just sent the full ${settings.monetizationOffer} + GitHub setup straight to your DMs ${comment.user}! Check your message requests ⚡🔥`
        : `Great question ${comment.user}! Because Facebook Page is linked to Instagram Business, one Facebook Page token handles both IG & FB Reels automatically. Just sent you a breakdown in DM!`;

      const privateDmText =
        `Hey ${comment.user}! 👋 Here is the ${settings.monetizationOffer} you requested from my Reel:\n\n` +
        `👉 Instant Access: ${settings.monetizationUrl}\n\n` +
        `Includes the Profile Analyzer + Claude Code-to-Video Engine + Auto-Poster for Instagram & Facebook!`;

      await replyAndSendMonetizationDm({
        settings,
        comment,
        publicReplyText,
        privateDmText
      });

      comment.replied = true;
      comment.dmSent = true;
      comment.publicReplyText = publicReplyText;
      comment.privateDmText = privateDmText;
      comment.repliedAt = new Date().toISOString();

      rememberContactedUser(comment.user, triggerKeyword);

      processedCount++;
      if (isKeywordLead) {
        leadsCount++;
        post.metrics.dmLeadsTriggered = (post.metrics.dmLeadsTriggered || 0) + 1;
        post.metrics.estimatedRevenueInr = (post.metrics.estimatedRevenueInr || 0) + 499;
      } else {
        questionsCount++;
      }

      actionLogs.push({
        commentUser: comment.user,
        platform: comment.platform,
        commentText: comment.text,
        publicReplyText,
        privateDmText
      });
    }
  }

  if (processedCount > 0) {
    state.actionHistory = [
      {
        id: `dm_batch_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "COMMENT_AND_DM_FUNNEL",
        processedCount,
        leadsCount,
        questionsCount,
        details: actionLogs
      },
      ...(state.actionHistory || [])
    ].slice(0, 30);
    saveState(state);
  }

  return {
    processedCount,
    leadsCount,
    questionsCount,
    actionLogs
  };
}

module.exports = {
  runFullAutopilotCycle,
  processPendingCommentActions
};
