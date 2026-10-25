// Dynamic Browser-side Meta Graph API v25.0 Channel & Reels Auditor (Zero Hardcoded IDs)
(function () {
  async function safeFetchJson(url) {
    try {
      const r = await fetch(url);
      return await r.json();
    } catch (e) {
      return { error: { message: e.message } };
    }
  }

  function stripPaging(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(stripPaging);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'paging') continue;
      out[k] = stripPaging(v);
    }
    return out;
  }

  async function fetchIgAccountAudit(igUserId, token) {
    if (!igUserId || !token) return null;
    const profileFields = 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website';
    const profile = await safeFetchJson(
      `https://graph.facebook.com/v25.0/${igUserId}?fields=${encodeURIComponent(profileFields)}&access_token=${encodeURIComponent(token)}`
    );

    const mediaFields = 'id,caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink,shortcode,thumbnail_url,comments.limit(15){id,text,username,timestamp}';
    const mediaResp = await safeFetchJson(
      `https://graph.facebook.com/v25.0/${igUserId}/media?fields=${encodeURIComponent(mediaFields)}&limit=25&access_token=${encodeURIComponent(token)}`
    );
    const items = stripPaging((mediaResp && mediaResp.data) || []);

    return {
      profile: stripPaging(profile),
      media_count_fetched: items.length,
      media: items,
      media_error: mediaResp && mediaResp.error ? mediaResp.error : null,
    };
  }

  async function fetchFbPageAudit(fbPageId, pageToken) {
    if (!fbPageId || !pageToken) return null;
    const pageFields = 'id,name,about,category,fan_count,followers_count,talking_about_count,link';
    const profile = await safeFetchJson(
      `https://graph.facebook.com/v25.0/${fbPageId}?fields=${encodeURIComponent(pageFields)}&access_token=${encodeURIComponent(pageToken)}`
    );

    const videoFields = 'id,title,description,views,length,created_time,permalink_url,likes.limit(0).summary(true),comments.limit(15).summary(true){id,message,created_time}';
    const videosResp = await safeFetchJson(
      `https://graph.facebook.com/v25.0/${fbPageId}/videos?fields=${encodeURIComponent(videoFields)}&limit=25&access_token=${encodeURIComponent(pageToken)}`
    );

    const postsFields = 'id,message,created_time,permalink_url,shares,likes.limit(0).summary(true),comments.limit(5).summary(true){id,message,created_time}';
    const postsResp = await safeFetchJson(
      `https://graph.facebook.com/v25.0/${fbPageId}/published_posts?fields=${encodeURIComponent(postsFields)}&limit=25&access_token=${encodeURIComponent(pageToken)}`
    );

    return {
      profile: stripPaging(profile),
      videos: stripPaging((videosResp && videosResp.data) || []),
      videos_error: videosResp && videosResp.error ? videosResp.error : null,
      posts: stripPaging((postsResp && postsResp.data) || []),
      posts_error: postsResp && postsResp.error ? postsResp.error : null,
    };
  }

  function channelKeyFromPage(pageObj, idx) {
    const name = String((pageObj && pageObj.fb_page_name) || '').toLowerCase();
    if (name.includes('anime')) return 'anime_channel';
    if (name.includes('meme')) return 'memes_channel';
    const slug = name.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return slug ? `${slug}_channel` : `channel_${idx + 1}`;
  }

  async function runFullCreatorAudit() {
    try {
      const cfgResp = await fetch('/api/studio/config');
      const cfg = await cfgResp.json();
      const disc = (cfg && cfg.discovered) || {};
      const userToken = cfg && cfg.fb_access_token;
      const pages = Array.isArray(disc.all_pages) && disc.all_pages.length
        ? disc.all_pages
        : (disc.fb_page_id ? [disc] : []);
      if (!pages.length || (!userToken && !disc.fb_page_access_token)) return null;

      const payload = {
        loaded: true,
        fetched_at: new Date().toISOString(),
      };
      let hasRealData = false;

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const pageId = p.fb_page_id;
        const pageToken = p.fb_page_access_token || userToken;
        const igId = p.ig_user_id || '';
        const [igAudit, fbAudit] = await Promise.all([
          igId ? fetchIgAccountAudit(igId, pageToken) : Promise.resolve(null),
          pageId ? fetchFbPageAudit(pageId, pageToken) : Promise.resolve(null),
        ]);
        if (
          (igAudit && Array.isArray(igAudit.media) && igAudit.media.length > 0) ||
          (fbAudit && Array.isArray(fbAudit.videos) && fbAudit.videos.length > 0)
        ) {
          hasRealData = true;
        }
        const key = channelKeyFromPage(p, i);
        payload[key] = {
          ig_user_id: igId,
          ig_username: p.ig_username || (igAudit && igAudit.profile && igAudit.profile.username) || '',
          fb_page_id: pageId,
          fb_page_name: p.fb_page_name || (fbAudit && fbAudit.profile && fbAudit.profile.name) || '',
          instagram: igAudit,
          facebook: fbAudit,
        };
      }

      if (!hasRealData) {
        return null;
      }

      await fetch('/api/studio/save-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      window.__latestCreatorAudit = payload;
      window.dispatchEvent(new CustomEvent('creator-audit-ready', { detail: payload }));
      return payload;
    } catch (err) {
      console.error('Creator audit error:', err);
      return null;
    }
  }

  window.runFullCreatorAudit = runFullCreatorAudit;
  runFullCreatorAudit();
})();
