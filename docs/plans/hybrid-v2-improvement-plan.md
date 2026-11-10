# ABSA Studio — Hybrid Classifier v2: evaluation review and implementation plan

> Written for an implementing agent (Antigravity). Repo: `C:\Skills\Projects\ABSA Studio`.
> Execute the steps in order. Each step has acceptance criteria. Do not deploy anything or
> commit without the user's go-ahead. Steps 1–7 are the classifier work; Steps 8–10 are
> independent follow-ups and can be handed off separately.
>
> Delivery: on approval, Claude copies this document into the repo as
> `docs/plans/hybrid-v2-improvement-plan.md` (uncommitted) and changes nothing else.

## Context

The hybrid pipeline (`hf-space/absa_pipeline.py`, commit `3c8e864`) was benchmarked on the 104
labelled GTA 6 tweets. The source file is `media_1794242748026_924f74c9.csv`: 124 rows, 104 with
`ground_truth`, single aspect "GTA 6". The run used **local 4-bit** scores
(`benchmark_results/raw_local-Qwen2.5-3B-Instruct-4bit_hybrid-v1.jsonl`).

### What the run actually shows (`benchmark_results/results.json`, same 4-bit scores for every row)

| System | Acc | κ_w | Δκ_w vs A [95% CI] |
|---|---:|---:|---|
| A: v1 verbalizer (replayed in 4-bit) | 65.4% | 0.452 | — |
| Legacy CoT, 45 tokens, old parser | 59.6% | 0.416 | [-0.21, +0.14] |
| Legacy CoT, 96 tokens, strict parser | 60.6% | 0.428 | [-0.18, +0.13] |
| New CoT alone (logit verdict) | 65.4% | 0.477 | [-0.11, +0.15] |
| Stage 1 `v2_zero` (no anchors) | 65.4% | 0.463 | [-0.10, +0.12] |
| Stage 1 `v2` (with anchors) | 56.7% | 0.358 | [-0.27, +0.07] |
| **Stage 1 `v2_zero` + calibration (CV)** | **68.3%** | **0.520** | [-0.06, +0.19] |
| Stage 1 `v2` + calibration (CV) | 60.6% | 0.310 | [-0.31, +0.03] |
| Hybrid, shipped defaults (`pipeline_config.json`) | 59.6% | 0.406 | [-0.19, +0.10] |
| Hybrid, tuned (nested CV) | 66.3% | 0.488 | [-0.06, +0.13] |

Production reference (fp16, the stored `qwen2.5-3b-instruct_sentiment` column): A = 70.2%, κ_w 0.569.

### Findings that drive this plan
1. **4-bit runs cannot decide production questions.** The same v1 prompt on the same text scores 70.2% in
   fp16 production but 65.4% in 4-bit. The confusion matrices also differ: 10 of 41 positives become negative
   in 4-bit vs 5 in fp16. Every comparison must be rerun in fp16.
2. **Nothing beats A clearly.** The best out-of-fold system is calibrated `v2_zero` (+0.07 κ_w), but its
   confidence interval crosses zero. Per-fold tuner picks swing between `v1` and `v2_zero`, with margins from
   0 to 0.5 and CoT weights from 0.35 to 0.85: noise dominates at n=104.
