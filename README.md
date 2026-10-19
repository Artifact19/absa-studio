# Target-Oriented ABSA Studio 🎯

> **Aspect-Based Sentiment Analysis on Demand:** Disentangle collateral emotion from true public attitude using **Qwen2.5-3B-Instruct**, exponential recency weighting, and verifiable ground-truth evidence.

[![Next.js](https://img.shields.io/badge/Next.js-16_App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-ZeroGPU-FFD21E?style=flat-square&logo=huggingface)](https://huggingface.co/)
[![Model](https://img.shields.io/badge/Model-Qwen2.5--3B--Instruct-indigo?style=flat-square)](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct)
[![License](https://img.shields.io/badge/License-Apache_2.0-green?style=flat-square)](LICENSE)

---

## 💡 The Core Problem ABSA Solves

Standard sentiment analysis models judge entire sentences as a single blob. For example:

> *"The **iPhone 17** battery life is genuinely incredible, but FedEx delayed delivery by four days and customer service was completely useless."*

A naive sentiment analyzer classifies this tweet as **negative** due to the words *"delayed"* and *"useless"*. 

**ABSA Studio isolates sentiment strictly toward the target entity:**
- **Collateral noise:** Frustration with courier/shipping (ignored).
- **Target sentiment:** Unambiguously **positive** toward the iPhone 17's battery life.

---

## 🏛️ System Architecture

```
┌──────────────────────────────────────┐        ┌───────────────────────────────┐
│     Browser (Public & Admin UI)      │        │  Supabase PostgreSQL (Free)   │
└──────────────────┬───────────────────┘        │  table: absa_tweets           │
                   │ HTTPS                      └───────────────▲───────────────┘
┌──────────────────▼───────────────────┐   supabase-js (service_role, server only)
│  Next.js 16 App Router (Vercel)      │────────────────────────┘
│  • Perplexity-Style Dynamic Search   │
│  • Temporal Window & Recency Engine  │   REST + X-API-Key Secret
│  • Edge Admin Middleware Gate        │────────────────────────┐
└──────────────────────────────────────┘                        │
                                        ┌───────────────────────▼───────┐
                                        │ Hugging Face Space (ZeroGPU)  │
                                        │ Qwen2.5-3B-Instruct           │
                                        │ • POST /extract-target        │
                                        │ • POST /classify-batch        │
                                        │ • POST /synthesize-insights   │
                                        └───────────────────────────────┘
```

---

## ✨ Key Features

### 1. ⚡ Snackable Executive Insights (Streaming)
Synthesizes verified community reactions into a high-impact, 4-card executive brief streamed token-by-token:
- **⚡ 10-Second Verdict:** Exactly one 15-word punchline summarizing public stance.
- **🟢 The Exciting:** 2 structured theme bullets highlighting standout features.
- **🔴 The Frustrating:** 2 structured theme bullets detailing primary pain points.
- **🎯 The Bottom Line:** One single actionable takeaway.

### 2. ⏳ Dynamic Temporal Windows
Intelligently slices historical data into observation periods based on available data depth:
- **Today:** Most recent 24 hours.
- **Past 7 Days:** Available when data depth $\ge$ 2 days.
- **Past 30 Days:** Available when data depth $\ge$ 8 days.
- **Past 1 Year:** Available when data depth $\ge$ 31 days.
- **All Time:** Explicit format containing exact start date, end date, and total day span (e.g., `All Time: Oct 14, 2025 – Oct 19, 2026 (370 days)`).

### 3. 📉 Exponential Recency Weighting
Stale opinions shouldn't drown out fresh product updates. Tweets decay with a **14-day half-life**:

$$w_i = e^{-\lambda \Delta t_i}, \qquad \lambda = \frac{\ln 2}{14} \approx 0.0495105\ \text{day}^{-1}$$

where $\Delta t_i$ is the age of tweet $i$ in days. Weighted class share is computed as:

$$S_c = \frac{\sum_i w_i\,\mathbb{1}[y_i = c]}{\sum_i w_i}, \qquad \text{Weighted Verdict} = \operatorname*{argmax}_c S_c$$

Both raw counts and recency-weighted shares are displayed side-by-side.

### 4. 🚀 Sentiment Velocity Momentum
Detects whether sentiment is improving or worsening over time by comparing the 7-day recent window to the all-time baseline:

$$\Delta = P_{\text{recent (7D)}} - P_{\text{baseline (All-Time)}}\quad (\text{percentage points})$$

- 🚀 **Bullish Momentum:** $\Delta > +3\%$ (Emerald badge)
- 🔻 **Declining Sentiment:** $\Delta < -3\%$ (Rose badge)
- ⚖️ **Stable Consensus:** $-3\% \le \Delta \le +3\%$ (Slate badge)
- *Hidden automatically if sample size $< 10$ or date depth $< 14$ days.*

### 5. 🛡️ Verified Public Evidence
Displays the **Top 5 Positive** and **Top 5 Negative** ground-truth tweets sorted by model confidence.
- Clean React text nodes (HTML injection and `<script>` immune).
- Handles sanitized to `/^[A-Za-z0-9_]{1,30}$/`.
- Accessible confidence meters (`role="meter"`) with relative and absolute tooltips.

### 6. 🔒 Enterprise-Grade Admin Console (`/admin`)
- **Passkey Gate:** Constant-time verification (`crypto.timingSafeEqual`) and signed HMAC session cookies (8-hour expiry). Rate-limited to 5 attempts / 15 minutes.
- **Supabase Storage Meter:** Live storage monitoring (`X MB / 500 MB`) via `admin_table_size()` RPC.
- **Interactive Tweet Inspector:** Server-side sorting, pagination, topic/sentiment filters, and raw vs. cleaned text toggle.
- **Live Scraper Pipeline:** Streams NDJSON progress (`fetching` $\to$ `cleaning` $\to$ `classifying` $\to$ `upserting`) with real-time progress bars.
- **Topic Pruning:** Type-to-confirm dataset deletion and retention purger (older than $N$ days).

---

## 📂 Repository Layout

```
absa-studio/
├── web/                                  # Next.js App Router frontend & API
│   ├── app/                              # Pages & API route handlers
│   ├── components/                       # UI components (Search, Badges, Cards, Admin)
│   ├── lib/                              # Analytics math, Supabase server, HF client, Auth
│   ├── middleware.ts                     # Edge security proxy protecting /admin
│   └── scripts/test-analytics.ts         # Automated unit test suite
├── hf-space/                             # Hugging Face ZeroGPU inference server
│   ├── README.md                         # Gradio Space YAML metadata
│   ├── app.py                            # FastAPI mounted in Gradio + Qwen2.5-3B
│   └── requirements.txt                  # PyTorch, Transformers, FastAPI
└── supabase/
    └── migrations/
        └── 0001_absa_tweets.sql          # Postgres tables, views, RLS, & size RPC
```

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Node.js** v20+ & **npm**
- A **Supabase** project (Free tier)
- A **Hugging Face** Space (ZeroGPU or CPU basic)

### 2. Install Dependencies
```bash
cd web
npm install
```

### 3. Configure Environment Variables
Create a file at `web/.env.local`:
```ini
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_secret

# Hugging Face Inference
HF_SPACE_URL=https://your-user-absa-studio.hf.space
HF_API_SECRET=your_hf_shared_secret

# Admin Portal
ADMIN_PASSKEY=your_strong_admin_passkey
ADMIN_COOKIE_SECRET=your_32_byte_cookie_secret

# FetchLayer (Optional server default; users can also provide in UI)
FETCHLAYER_API_KEY=
FETCHLAYER_BASE_URL=https://api.fetchlayer.dev
```

### 4. Run Unit Tests
Verify mathematical formulas, recency decay half-lives, velocity thresholds, and dedup hashing:
```bash
npx tsx scripts/test-analytics.ts
```

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

---

## 🚀 Cloud Deployment

### 1. Supabase Database Migration
1. Go to your **Supabase Dashboard** → **SQL Editor**.
2. Run the script in [`supabase/migrations/0001_absa_tweets.sql`](supabase/migrations/0001_absa_tweets.sql).

### 2. Hugging Face Space (ZeroGPU)
1. Create a Space at [huggingface.co/new-space](https://huggingface.co/new-space) (SDK: **Gradio**, Hardware: **ZeroGPU**).
2. Upload the 3 files from [`hf-space/`](hf-space/):
   - `README.md`
   - `requirements.txt`
   - `app.py`
3. In Space **Settings** → **Variables and secrets**, add `API_SECRET`.

### 3. Vercel Deployment
1. Import `Artifact19/absa-studio` into [Vercel](https://vercel.com/new).
2. Set **Root Directory** to `web`.
3. Add the environment variables from your `web/.env.local`.
4. Deploy!

---

## 🔐 Security & Privacy Principles

- **Zero Key Leakage:** Client browsers never receive the Supabase `service_role` key, the Hugging Face shared secret, or the admin passkey.
- **Strict Row-Level Security:** Direct table reads for anonymous visitors are revoked at the PostgreSQL engine level; all reads/writes go through sanitized server routes.
- **CSRF Defense:** All mutating admin routes verify the `Origin` header against the host domain.
- **XSS Immunity:** Raw tweet text is rendered strictly as plain text nodes, and author handles are validated before rendering.

---

## 📜 License

Licensed under the [Apache-2.0 License](LICENSE).