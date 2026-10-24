# ⚡ Marketing-Team — Autonomous AI Reels & Posts Agent

An end-to-end **Autonomous AI Marketing & Code-to-Video Reels Agent** built to:
1. **Connect via a Single Facebook Token (`Meta Graph API`)** — Automatically discovers your **Facebook Page** AND your **linked Instagram Business/Creator Account** (`instagram_business_account`) without needing separate Instagram credentials.
2. **Audit Your Profile Content & Comments** — Analyzes your past Instagram & Facebook Reels/Posts (Views, Saves, Shares, Comment-to-DM conversion rates), identifies winning hook formulas, flags low-retention formats (like static Pollinations slideshows), and mines unanswered audience questions from comments.
3. **Render Real 9:16 Video in Code (No Video API Keys Needed!)** — Uses **1 Text-to-Text API Key** ([Velona.in](https://velona.in) OpenAI-compatible `/v1` + Native INR gateway, supporting `anthropic/claude-sonnet-4-6`, `openai/gpt-4o`, `google/gemini-2.0-flash`, etc.) to write:
   - Viral 3-second scroll-stop hooks & 4-scene scripts
   - **Remotion React (`.tsx`) Motion-Graphics Source Code**
   - **9:16 Vertical H.264 `.mp4` Video Reels** (rendered locally with `@napi-rs/canvas` + `@ffmpeg-installer/ffmpeg`, complete with animated code terminals, live ₹ counters, chat bubbles, word-by-word karaoke subtitles, and audio track)
   - **4-Slide 4:5 Portrait Carousel PNGs** for Instagram & Facebook feed posts
4. **Take Autonomous Actions to Earn Money** — Auto-publishes Reels & Carousels to **both Instagram & Facebook**, replies to comments, and sends **Private Reply Auto-DMs** (`/{comment-id}/private_replies`) with your payment/affiliate link whenever someone comments your trigger keyword (e.g., `"AUTO"`).

---

## 🚀 Quickstart

### 1. Install & Run Hybrid Web Dashboard
```bash
npm install
cp .env.example .env   # Optional: or configure directly in the Web UI
npm start
```
Open **`http://localhost:3000`** to access the **Autonomous AI Reels & Posts Studio**.

### 2. Run Headless CLI / Cron Autopilot
```bash
npm run autopilot   # Full loop: Analyze Profile -> Reply/DM Leads -> Render Code-to-Video MP4 -> Publish IG + FB
npm run analyze     # Audit connected Facebook & Linked Instagram profile + print Action Queue
npm run render      # Render a new 9:16 Code-to-Video MP4 Reel + 4 Carousel PNGs + Remotion .tsx
```

### 3. Run 100% Free on GitHub Actions (No Server Required)
A ready-to-run cron workflow is included in [`.github/workflows/autopilot-reels.yml`](.github/workflows/autopilot-reels.yml).
Just add two repository secrets in **GitHub Settings → Secrets and variables → Actions**:
- `VELONA_API_KEY`: Your `sk-...` key from [velona.in/keys](https://velona.in/keys) (UPI top-up from ₹10)
- `FB_PAGE_ACCESS_TOKEN`: Your Facebook Page Access Token (auto-discovers your linked Instagram account)
