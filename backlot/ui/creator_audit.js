// Browser-side Meta Graph API v25.0 Creator Audit for @naruto.uzumaki8067 & AnimeEdits
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

    const mediaFields = 'id,caption,media_type,media_product_type,like_count,comments_count,timestamp,permalink,shortcode,thumbnail_url,comments.limit(10){id,text,username,timestamp}';
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

  async function runFullCreatorAudit() {
    try {
      const cfgResp = await fetch('/api/studio/config');
      const cfg = await cfgResp.json();
      const disc = (cfg && cfg.discovered) || {};
      const userToken = cfg && cfg.fb_access_token;
      if (!userToken && !disc.fb_page_access_token) return null;

      const animePage =
        ((disc.all_pages || []).find((p) => String(p.fb_page_id) === '1316616991525561')) ||
        disc;
      const animePageToken = animePage.fb_page_access_token || disc.fb_page_access_token || userToken;
      const animeIgId = animePage.ig_user_id || disc.ig_user_id || '17841445027584531';

      const memesPage = (disc.all_pages || []).find((p) => String(p.fb_page_id) === '1256219754250223');
      const memesPageToken = (memesPage && memesPage.fb_page_access_token) || userToken;
      const memesIgId = (memesPage && memesPage.ig_user_id) || '17841438515530864';

      const [igAnime, fbAnime, igMemes, fbMemes] = await Promise.all([
        fetchIgAccountAudit(animeIgId, animePageToken),
        fetchFbPageAudit('1316616991525561', animePageToken),
        fetchIgAccountAudit(memesIgId, memesPageToken),
        fetchFbPageAudit('1256219754250223', memesPageToken),
      ]);

      const payload = {
        loaded: true,
        fetched_at: new Date().toISOString(),
        anime_channel: {
          ig_user_id: animeIgId,
          ig_username: 'naruto.uzumaki8067',
          fb_page_id: '1316616991525561',
          fb_page_name: 'AnimeEdits',
          instagram: igAnime,
          facebook: fbAnime,
        },
        memes_channel: {
          ig_user_id: memesIgId,
          ig_username: 'memes.com409559',
          fb_page_id: '1256219754250223',
          fb_page_name: 'Memes.com',
          instagram: igMemes,
          facebook: fbMemes,
        },
      };

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
