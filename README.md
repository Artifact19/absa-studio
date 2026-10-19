# Target-Oriented ABSA Studio

> **Target-Oriented Aspect-Based Sentiment Analysis Platform:** Isolates authentic public sentiment toward specific entities, products, and brands using **Qwen2.5-3B-Instruct**, recency-weighted decay scoring, and verifiable ground-truth evidence.

[![Next.js](https://img.shields.io/badge/Next.js-16_App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Hugging Face](https://img.shields.io/badge/Hugging_Face-ZeroGPU-FFD21E?style=flat-square&logo=huggingface)](https://huggingface.co/)
[![Model](https://img.shields.io/badge/Model-Qwen2.5--3B--Instruct-indigo?style=flat-square)](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct)
[![License](https://img.shields.io/badge/License-Apache_2.0-green?style=flat-square)](LICENSE)

---

## Overview

Traditional sentiment analysis evaluates sentences as uniform blocks. When a statement expresses mixed emotions toward different entities, standard classifiers routinely misjudge the core target.

Consider the following post:

> "The iPhone 17 battery life is genuinely incredible, but courier shipping delayed delivery by four days and customer support was completely unhelpful."

A naive classifier flags this post as negative due to terms like "delayed" and "unhelpful". 

**Target-Oriented ABSA isolates sentiment strictly toward the subject:**
- **Collateral Emotion:** Frustration regarding delivery logistics is isolated and ignored.
- **Target Sentiment:** Unambiguously positive toward the battery performance of the iPhone 17.

---

## System Architecture

```
+--------------------------------------+        +-------------------------------+
|     Browser (Public & Admin UI)      |        |  Supabase PostgreSQL          |
+------------------+-------------------+        |  table: absa_tweets           |
                   | HTTPS                      +---------------+---------------+
+------------------v-------------------+   supabase-js (service_role, server)
|  Next.js 16 App Router (Vercel)      |----------------+
|  - Dynamic Query & Temporal Engine   |
|  - Recency Weighting Calculation     |   REST + X-API-Key Secret
|  - Edge Security & Auth Middleware   |----------------+
+--------------------------------------+                |
                                        +---------------v---------------+
                                        | Hugging Face Space (ZeroGPU)  |
                                        | Qwen2.5-3B-Instruct           |
                                        | - POST /extract-target        |
                                        | - POST /classify-batch        |
                                        | - POST /synthesize-insights   |
                                        +-------------------------------+
```

---

## Core Capabilities

### 1. Structured Executive Brief (Streaming)
Synthesizes verified community reactions into a high-impact, four-section executive summary streamed token-by-token:
- **Ten-Second Verdict:** A single fifteen-word sentence summarizing the prevailing public stance.
- **The Exciting:** Structured theme items identifying primary positive drivers.
- **The Frustrating:** Structured theme items highlighting primary user criticisms.
- **The Bottom Line:** A single actionable takeaway.

### 2. Dynamic Observation Windows
Segments historical datasets into observation periods based on total temporal coverage:
- **Today:** Most recent 24 hours.
- **Past 7 Days:** Activated when dataset span is at least 2 days.
- **Past 30 Days:** Activated when dataset span is at least 8 days.
- **Past 1 Year:** Activated when dataset span is at least 31 days.
- **All Time:** Explicit display containing start date, end date, and total day span (e.g., `All Time: Oct 14, 2025 – Oct 19, 2026 (370 days)`).

### 3. Exponential Recency Weighting
Older opinions should not obscure recent changes in perception. Posts undergo exponential decay with a **14-day half-life**:

$$w_i = e^{-\lambda \Delta t_i}, \qquad \lambda = \frac{\ln 2}{14} \approx 0.0495105\ \text{day}^{-1}$$

where $\Delta t_i$ represents the age of post $i$ in days. The weighted share for class $c \in \{\text{positive}, \text{negative}, \text{neutral}\}$ is calculated as:

$$S_c = \frac{\sum_i w_i \cdot \mathbb{I}[y_i = c]}{\sum_i w_i}$$

$$\text{Weighted Verdict} = \arg\max_c (S_c)$$

Raw counts and recency-weighted proportions are reported in parallel.

### 4. Sentiment Velocity Momentum
Tracks whether sentiment is improving or declining over time by comparing the recent 7-day window to the all-time baseline:

$$\Delta = P_{\text{recent (7D)}} - P_{\text{baseline (All-Time)}}\quad (\text{percentage points})$$

- **Bullish Momentum:** $\Delta > +3\%$
- **Declining Sentiment:** $\Delta < -3\%$
- **Stable Consensus:** $-3\% \le \Delta \le +3\%$
- *Suppressed automatically when recent sample size is less than 10 or dataset depth is less than 14 days.*

### 5. Ground-Truth Public Evidence
Presents the top 5 positive and top 5 negative reference posts ordered by model confidence score.
- Rendered as plain text nodes to prevent script execution.
- Handles sanitized against standard alphanumeric formats.
- Visual confidence meters with precise percentages and timestamp tooltips.

### 6. Management Portal
- **Passkey Gate:** Constant-time credential verification and signed HMAC session cookies (8-hour expiration).
- **Storage Monitoring:** Real-time database utilization tracking relative to service limits.
- **Record Inspector:** Sorting, server-side pagination, search filters, and raw/cleaned text toggle.
- **Ingestion Pipeline:** Streams NDJSON progress across scraping, cleaning, model classification, and deduplication stages.
- **Dataset Pruning:** Explicit confirmation for topic-level deletion and retention purges.

---

## Repository Structure

```
absa-studio/
├── web/                                  # Next.js App Router application
│   ├── app/                              # Pages and API route handlers
│   ├── components/                       # UI components and management views
│   ├── lib/                              # Analytics, database server, model client
│   ├── middleware.ts                     # Edge security proxy
│   └── scripts/test-analytics.ts         # Automated unit test suite
├── hf-space/                             # Hugging Face inference deployment
│   ├── README.md                         # Gradio Space configuration
│   ├── app.py                            # FastAPI server with Qwen2.5-3B
│   └── requirements.txt                  # Model runtime dependencies
└── supabase/
    └── migrations/
        └── 0001_absa_tweets.sql          # Database tables, views, and functions
```

---

## Local Development Setup

### 1. Requirements
- Node.js version 20 or higher
- Supabase project
- Hugging Face Space (ZeroGPU or CPU basic)

### 2. Dependency Installation
```bash
cd web
npm install
```

### 3. Environment Configuration
Create a `.env.local` file inside the `web` directory:
```ini
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_secret

# Hugging Face Inference
HF_SPACE_URL=https://your-space.hf.space
HF_API_SECRET=your_hf_shared_secret

# Access Control
ADMIN_PASSKEY=your_admin_passkey
ADMIN_COOKIE_SECRET=your_32_byte_cookie_secret

# Data Source (Optional default; can also be provided in UI)
FETCHLAYER_API_KEY=
FETCHLAYER_BASE_URL=https://api.fetchlayer.dev
```

### 4. Verification Suite
Execute the mathematical validation tests covering recency decay, velocity boundaries, and deduplication:
```bash
npx tsx scripts/test-analytics.ts
```

### 5. Development Server
```bash
npm run dev
```
Navigate to `http://localhost:3000` to access the interface.

---

## Cloud Deployment

### 1. Database Setup (Supabase)
1. Open the Supabase SQL Editor.
2. Execute the migration file located at `supabase/migrations/0001_absa_tweets.sql`.

### 2. Model Service Deployment (Hugging Face)
1. Create a new Space with Gradio SDK on ZeroGPU hardware.
2. Upload the files from `hf-space/`: `README.md`, `requirements.txt`, and `app.py`.
3. In Space Settings under Variables and Secrets, add `API_SECRET`.

### 3. Frontend Deployment (Vercel)
1. Import the repository into Vercel.
2. Set the Root Directory to `web`.
3. Configure the environment variables specified in `.env.local`.
4. Deploy the application.

---

## Security Architecture

- **Credential Isolation:** The client application never receives administrative secrets or database service keys.
- **Row-Level Security:** Unauthenticated direct access to raw data tables is revoked at the database layer.
- **CSRF Defense:** Modifying requests validate Origin headers against the host domain.
- **Input Neutralization:** User-generated content is sanitized and rendered without HTML interpretation.

---

## License

Distributed under the Apache-2.0 License.