3. **The few-shot anchors hurt** (`v2` 0.358 vs `v2_zero` 0.463).
4. **The committed defaults would regress production** (59.6% vs A's 65.4% in the same run). They must not
   be deployed as is.
5. **Gated CoT adds nothing on top of calibrated stage 1** (0.488 vs 0.520). The bigger token budget and
   strict parser barely help the legacy CoT (59.6% → 60.6%). Over-reasoning, not parsing, is the cause.
6. **The main remaining error is gold-positive predicted as negative** (fan profanity). Calibration
   consistently learns `bias.negative ≈ -1.1`. CoT verdict logits are extremely overconfident (fitted
   `cot_scale ≈ 0.1`).
7. The labels cover one topic, so any tuned setting is GTA-6-specific until other topics are labelled.

Corrections to the earlier Antigravity report: its table mixes fp16 numbers (70.19 / 53.85 / 51.92) with
4-bit numbers. Its "Deployable 70.19%, κ_w 0.531" row is in-sample. Neither supports "metric recovery".

### Intended outcome
- Production immediately gets A's labels plus real probabilities and rationales, with no regression.
- Every candidate improvement can be measured in **one fp16 benchmark run** through the Space.
- A labelling loop grows the evaluation set beyond 104.
- Dashboard shares can use probabilities once calibration is trustworthy.

---

## Step 1 — Housekeeping
- Keep Antigravity's change in `hf-space/benchmark.py` `load_rows()` that skips blank labels. Also print
  `Skipped N rows with no label`.
- Add `scratch/` and `data/` to `.gitignore`. The untracked `scratch/smoke_test*` folders contain tweet text.
- Copy the annotated CSV to `data/gta6_annotated.csv` (gitignored) and use that path below.

**Accept:** `git status` shows no `scratch/` entries; the benchmark prints the skipped count (20).

## Step 2 — Safe production defaults (A-equivalent)
Make the shipped config reproduce Approach A exactly, while keeping real probabilities, rationales and the
new endpoints.
- `hf-space/absa_pipeline.py` `PipelineConfig` defaults: `stage1_variant="v1"`, `scale=1.0`, all biases
  `0`, `gate_margin=0.0`, `gate_cues=[]`, `cot_weight=0.0` (`needs_cot()` already returns False when
  `cot_weight <= 0`). Keep `generate_rationales=True`.
- Rewrite `hf-space/pipeline_config.json` to the same values, with `_comment` saying "A-equivalent safe baseline".

**Accept:** replaying the shipped config over the existing cache gives labels identical to the "A" row (see
Step 5 test).

## Step 3 — Candidate improvements in the pipeline (all off by default)
File: `hf-space/absa_pipeline.py`. Bump `PIPELINE_VERSION = "hybrid-v2"`, since the raw-score format changes.

3.1 **Generic verbalizer.** Generalize `AbsaEngine._label_token_ids` / `_label_scores` into
`_word_ids(words)` and `_verbalizer_scores(prompts, words)`. Keep the same 3 surface forms per word and the
overlap check. The existing label scoring becomes `_verbalizer_scores(prompts, LABELS)`.

3.2 **Two-step variant `"two_step"`** (an opinion question, then a polarity question):
- `OPINION_SYS`: "You read a social media post (X or Reddit) and decide whether its author expresses
  their own opinion of one TARGET. Answer yes if the author praises, criticizes, mocks, defends, or shows
  excitement or disappointment about the TARGET, including through sarcasm or slang. Answer no if the post
  only shares news, facts, announcements, dates, countdowns, rumors, or questions about the TARGET, or
  mentions it only in passing. Answer with one word: yes or no."
  User: `Target: {t}\nPost: {p}\nDoes the author express an opinion of the TARGET?` → verbalizer `("yes","no")`.
- `POLARITY_SYS`: "The author of this social media post expresses an opinion of the TARGET. Decide whether
  that opinion is positive or negative. Only the author's opinion of the TARGET counts, not of other people,
  rivals, or things. Sarcastic praise is negative. Swearing and slang often express love or loyalty; judge
  what the author means, not the words. Answer with one word: positive or negative."
  User: `Target: {t}\nPost: {p}\nOpinion of the TARGET:` → verbalizer `("positive","negative")`.
- Combine into 3-class log-probs in `LABELS` order (pure function `two_step_scores(op, pol)`):
  `pos = lsm(op)[yes] + lsm(pol)[pos]`, `neg = lsm(op)[yes] + lsm(pol)[neg]`, `neu = lsm(op)[no]`.
  The existing scale/bias calibration then applies unchanged; `bias.neutral` acts as the opinion threshold.

3.3 **Null-input (contextual) calibration**, `null_calibration: bool = False`. For each variant, also score
the content-free posts `("N/A", "")` with the same target, then average their log-softmax. When enabled:
`scores = log_softmax(s) - null_log_softmax` before scale/bias. In production this adds 2 prompts per
variant per batch (batches share a target). Append them to the same forward batch.

3.4 **Prompt ensemble** `stage1_variant="ensemble"` with `ensemble_members: List[str] = ["v1","v2_zero"]`.
The score is the mean over members of the (null-calibrated, if enabled) log-softmax.

3.5 **Disagreement gate**, `gate_on_disagreement: bool = False`. For an ensemble, gate to CoT when the
members' argmax labels differ. Apply it after the existing neutral-guard and `cot_weight` checks in
`needs_cot()`.

3.6 **Self-consistency CoT**: `cot_samples: int = 1`, `cot_temperature: float = 0.7`, `cot_seed: int = 0`.
When `cot_samples > 1`, sample k chains per gated post (`do_sample=True`, `top_p=0.9`,
`num_return_sequences=k`, `torch.manual_seed(cot_seed)`). Score each chain's verdict with the existing
forced-`Verdict:` forward pass. The CoT distribution is the mean over chains of `calibrate_cot()`. The
rationale is the first chain whose verdict matches the final label.

3.7 **One shared decision path.** Production and benchmark must use the same pure functions. Add:
- `stage1_vector(stage1: Dict[str, List[float]], null: Optional[Dict], cfg) -> (scores, member_labels)`
- `decide(scores, cues, cfg, cot_score_list=None, member_labels=None)`, where `cot_score_list` is a list of
  per-chain raw verdict scores (a greedy run is a list of one).
`AbsaEngine.classify()` computes only the variants the config needs, then calls these functions.

3.8 **`raw_scores()` v2 format.** Each post returns:
`stage1 {v1, v2_zero, v2, two_step}`, `stage1_null {same keys}`, `two_step_parts {opinion, polarity}`,
`cues`, `cot` (greedy, unchanged), `cot_samples` (list or null), `legacy_cot`, `clipped`.
It takes a `self_consistency: int = 0` argument.

3.9 **Timing logs.** In `classify()`, log stage durations (ms) and the number of gated posts at INFO.

`hf-space/app.py`: add `self_consistency: int = Field(0, ge=0, le=8)` to `RawReq` and pass it through.
Leave `/classify-batch` request/response unchanged.

**Accept:** with default config, `classify()` output labels equal v1 argmax. All new flags run without
errors on `Qwen/Qwen2.5-0.5B-Instruct` (see Verification).

## Step 4 — Benchmark upgrades (`hf-space/benchmark.py`)
- **Candidates.** Replace `VARIANT_ORDER` with stage-1 candidates `v1`, `v2_zero`, `v2`, `two_step` and
  `ensemble(v1+v2_zero)`, each with `null_calibration` off/on. `build_bench()` builds `S1[candidate]` via
  `ap.stage1_vector` so the replay matches production. Skip candidates whose raw fields are missing; the
  old `hybrid-v1` caches must still analyze with `--cache`.
- **Smaller gate grid.** `gate_margin [0, 0.15, 0.3, 1.01]`, `gate_cues [none, all]`,
  `neutral_guard [0.5, 0.6, 1.01]`, `cot_weight [0.35, 0.5, 0.85]`, `cot_can_neutralize [False, True]`.
  Add `gate_on_disagreement [False, True]` for the ensemble only, and `cot_source [greedy, samples]` when
  samples exist.
- **Simplest-within-noise selection.** In `tune()`, keep every config within `--tie-tolerance`
  (default 0.01 κ_w) of the best inner-CV score. Pick the simplest, ordered by: fewest CoT calls, then
  fewest extra passes (single prompt < two_step/ensemble), then null calibration off. Extend
  `fast_replay()` with the `disagree` array and SC distributions, and keep `check_equivalence()` passing.
- **Rows.**
  - "A (stored production predictions)": from `--reference-col`, auto-detecting
    `qwen2.5-3b-instruct_sentiment`. Also print the agreement rate between stored and replayed A.
  - Calibrated-CV rows for `v1`, `v2_zero`, `two_step`, `ensemble`, plus `v1`/`v2_zero` with null calibration.
  - New CoT with self-consistency, when samples exist.
  - "Shipped config": loads `--config`, default `hf-space/pipeline_config.json`. This replaces
    `hybrid_default`.
- **Metrics.** Add quadratic-weighted κ to `metrics()` and the table.
- **Banner.** When `ident` contains `4bit`/`8bit`, print: "Quantized scores — not comparable with
  production fp16; use for plumbing checks only".
- **Remote.** `RemoteBackend` sends `self_consistency` from a new `--self-consistency K` flag (default 0).
- **Filter.** `--where col=value` restricts rows (used in Step 8 with `label_source=random`).

**Accept:** `--skip-run --cache benchmark_results/raw_local-Qwen2.5-3B-Instruct-4bit_hybrid-v1.jsonl`
reproduces today's A/B/B96/cot_v2 rows exactly, and prints the banner and the stored-A row.

## Step 5 — Tests (`hf-space/tests/test_pipeline.py`, pytest, no model needed)
Move the checks done by hand earlier into tests:
- κ / κ_w / κ_q and macro-F1 vs sklearn
- McNemar vs `scipy.stats.binomtest`
- `fit_calibration` recovers known parameters
- `fast_replay` ≡ `decide` on random configs, including disagreement and SC
- `two_step_scores` math (probabilities sum to 1)
- null-calibration math
- `legacy_parse` / `strict_parse` / `cut_reasoning` cases
- the A-equivalent shipped config never gates and returns v1 argmax

**Accept:** `python -m pytest hf-space/tests -q` passes.

## Step 6 — One fp16 benchmark run (user approves deploy)
1. Upload `app.py`, `absa_pipeline.py`, `pipeline_config.json` (the A-equivalent one), `requirements.txt`
   and `README.md` to the Space. Check that `GET /health` returns `"pipeline": "hybrid-v2"`.
2. Run (this uses ZeroGPU quota, about 13 calls, or more with self-consistency):
   `python hf-space/benchmark.py --data data/gta6_annotated.csv --backend remote --url https://<space>.hf.space --key <API_SECRET> --self-consistency 5 --out benchmark_results/fp16`
3. Sanity check: replayed A should agree with the stored production column on ≥95% of posts. Otherwise
   stop and investigate before trusting any row.

## Step 7 — Decide and deploy the config
- Deploy the tuned config (`--write-config hf-space/pipeline_config.json`) **only if** the hybrid's
  nested-CV κ_w beats fp16 A by ≥ 0.02 **and** neutral recall and negative precision are not below A's.
  Otherwise keep the A-equivalent config; more labels (Step 8) are then the path to improvement.
- After any config change, re-upload `pipeline_config.json` and reclassify existing rows from the admin panel
  (`web/app/api/admin/reclassify/route.ts`). Rows classified by the old CoT have placeholder probabilities
  (0.92/0.04/0.04 or 0.10/0.10/0.80), and rows from older code have none.

## Step 8 — Labelling loop (web + Supabase)
Before writing route code, read the Next.js docs in `web/node_modules/next/dist/docs/`, as instructed by
`web/AGENTS.md`. Reuse `isRequestAuthorized` (`web/lib/auth.ts`), `sb()` (`web/lib/supabase-server.ts`) and the
admin route patterns in `web/app/api/admin/tweets/route.ts`.
- **Migration** `supabase/migrations/0004_human_labels.sql`. Add to `absa_tweets`:
  - `human_label text check (human_label in ('positive','negative','neutral'))`
  - `label_source text check (label_source in ('random','uncertain','import'))`
  - `labeled_at timestamptz`
  - `model_route text`
  Then drop and recreate `absa_tweets_v`, following the `0003` pattern (`security_invoker`, same grants),
  exposing the new columns.
- **Persist `route`** from `/classify-batch` into `model_route` in `web/app/api/analyze/route.ts`,
  `web/app/api/admin/reclassify/route.ts` and `web/scripts/reclassify.ts`. Keep the existing
  legacy-schema fallback.
- **API** `web/app/api/admin/labels/route.ts`:
  - `GET ?mode=random|uncertain&topic=&limit=` returns unlabelled rows. Fetch up to 2000 ids with
    probabilities, then sample in JS: random, or lowest `max(p)` for uncertain.
  - `POST {id, label, source}` sets `human_label`, `label_source`, `labeled_at`.
  - `GET ?export=csv&topic=` returns columns `id, aspect, cleaned_text, human_label, label_source,
    qwen2.5-3b-instruct_sentiment`. `benchmark.py` already auto-detects these.
- **UI** `web/components/admin/LabelQueue.tsx`, added as a section in `web/app/admin/page.tsx`. Show one
  post at a time with its target. **Hide the model's label until the post is labelled**, to avoid anchoring.
  Keys `1/2/3` = negative/neutral/positive, `S` = skip. Add a progress count and a mode toggle that defaults
  to random. Sample across topics, not just GTA 6.
- **Import** the existing 104 labels with `web/scripts/import-labels.ts`: match on `id`, set
  `label_source='import'`, and reuse the env loading from `web/scripts/reclassify.ts`.
- **Benchmark** headline numbers use `--where label_source=random` (plus imports); uncertain-sampled
  labels are for error analysis.

**Accept:** label 5 posts in the UI, export, and run `benchmark.py --skip-run` on the export without errors.

## Step 9 — Dashboard shares from probabilities (behind a flag)
- `web/lib/analytics.ts`: add optional `p_pos/p_neg/p_neu` to `RawTweetItem`.
  `calculateWeightedSentiment(tweets, now, mode)` with `mode: "count" | "probability"`: in probability mode
  add `w * p_c` instead of `w * 1[label=c]`. Fall back to the label for rows with missing or placeholder
  probabilities. Keep `counts` as label counts. Apply the same mode to `calculateSentimentVelocity`.
- Callers: `web/app/api/analyze/route.ts:483` and `web/app/api/insights/route.ts:72`. Both rows already
  carry `p_pos/p_neg/p_neu`. Read the mode from env `SENTIMENT_SHARE_MODE`, default `count`. Switch it on
  only after Step 7 has deployed a fitted calibration and rows have been reclassified.
- Extend `web/scripts/test-analytics.ts` with probability-mode cases: equivalence with count mode for
  one-hot probabilities, the placeholder fallback, and recency weighting.
- Skip confusion-matrix correction for now: 15 negatives are too few to invert reliably.

**Accept:** `npx tsx scripts/test-analytics.ts` passes, and with the flag off the dashboard output is unchanged.

## Step 10 — Optional: shared-prefix KV cache
Only do this if Step 3.9 logs show `/classify-batch` above about 20 s per batch with the chosen config.
Compute the KV cache of the shared system/anchor prefix once per batch, expand it across rows, and run only
the per-post suffixes.

---

## Verification (end to end)
1. `python -m pytest hf-space/tests -q`
2. Engine smoke run on the 0.5B model, with all flags on:
   `HF_HUB_OFFLINE=1`, `ensemble` + `null_calibration` + `gate_on_disagreement` + `two_step` +
   `cot_samples=3` through `AbsaEngine.classify()` and `raw_scores(self_consistency=3)`. Probabilities sum
   to 1; batched and single-post stage-1 scores match within fp16 noise.
3. App integration: set `MODEL_ID=Qwen/Qwen2.5-0.5B-Instruct` before importing `hf-space/app.py`, then
   use FastAPI `TestClient`:
   - `/health` reports `hybrid-v2`
   - missing key → 401
   - `/classify-batch` response schema unchanged
   - `/eval/raw-scores` with `self_consistency=2`; more than 16 posts → 422
4. Benchmark: run `--skip-run` on the old 4-bit cache (Step 4 acceptance), then a `--limit 12` run through
   `RemoteBackend` with `urllib.request.urlopen` monkeypatched to the `TestClient` (same pattern as before).
5. Web: `npm run lint`, `npx tsc --noEmit`, `npx tsx scripts/test-analytics.ts`, `npm run build`; apply the
   migration in the Supabase SQL editor and check the view columns.
6. The 3B model in 4-bit (6 GB laptop GPU) is for plumbing only. Every decision uses the Step 6 fp16 run.

