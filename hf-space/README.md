---
title: ABSA Studio
emoji: 🎯
colorFrom: indigo
colorTo: blue
sdk: gradio
app_file: app.py
pinned: false
license: apache-2.0
---

Aspect-Based Sentiment Analysis inference API powered by Qwen2.5-3B-Instruct. See `/docs` for the OpenAPI UI.

## Classification pipeline (`absa_pipeline.py`)

1. **Stage 1, every post:** one forward pass reads next-token logits for the three label words,
   then a temperature/bias calibration fitted on labelled data.
2. **Stage 2, gated posts only:** chain-of-thought runs when the stage-1 margin is small, or when
   a polar label meets informal cues (profanity, slang, sarcasm markers, contrast). Its verdict is
   read from logits after a forced `Verdict:` and mixed with stage 1. Confident neutrals are
   never sent to CoT.
3. **Stage 3:** a one-sentence rationale conditioned on the final label (or the CoT reasoning when
   it agrees), so explanations never change the classification.

Thresholds and calibration live in `pipeline_config.json`. Fit them with `benchmark.py`.

## Files to upload to the Space

`README.md`, `requirements.txt`, `app.py`, `absa_pipeline.py`, `pipeline_config.json`.
`benchmark.py` is for offline evaluation and does not need to be uploaded.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /classify-batch` | `{texts, target}` → label, `prob_pos/neg/neu`, confidence, rationale, `route`, `cues` |
| `POST /extract-target` | Entity extraction from a search query |
| `POST /synthesize-insights` | Streaming executive brief |
| `POST /eval/raw-scores` | Benchmark support: raw scores for every prompt variant + CoT (max 16 posts) |
| `GET /health` | Model id and pipeline version |

All `POST` routes require the `X-API-Key` header when `API_SECRET` is set.
