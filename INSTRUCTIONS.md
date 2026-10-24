# 📘 Complete Instructions & Testing Guide — Autonomous AI Reels & Posts Agent

This guide walks you through **configuring environment variables (zero hardcoding)**, **connecting Facebook + Linked Instagram**, **using the Memory & RAG Vault**, **running the Web UI Interface**, and **testing every part of the agent**.

---

## 1. Environment Variables Setup (Terminal — Zero Hardcoding)

Nothing in the codebase is hardcoded. All URLs, model IDs, and credentials are read from **environment variables** (`process.env` / `.env`).

### Option A: Set & Persist via Terminal CLI (`set-env`)
Run this single command in your terminal to write your `.env` file cleanly:

```bash
node cli.js set-env \
  --base-url "https://velona.in/v1" \
  --gateway-url "https://velona.in/gateway/v1" \
  --model "deepseek/deepseek-v4-flash" \
  --api-key "sk-your-velona-api-key" \
  --fb-token "EAAG-your-facebook-page-access-token" \
  --trigger "AUTO" \
  --style "fireship_code" \
  --offer "AI Automation Blueprint (₹499)" \
  --offer-url "https://your-payment-or-affiliate-link.com"
```

### Option B: Verify Active Environment Config
```bash
npm run env
# or: node cli.js env
```

### Option C: Pass Env Vars Inline on Any Command
```bash
VELONA_BASE_URL="https://velona.in/v1" \
LLM_MODEL="deepseek/deepseek-v4-flash" \
VELONA_API_KEY="sk-..." \
FB_PAGE_ACCESS_TOKEN="EAAG..." \
node cli.js render "How DeepSeek V4 Flash writes 60fps Reels in code"
```

---

## 2. How to Get Your 2 Keys

### Key #1: `VELONA_API_KEY` (Text-to-Text LLM in ₹ INR)
1. Go to **[velona.in/register](https://velona.in/register)** and top up from **₹10 via UPI**.
2. Go to **[velona.in/keys](https://velona.in/keys)** and copy your `sk-...` key.
3. Recommended cheapest + best models on Velona:
   - `deepseek/deepseek-v4-flash` (**₹19.42 in / ₹52.12 out per 1M** • Coding Score: **65.0** • ~**₹0.08 per Reel**)
   - `deepseek/deepseek-v4.1-flash`
   - `z-ai/glm-5.3-flash` / `z-ai/glm-5.3`
   - `qwen/qwen3-coder`
   - `google/gemini-2.5-flash-lite`

### Key #2: `FB_PAGE_ACCESS_TOKEN` (Controls Both Facebook Page & Linked Instagram)
Because your Facebook Page is linked to your Instagram Professional (Business/Creator) account:
1. Ensure your Instagram account is linked in **Facebook Page → Settings → Linked Accounts → Instagram**.
2. In **[Meta Graph API Explorer](https://developers.facebook.com/tools/explorer/)**, select your App and generate a **Page Access Token** with permissions:
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_messaging`
   - `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`
3. Paste that single token into `FB_PAGE_ACCESS_TOKEN`. The agent automatically calls `/me/accounts?fields=instagram_business_account` to discover both your **Facebook Page ID** and your **Linked Instagram Business Account ID**!

---

## 3. Running & Using the Web UI Interface

Start the Web Studio server:
```bash
npm start
```
Open **`http://localhost:3000`** in your browser:
- **Top Bar:**
  - Click **🧠 Memory & RAG Vault** to jump to the agent's persistent brain.
  - Click **🚀 Run Full Autopilot Loop Now** to run the full 4-step autonomous cycle.
  - Click **⚙️ Keys & FB Connection** to edit your env settings visually.
- **Left Column:**
  - **Step 1 • Profile Intelligence:** Click **🔍 Re-Analyze Profile Content** to audit your IG & FB posts, Save/Share ratios, and unanswered comments.
  - **Step 2 • Autonomous Execution:** Click **▶ Execute Action** on any queued action.
  - **Step 3 • Comment Auto-Reply & Private DM Funnel:** Click **+ Simulate Comment & Trigger DM** or **⚡ Reply & DM All Pending Leads** to test your monetization funnel.
  - **Step 4 • 🧠 Memory & RAG Knowledge Vault:**
    - Use **🔎 Test RAG Retrieval & Anti-Duplicate Hook Guard** to query memory and verify your hook isn't a duplicate.
    - Use **➕ Teach Agent New Knowledge** to add custom product facts, offers, or hook rules into RAG memory.
- **Right Column (Code-to-Video Studio):**
  - Pick any of the 5 programmatic video styles (`fireship_code`, `data_counter`, `chat_story`, `minimal_wealth`, `quiz_challenge`) and click **🎬 Write Code & Render 9:16 MP4**.
  - Switch tabs between **🎬 9:16 MP4 Reel**, **🖼️ 4-Slide Carousel**, **💻 Remotion `.tsx` Code**, and **📝 Script & Caption**.

---

## 4. Terminal CLI Reference (All Commands)

| Task | Terminal Command |
| :--- | :--- |
| **Run Complete End-to-End Automated Test Suite** | `npm test` *(or `node test-agent.js`)* |
| **Start Web UI Studio Server** | `npm start` |
| **Show Active Environment Variables** | `npm run env` *(or `node cli.js env`)* |
| **Save Environment Variables from Terminal** | `node cli.js set-env --model "deepseek/deepseek-v4-flash" --base-url "https://velona.in/v1"` |
| **Audit Connected IG & FB Profile Content** | `npm run analyze` *(or `node cli.js analyze`)* |
| **Render 9:16 Code-to-Video MP4 + 4 Carousel PNGs** | `npm run render -- "Your custom Reel topic"` |
| **View Persistent Memory & RAG Knowledge Base** | `npm run memory` *(or `node cli.js memory`)* |
| **Add New Knowledge Note to RAG Memory** | `node cli.js add-memory --title "Offer" --category "monetization" --content "Your rule/fact"` |
| **Query RAG Memory & Check Duplicate Guard** | `node cli.js query-memory "Your topic or hook"` |
| **Run Full Hands-Free Autopilot Cycle** | `npm run autopilot` *(or `node cli.js autopilot`)* |
