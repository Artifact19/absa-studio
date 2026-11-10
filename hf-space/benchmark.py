#!/usr/bin/env python
"""Benchmark the hybrid ABSA pipeline against human labels.

Step 1 (model, once): for every post compute the raw scores of all stage-1 prompt variants,
the new CoT (verdict read from logits), and the legacy 45-token CoT. Runs locally with
transformers or through the Space's /eval/raw-scores endpoint. Cached as JSONL, so reruns
and re-analysis cost nothing.

Step 2 (offline): replay every system from the cache. Calibration and gate thresholds are
fitted with stratified K-fold cross-validation, nested so the reported numbers for tuned
systems are out-of-fold. Reports accuracy, Cohen's kappa (unweighted, linear, and quadratic),
per-class recall, macro-F1, exact McNemar tests and paired-bootstrap intervals against Approach A.

Data: CSV/TSV/JSON/JSONL with a text column (cleaned_text|text|tweet|post), a target column
(target|aspect|entity, or pass --target) and a label column (label|gold|gt|ground_truth|
human_label) holding positive/negative/neutral.
"""

from __future__ import annotations

import argparse
import csv
import dataclasses
import hashlib
import itertools
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

import absa_pipeline as ap

ORDER = ("negative", "neutral", "positive")  # ordinal order used by weighted kappa
ORD = {label: i for i, label in enumerate(ORDER)}
LAB_IDX = {label: i for i, label in enumerate(ap.LABELS)}  # pipeline order: pos, neg, neu

TEXT_COLS = ("cleaned_text", "text", "tweet", "post", "content", "body")
TARGET_COLS = ("target", "aspect", "entity")
LABEL_COLS = ("label", "gold", "gt", "ground_truth", "human_label", "annotation", "true_label")
REF_COLS = ("qwen2.5-3b-instruct_sentiment", "reference", "ref", "stored_prediction")
LABEL_ALIASES = {
    "positive": "positive", "pos": "positive",
    "negative": "negative", "neg": "negative",
    "neutral": "neutral", "neu": "neutral",
}

SYSTEMS = {
    "ref": "A (stored production predictions)",
    "A": "A: v1 logit verbalizer (pre-CoT production)",
    "B": "B: legacy CoT, 45 tokens, old parser (current production)",
    "B96": "B': legacy CoT, 96 tokens, strict parser",
    "cot_v2": "New CoT prompt alone, verdict from logits",
    "cot_sc": "New CoT with self-consistency",
    "s1_v1_cal": "Stage 1: v1 + calibration (CV)",
    "s1_v1_null_cal": "Stage 1: v1 + null calibration (CV)",
    "s1_v2_zero_cal": "Stage 1: v2_zero + calibration (CV)",
    "s1_v2_zero_null_cal": "Stage 1: v2_zero + null calibration (CV)",
    "s1_v2_cal": "Stage 1: v2 + calibration (CV)",
    "s1_two_step_cal": "Stage 1: two_step + calibration (CV)",
    "s1_ensemble_cal": "Stage 1: ensemble(v1+v2_zero) + calibration (CV)",
    "shipped": "Shipped config (pipeline_config.json)",
    "hybrid_cv": "Hybrid, tuned (nested CV)",
}

# Grid for candidate tuning
GRID = {
    "gate_margin": [0.0, 0.15, 0.3, 1.01],
    "gate_cues": ["none", "all"],
    "neutral_guard": [0.5, 0.6, 1.01],
    "cot_weight": [0.35, 0.5, 0.85],
    "cot_can_neutralize": [False, True],
}
TO_ORD = np.array([ORD[label] for label in ap.LABELS])  # pipeline index -> ordinal index


# --------------------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------------------

def clean_post(text: str) -> str:
    """Python port of web/lib/clean.ts cleanTweetText, so the model sees production input."""
    t = re.sub(r"^RT\s+@[\w_]+:\s*", "", text, flags=re.IGNORECASE | re.ASCII)
    t = re.sub(r"https?://\S+", "", t, flags=re.IGNORECASE)
    t = re.sub(r"(@[\w_]+[\s,]*)+", "@user ", t, flags=re.ASCII)
    return re.sub(r"\s+", " ", t).strip()


def _read_records(path: str) -> List[dict]:
    ext = os.path.splitext(path)[1].lower()
    with open(path, encoding="utf-8-sig", newline="") as fh:
        if ext in (".jsonl", ".ndjson"):
            return [json.loads(line) for line in fh if line.strip()]
        if ext == ".json":
            data = json.load(fh)
            return data["rows"] if isinstance(data, dict) and "rows" in data else data
        return list(csv.DictReader(fh, delimiter="\t" if ext == ".tsv" else ","))


def _pick(columns: Sequence[str], explicit: Optional[str], candidates: Sequence[str], what: str) -> Optional[str]:
    lower = {c.lower().strip(): c for c in columns}
    if explicit:
        if explicit.lower() not in lower:
            sys.exit(f"--{what}-col {explicit!r} not found; columns are {sorted(columns)}")
        return lower[explicit.lower()]
    return next((lower[c] for c in candidates if c in lower), None)


def load_rows(args) -> List[dict]:
    records = _read_records(args.data)
    if not records:
        sys.exit(f"{args.data}: no rows")
    cols = list(records[0].keys())

    # Optional filter: --where col=val
    if getattr(args, "where", None):
        if "=" not in args.where:
            sys.exit(f"--where must be in format col=val, got: {args.where!r}")
        w_col, w_val = args.where.split("=", 1)
        w_col_match = _pick(cols, w_col, [w_col], "where")
        if not w_col_match:
            sys.exit(f"--where column {w_col!r} not found in columns: {sorted(cols)}")
        records = [r for r in records if str(r.get(w_col_match, "")).strip().lower() == w_val.strip().lower()]
        print(f"Filtered by {w_col_match}={w_val}: {len(records)} rows remaining")

    tcol = _pick(cols, args.text_col, TEXT_COLS, "text")
    gcol = _pick(cols, args.target_col, TARGET_COLS, "target")
    lcol = _pick(cols, args.label_col, LABEL_COLS, "label")
    rcol = _pick(cols, getattr(args, "reference_col", None), REF_COLS, "reference")
    if not tcol or not lcol:
        sys.exit(f"Could not find text/label columns in {sorted(cols)}; use --text-col/--label-col")

    rows, bad = [], Counter()
    skipped_no_label = 0
    for i, rec in enumerate(records):
        raw_val = str(rec.get(lcol, "") or "").strip()
        if not raw_val or raw_val.lower() in ("nan", "none", "null", ""):
            skipped_no_label += 1
            continue
        gold = LABEL_ALIASES.get(raw_val.lower())
        if gold is None:
            bad[str(rec.get(lcol))] += 1
            continue
        target = str((rec.get(gcol) if gcol else None) or args.target or "").strip()
        if not target:
            sys.exit(f"Row {i} has no target; add a target column or pass --target")
        text = str(rec.get(tcol) or "")
        ref = None
        if rcol and rec.get(rcol):
            ref = LABEL_ALIASES.get(str(rec.get(rcol)).strip().lower())
        rows.append({
            "row": i,
            "id": rec.get("id", i),
            "target": target,
            "text": text if args.no_clean else clean_post(text),
            "gold": gold,
            "ref": ref,
        })
    if skipped_no_label:
        print(f"Skipped {skipped_no_label} rows with no label")
    if bad:
        sys.exit(f"Unrecognised labels {dict(bad)}; expected positive/negative/neutral")
    if args.limit:
        rows = rows[: args.limit]
    return rows


# --------------------------------------------------------------------------------------
# Backends + cache
# --------------------------------------------------------------------------------------

class LocalBackend:
    def __init__(self, model_id: str, quant: str, self_consistency: int = 0):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        cuda = torch.cuda.is_available()
        kwargs = {}
        if quant in ("4bit", "8bit"):
            from transformers import BitsAndBytesConfig

            if not cuda:
                sys.exit("--quant needs a CUDA GPU")
            kwargs["quantization_config"] = (
                BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.float16)
                if quant == "4bit" else BitsAndBytesConfig(load_in_8bit=True)
            )
            kwargs["device_map"] = "auto"
        else:  # fp16 like production; spills to CPU if the GPU is too small
            kwargs["dtype"] = torch.float16 if cuda else torch.float32
            kwargs["device_map"] = "auto" if cuda else None
        print(f"Loading {model_id} ({quant}) ...", flush=True)
        tok = AutoTokenizer.from_pretrained(model_id, padding_side="left")
        model = AutoModelForCausalLM.from_pretrained(model_id, **kwargs).eval()
        self.engine = ap.AbsaEngine(model, tok)
        self.cfg = ap.PipelineConfig()
        self.ident = f"local-{model_id.split('/')[-1]}-{quant}"
        self.self_consistency = self_consistency

    def __call__(self, texts: List[str], target: str) -> List[dict]:
        return self.engine.raw_scores(texts, target, self.cfg, self_consistency=self.self_consistency)


class RemoteBackend:
    def __init__(self, url: str, key: str, timeout: int = 600, self_consistency: int = 0):
        self.url = url.rstrip("/") + "/eval/raw-scores"
        self.key = key
        self.timeout = timeout
        self.self_consistency = self_consistency
        host = re.sub(r"^https?://", "", url).split("/")[0]
        self.ident = "remote-" + re.sub(r"[^A-Za-z0-9.-]", "_", host)
        self._warned = False

    def __call__(self, texts: List[str], target: str) -> List[dict]:
        body = json.dumps({
            "texts": texts,
            "target": target,
            "self_consistency": self.self_consistency,
        }).encode()
        delay = 5.0
        for attempt in range(5):
            req = urllib.request.Request(self.url, data=body, method="POST", headers={
                "Content-Type": "application/json", "X-API-Key": self.key,
            })
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read().decode())
                break
            except urllib.error.HTTPError as e:
                if e.code not in (429, 502, 503, 504) or attempt == 4:
                    sys.exit(f"{self.url}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 4:
                    sys.exit(f"{self.url}: {e}")
            print(f"  retrying in {delay:.0f}s ...", flush=True)
            time.sleep(delay)
            delay *= 2.5
        if data.get("pipeline_version") != ap.PIPELINE_VERSION and not self._warned:
            print(f"WARNING: Space runs pipeline {data.get('pipeline_version')!r}, local replay code is "
                  f"{ap.PIPELINE_VERSION!r}. Deploy the same absa_pipeline.py before trusting results.")
            self._warned = True
        return data["results"]


def row_key(row: dict) -> str:
    return hashlib.sha1(f"{row['target']}\x00{row['text']}".encode()).hexdigest()[:20]


def ensure_raw(rows: List[dict], backend, cache_path: str, batch_size: int) -> Dict[str, dict]:
    cache: Dict[str, dict] = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    rec = json.loads(line)
                    cache[rec["key"]] = rec["raw"]
    todo: Dict[str, List[dict]] = {}
    seen = set()
    for r in rows:
        k = row_key(r)
        if k not in cache and k not in seen:
            seen.add(k)
            todo.setdefault(r["target"], []).append(r)
    total = sum(len(v) for v in todo.values())
    if total == 0:
        return cache
    if backend is None:
        sys.exit(f"{total} posts are missing from {cache_path}; rerun without --skip-run")
    print(f"Scoring {total} posts ({len(cache)} cached) -> {cache_path}", flush=True)
    done, t0 = 0, time.time()
    with open(cache_path, "a", encoding="utf-8") as fh:
        for target, group in todo.items():
            for i in range(0, len(group), batch_size):
                chunk = group[i : i + batch_size]
                raws = backend([r["text"] for r in chunk], target)
                for r, raw in zip(chunk, raws):
                    cache[row_key(r)] = raw
                    fh.write(json.dumps({"key": row_key(r), "raw": raw}, ensure_ascii=False) + "\n")
                fh.flush()
                done += len(chunk)
                print(f"  {done}/{total} posts, {time.time() - t0:.0f}s", flush=True)
    return cache


# --------------------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------------------

def _idx(labels: Sequence[str]) -> np.ndarray:
    return np.array([ORD[x] for x in labels], dtype=int)


def confusion(g: np.ndarray, p: np.ndarray) -> np.ndarray:
    return np.bincount(g * 3 + p, minlength=9).reshape(3, 3)


def kappa_cm(cm: np.ndarray, weights: str = "none") -> float:
    n = cm.sum()
    i, j = np.indices(cm.shape)
    k = cm.shape[0] - 1
    if weights == "linear":
        d = np.abs(i - j) / k
    elif weights == "quadratic":
        d = ((i - j) / k) ** 2
    else:
        d = (i != j).astype(float)
    expected = np.outer(cm.sum(1), cm.sum(0)) / n
    denom = (d * expected).sum()
    return float(1 - (d * cm).sum() / denom) if denom > 0 else float("nan")


def metrics(gold: Sequence[str], pred: Sequence[str]) -> dict:
    cm = confusion(_idx(gold), _idx(pred))
    recall, precision, f1 = {}, {}, []
    for k, lab in enumerate(ORDER):
        tp, support, predicted = cm[k, k], cm[k].sum(), cm[:, k].sum()
        r = tp / support if support else float("nan")
        p = tp / predicted if predicted else 0.0
        recall[lab], precision[lab] = float(r), float(p)
        f1.append(2 * p * r / (p + r) if support and (p + r) > 0 else 0.0)
    return {
        "n": int(cm.sum()),
        "correct": int(np.trace(cm)),
        "accuracy": float(np.trace(cm) / cm.sum()),
        "kappa": kappa_cm(cm, "none"),
        "kappa_w": kappa_cm(cm, "linear"),
        "kappa_qw": kappa_cm(cm, "quadratic"),
        "macro_f1": float(np.mean(f1)),
        "recall": recall,
        "precision": precision,
        "confusion": cm.tolist(),
    }


def mcnemar_exact(gold, a, b) -> Tuple[float, int, int]:
    """Two-sided exact McNemar. Returns (p, a-right/b-wrong, a-wrong/b-right)."""
    ab = sum(1 for g, x, y in zip(gold, a, b) if x == g and y != g)
    ba = sum(1 for g, x, y in zip(gold, a, b) if x != g and y == g)
    n = ab + ba
    if n == 0:
        return 1.0, ab, ba
    tail = sum(math.comb(n, i) for i in range(min(ab, ba) + 1)) / 2 ** n
    return min(1.0, 2 * tail), ab, ba


def bootstrap(gold, preds: Dict[str, List[str]], baseline: str, n_boot: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    g = _idx(gold)
    P = {k: _idx(v) for k, v in preds.items()}
    kw = {k: np.empty(n_boot) for k in preds}
    for b in range(n_boot):
        s = rng.integers(0, len(g), len(g))
        for k in preds:
            kw[k][b] = kappa_cm(confusion(g[s], P[k][s]), "linear")
    out = {}
    for k in preds:
        delta = kw[k] - kw[baseline]
        out[k] = {
            "kappa_w_ci": [float(np.nanpercentile(kw[k], 2.5)), float(np.nanpercentile(kw[k], 97.5))],
            "delta_ci": [float(np.nanpercentile(delta, 2.5)), float(np.nanpercentile(delta, 97.5))],
        }
    return out


SELECT = {
    "kappa_w": lambda m: m["kappa_w"],
    "accuracy": lambda m: m["accuracy"],
    "macro_f1": lambda m: m["macro_f1"],
}


# --------------------------------------------------------------------------------------
# Calibration fit: z_k = a * s_k + b_k (b_pos = 0), multinomial NLL + L2 toward identity
# --------------------------------------------------------------------------------------

def fit_calibration(S: np.ndarray, y: np.ndarray, l2: float = 1.0, iters: int = 100) -> Tuple[float, Dict[str, float]]:
    S = S - S.mean(axis=1, keepdims=True)
    Y = np.eye(3)[y]
    prior = np.array([1.0, 0.0, 0.0])
    J = np.zeros((len(S), 3, 3))
    J[:, :, 0] = S
    J[:, 1, 1] = 1.0
    J[:, 2, 2] = 1.0

    def probs(theta):
        Z = theta[0] * S + np.array([0.0, theta[1], theta[2]])
        Z -= Z.max(axis=1, keepdims=True)
        E = np.exp(Z)
        return E / E.sum(axis=1, keepdims=True)

    def nll(theta):
        P = probs(theta)
        return -np.log(P[np.arange(len(y)), y] + 1e-12).sum() + l2 * ((theta - prior) ** 2).sum()

    theta = prior.copy()
    for _ in range(iters):
        P = probs(theta)
        R = P - Y
        grad = np.einsum("nk,nkj->j", R, J) + 2 * l2 * (theta - prior)
        W = np.einsum("nk,kl->nkl", P, np.eye(3)) - np.einsum("nk,nl->nkl", P, P)
        H = np.einsum("nki,nkl,nlj->ij", J, W, J) + 2 * l2 * np.eye(3)
        step = np.linalg.solve(H, grad)
        f0, t = nll(theta), 1.0
        while t > 1e-6:
            cand = theta - t * step
            cand[0] = min(max(cand[0], 0.01), 10.0)
            if nll(cand) <= f0:
                break
            t /= 2
        if np.abs(cand - theta).max() < 1e-9:
            theta = cand
            break
        theta = cand
    return float(theta[0]), {"positive": 0.0, "negative": float(theta[1]), "neutral": float(theta[2])}


# --------------------------------------------------------------------------------------
# Bench and Replay
# --------------------------------------------------------------------------------------

CANDIDATES = [
    # (cand_name, variant, null_cal, members, extra_passes)
    ("v1", "v1", False, None, 0),
    ("v1_null", "v1", True, None, 0),
    ("v2_zero", "v2_zero", False, None, 0),
    ("v2_zero_null", "v2_zero", True, None, 0),
    ("v2", "v2", False, None, 0),
    ("two_step", "two_step", False, None, 1),
    ("ensemble", "ensemble", False, ["v1", "v2_zero"], 1),
]


@dataclasses.dataclass
class Bench:
    rows: List[dict]
    gold: List[str]
    y: np.ndarray            # pipeline label index (pos, neg, neu)
    S1: Dict[str, np.ndarray]
    S1_member_labels: Dict[str, Optional[List[List[str]]]]
    cot: np.ndarray
    cot_status: List[str]
    cot_samples: Optional[List[Optional[List[dict]]]]
    cues: List[List[str]]
    legacy45: List[Optional[str]]
    legacy_full: List[Optional[str]]
    clipped: int
    ref: Optional[List[str]] = None


def build_bench(rows: List[dict], cache: Dict[str, dict]) -> Bench:
    raws = [cache[row_key(r)] for r in rows]
    leg = [r.get("legacy_cot") or {} for r in raws]

    # Build supported S1 candidates
    S1: Dict[str, np.ndarray] = {}
    S1_member_labels: Dict[str, Optional[List[List[str]]]] = {}

    for cand_name, variant, null_cal, members, _ in CANDIDATES:
        # Check if cache supports this candidate
        if null_cal and any("stage1_null" not in r or not r["stage1_null"] for r in raws):
            continue
        if variant == "two_step" and any("two_step" not in r.get("stage1", {}) for r in raws):
            continue
        if variant == "ensemble":
            req_members = members or ["v1", "v2_zero"]
            if any(any(m not in r.get("stage1", {}) for m in req_members) for r in raws):
                continue
        elif variant not in ("ensemble", "two_step"):
            if any(variant not in r.get("stage1", {}) for r in raws):
                continue

        cfg = ap.PipelineConfig(
            stage1_variant=variant,
            null_calibration=null_cal,
            ensemble_members=members or ["v1", "v2_zero"],
        )
        scores_list = []
        labels_list = []
        for r in raws:
            null_d = r.get("stage1_null") if null_cal else None
            s, m_lab = ap.stage1_vector(r["stage1"], null_d, cfg)
            scores_list.append(s)
            labels_list.append(m_lab)
        S1[cand_name] = np.array(scores_list, dtype=float)
        S1_member_labels[cand_name] = labels_list if any(m is not None for m in labels_list) else None

    # Handle cot_samples if present
    cot_samples_list = [r.get("cot_samples") for r in raws]
    has_sc = any(cs is not None for cs in cot_samples_list)

    ref_list = [r.get("ref") for r in rows]

    return Bench(
        rows=rows,
        gold=[r["gold"] for r in rows],
        y=np.array([LAB_IDX[r["gold"]] for r in rows]),
        S1=S1,
        S1_member_labels=S1_member_labels,
        cot=np.array([r["cot"]["scores"] for r in raws], dtype=float),
        cot_status=[r["cot"]["status"] for r in raws],
        cot_samples=cot_samples_list if has_sc else None,
        cues=[r["cues"] for r in raws],
        legacy45=[l.get("text_legacy") for l in leg],
        legacy_full=[l.get("text_full") for l in leg],
        clipped=sum(1 for r in raws if r.get("clipped")),
        ref=ref_list if any(x is not None for x in ref_list) else None,
    )


def argmax_labels(S: np.ndarray) -> List[str]:
    return [ap.LABELS[int(i)] for i in S.argmax(axis=1)]


def replay(bench: Bench, idx: Sequence[int], cfg: ap.PipelineConfig, cand_key: Optional[str] = None) -> Tuple[List[str], List[str]]:
    """Reference replay through the production decision code (absa_pipeline.decide)."""
    key = cand_key or cfg.stage1_variant
    labels, routes = [], []
    m_labels_list = bench.S1_member_labels.get(key)
    for i in idx:
        m_lab = m_labels_list[i] if m_labels_list is not None else None
        d = ap.decide(bench.S1[key][i], bench.cues[i], cfg, bench.cot[i], member_labels=m_lab)
        labels.append(d["label"])
        routes.append(d["route"])
    return labels, routes


def _softmax_rows(Z: np.ndarray) -> np.ndarray:
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


def _bias_vec(bias: Dict[str, float]) -> np.ndarray:
    return np.array([bias[k] for k in ap.LABELS])


def fast_replay(
    P1: np.ndarray,
    PC: np.ndarray,
    has_cue: np.ndarray,
    disagree: np.ndarray,
    cfg: ap.PipelineConfig,
) -> Tuple[np.ndarray, np.ndarray]:
    """Vectorised twin of absa_pipeline.decide for the grid search: (label index, gated)."""
    l1, lc = P1.argmax(axis=1), PC.argmax(axis=1)
    top = np.sort(P1, axis=1)
    margin = top[:, -1] - top[:, -2]
    guarded = (l1 == ap.NEU) & (P1[:, ap.NEU] >= cfg.neutral_guard)
    gated = ~guarded & (cfg.cot_weight > 0) & (
        (margin < cfg.gate_margin)
        | ((l1 != ap.NEU) & has_cue)
        | (cfg.gate_on_disagreement & disagree)
    )
    blocked = (l1 != ap.NEU) & (lc == ap.NEU) & (not cfg.cot_can_neutralize)
    w = min(max(cfg.cot_weight, 0.0), 1.0)
    mixed = ((1 - w) * np.log(np.maximum(P1, 1e-9)) + w * np.log(np.maximum(PC, 1e-9))).argmax(axis=1)
    return np.where(gated & ~blocked, mixed, l1), gated


def _fast_score(gold_ord: np.ndarray, labels: np.ndarray, select: str) -> float:
    cm = confusion(gold_ord, TO_ORD[labels])
    if select == "kappa_w":
        return kappa_cm(cm, "linear")
    if select == "accuracy":
        return float(np.trace(cm) / cm.sum())
    f1 = []
    for k in range(3):
        tp, support, predicted = cm[k, k], cm[k].sum(), cm[:, k].sum()
        p = tp / predicted if predicted else 0.0
        r = tp / support if support else 0.0
        f1.append(2 * p * r / (p + r) if (p + r) > 0 else 0.0)
    return float(np.mean(f1))


def calibrated_config(bench: Bench, idx: np.ndarray, cand_key: str) -> ap.PipelineConfig:
    # Look up variant info
    cand_info = next((c for c in CANDIDATES if c[0] == cand_key), None)
    variant = cand_info[1] if cand_info else cand_key
    null_cal = cand_info[2] if cand_info else False
    members = cand_info[3] if cand_info else ["v1", "v2_zero"]

    cfg = ap.PipelineConfig(
        stage1_variant=variant,
        null_calibration=null_cal,
        ensemble_members=members or ["v1", "v2_zero"],
    )
    cfg.scale, cfg.bias = fit_calibration(bench.S1[cand_key][idx], bench.y[idx])
    cfg.cot_scale, cfg.cot_bias = fit_calibration(bench.cot[idx], bench.y[idx])
    return cfg


def _arrays(bench: Bench, idx: np.ndarray, cand_key: str, cfg: ap.PipelineConfig, cot_source: str = "greedy"):
    P1 = _softmax_rows(cfg.scale * bench.S1[cand_key][idx] + _bias_vec(cfg.bias))
    if cot_source == "samples" and bench.cot_samples is not None:
        # Average over chains
        pc_rows = []
        for i in idx:
            chains = bench.cot_samples[i]
            if chains:
                c_scores = np.array([c["scores"] for c in chains])
                p_chains = _softmax_rows(cfg.cot_scale * c_scores + _bias_vec(cfg.cot_bias))
                pc_rows.append(p_chains.mean(axis=0))
            else:
                pc_rows.append(_softmax_rows(cfg.cot_scale * bench.cot[i : i + 1] + _bias_vec(cfg.cot_bias))[0])
        PC = np.array(pc_rows)
    else:
        PC = _softmax_rows(cfg.cot_scale * bench.cot[idx] + _bias_vec(cfg.cot_bias))

    has_cue = np.array([any(c in cfg.gate_cues for c in bench.cues[i]) for i in idx], dtype=bool)

    m_labels = bench.S1_member_labels.get(cand_key)
    if m_labels is not None:
        disagree = np.array([len(set(m_labels[i])) > 1 for i in idx], dtype=bool)
    else:
        disagree = np.zeros(len(idx), dtype=bool)

    return P1, PC, has_cue, disagree


def tune(
    bench: Bench,
    idx: np.ndarray,
    select: str,
    k_inner: int,
    seed: int,
    tie_tolerance: float = 0.01,
) -> Tuple[str, ap.PipelineConfig]:
    """Pick stage-1 candidate + gate params using simplest-within-noise selection.

    Every config within tie_tolerance of the best inner-CV score is considered.
    Ties are broken by: fewest CoT calls, then fewest extra passes, then null_cal off.
    """
    idx = np.asarray(idx)
    gold_ord = _idx([bench.gold[i] for i in idx])
    y_sub = bench.y[idx]
    k = max(2, min(k_inner, min(Counter(y_sub.tolist()).values())))
    inner = stratified_folds(y_sub, k, seed)
    any_cue = np.array([bool(bench.cues[i]) for i in idx], dtype=bool)
    no_cue = np.zeros(len(idx), dtype=bool)

    # Candidates supported in this bench
    supported = [c for c in CANDIDATES if c[0] in bench.S1]

    grid_keys = list(GRID)
    pool = []

    for cand_name, variant, null_cal, members, extra_passes in supported:
        P1 = np.empty((len(idx), 3))
        PC_greedy = np.empty((len(idx), 3))
        for test_pos in inner:
            train_pos = np.setdiff1d(np.arange(len(idx)), test_pos)
            cal = calibrated_config(bench, idx[train_pos], cand_name)
            p1_t, pc_t, _, _ = _arrays(bench, idx[test_pos], cand_name, cal, "greedy")
            P1[test_pos] = p1_t
            PC_greedy[test_pos] = pc_t

        m_labels = bench.S1_member_labels.get(cand_name)
        disagree = (
            np.array([len(set(m_labels[i])) > 1 for i in idx], dtype=bool)
            if m_labels is not None
            else np.zeros(len(idx), dtype=bool)
        )

        disagree_options = [False, True] if variant == "ensemble" else [False]

        for values in itertools.product(*(GRID[k] for k in grid_keys)):
            params = dict(zip(grid_keys, values))
            use_cues = params["gate_cues"] == "all"
            params["gate_cues"] = list(ap.ALL_CUES) if use_cues else []

            for gate_dis in disagree_options:
                p_full = dict(params)
                p_full["gate_on_disagreement"] = gate_dis
                p_full["stage1_variant"] = variant
                p_full["null_calibration"] = null_cal
                p_full["ensemble_members"] = members or ["v1", "v2_zero"]

                cand_cfg = ap.PipelineConfig(**p_full)
                labels, gated = fast_replay(
                    P1, PC_greedy, any_cue if use_cues else no_cue, disagree, cand_cfg
                )
                score = round(_fast_score(gold_ord, labels, select), 9)
                gated_count = int(gated.sum())
                pool.append({
                    "score": score,
                    "gated_count": gated_count,
                    "extra_passes": extra_passes,
                    "null_cal": 1 if null_cal else 0,
                    "cand_name": cand_name,
                    "params": p_full,
                })

    if not pool:
        sys.exit("No candidate configurations could be evaluated.")

    # Simplest-within-noise selection
    best_score = max(r["score"] for r in pool)
    threshold = best_score - tie_tolerance
    viable = [r for r in pool if r["score"] >= threshold]

    # Sort key: fewest CoT calls, then fewest extra passes, then null calibration off, then higher score
    viable.sort(key=lambda r: (r["gated_count"], r["extra_passes"], r["null_cal"], -r["score"]))
    chosen = viable[0]

    cand_name = chosen["cand_name"]
    final_cfg = dataclasses.replace(calibrated_config(bench, idx, cand_name), **chosen["params"])
    return cand_name, final_cfg


def check_equivalence(bench: Bench, idx: np.ndarray, cand_key: str, cfg: ap.PipelineConfig) -> int:
    """Number of posts where vectorised grid replay disagrees with production decision."""
    ref, _ = replay(bench, idx, cfg, cand_key)
    P1, PC, has_cue, disagree = _arrays(bench, idx, cand_key, cfg)
    labels, _ = fast_replay(P1, PC, has_cue, disagree, cfg)
    return sum(1 for a, b in zip(ref, labels) if a != ap.LABELS[int(b)])


def stratified_folds(y: np.ndarray, k: int, seed: int) -> List[np.ndarray]:
    rng = np.random.default_rng(seed)
    fold_of = np.empty(len(y), dtype=int)
    offset = 0
    for c in np.unique(y):
        members = np.flatnonzero(y == c)
        rng.shuffle(members)
        fold_of[members] = (np.arange(len(members)) + offset) % k
        offset += len(members)
    return [np.flatnonzero(fold_of == f) for f in range(k)]


def gate_summary(cfg: ap.PipelineConfig) -> str:
    cues = "all cues" if cfg.gate_cues else "no cues"
    dis = ", dis_gate=y" if cfg.gate_on_disagreement else ""
    return (f"stage1={cfg.stage1_variant}, margin<{cfg.gate_margin:g}, {cues}{dis}, guard={cfg.neutral_guard:g}, "
            f"w={cfg.cot_weight:g}, neutralize={'y' if cfg.cot_can_neutralize else 'n'}, "
            f"scale={cfg.scale:.2f}, bias_neu={cfg.bias['neutral']:+.2f}, bias_neg={cfg.bias['negative']:+.2f}")


# --------------------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------------------

def pct(x: float) -> str:
    return "  n/a" if x != x else f"{100 * x:5.1f}"


def print_report(bench: Bench, preds, results, boot, mc, args, ident, fold_cfgs, routes_cv, s1_tuned, fitted_key, fitted, fitted_routes):
    n = len(bench.gold)
    counts = Counter(bench.gold)

    source_desc = ident + (" " + args.cache if getattr(args, "cache", None) else "")
    if "4bit" in source_desc or "8bit" in source_desc:
        print("\n*** Quantized scores — not comparable with production fp16; use for plumbing checks only ***\n")

    print(f"## ABSA benchmark: {n} posts (neg {counts['negative']}, neu {counts['neutral']}, pos {counts['positive']})")
    print(f"Scores: {ident}, pipeline {ap.PIPELINE_VERSION}; {args.folds}-fold CV, seed {args.seed}, "
          f"selection metric {args.select_metric}, tie tolerance {args.tie_tolerance}; "
          f"{bench.clipped} posts clipped to {ap.PipelineConfig().max_post_tokens} tokens")
    print()

    # If reference column present, print agreement with A
    if "ref" in preds:
        agree = sum(1 for a, b in zip(preds["ref"], preds["A"]) if a == b) / n * 100
        print(f"Agreement rate between stored production predictions and replayed A: {agree:.1f}%\n")

    print("| System | Acc % | κ | κ_w [95% CI] | κ_qw | Δκ_w vs A [95% CI] | Recall neg/neu/pos % | Macro-F1 | McNemar vs A |")
    print("|---|---:|---:|---|---:|---|---|---:|---|")
    for key, m in results.items():
        r = m["recall"]
        ci, dci = boot[key]["kappa_w_ci"], boot[key]["delta_ci"]
        if key == "A":
            mc_txt, delta = "—", "—"
        elif key in mc:
            p, ab, ba = mc[key]
            mc_txt = f"p={p:.3f} (+{ba}/−{ab})"
            delta = f"{m['kappa_w'] - results['A']['kappa_w']:+.3f} [{dci[0]:+.2f}, {dci[1]:+.2f}]"
        else:
            mc_txt, delta = "—", "—"
        sys_name = SYSTEMS.get(key, key)
        print(f"| {sys_name} | {pct(m['accuracy'])} | {m['kappa']:.3f} | {m['kappa_w']:.3f} [{ci[0]:.2f}, {ci[1]:.2f}] "
              f"| {m['kappa_qw']:.3f} | {delta} | {pct(r['negative'])}/{pct(r['neutral'])}/{pct(r['positive'])} | {m['macro_f1']:.3f} | {mc_txt} |")
    print()
    print("McNemar column: (+fixed/−broken) = posts A got wrong that the system gets right / A right, system wrong.")

    print("\n### Confusion matrices (rows = gold, cols = predicted: neg, neu, pos)")
    for key in ("A", "B", "s1_v2_zero_cal", "shipped", "hybrid_cv"):
        if key in results:
            cm = results[key]["confusion"]
            print(f"- {SYSTEMS.get(key, key)}: " + " | ".join(f"{ORDER[i][:3]} {cm[i]}" for i in range(3)))

    if any(t is not None for t in bench.legacy45):
        missing = [i for i, t in enumerate(bench.legacy45) if t is not None and "Verdict:" not in t]
        neu_to_polar = sum(1 for i in missing if bench.gold[i] == "neutral" and preds["B"][i] != "neutral")
        full_missing = sum(1 for t in bench.legacy_full if t is not None and ap.strict_parse(t) is None)
        print("\n### Legacy CoT diagnosis")
        print(f"- {len(missing)}/{n} outputs had no 'Verdict:' within 45 tokens; the old parser then keyword-searched "
              f"the reasoning. {neu_to_polar} of those were gold-neutral posts labelled polar.")
        print(f"- With 96 tokens, {full_missing}/{n} outputs still lack a parseable verdict (counted as neutral in B').")

    gated = [i for i, r in enumerate(routes_cv) if r == "cot"]
    print("\n### Gate (hybrid, nested CV)")
    fixed = sum(1 for i in gated if s1_tuned[i] != bench.gold[i] and preds["hybrid_cv"][i] == bench.gold[i])
    broke = sum(1 for i in gated if s1_tuned[i] == bench.gold[i] and preds["hybrid_cv"][i] != bench.gold[i])
    print(f"- {len(gated)}/{n} posts ({100 * len(gated) / n:.0f}%) routed to CoT; on those, CoT fixed {fixed} "
          f"and broke {broke} stage-1 labels.")
    print("- Per-fold selections:")
    for f, (c_name, cfg) in enumerate(fold_cfgs):
        print(f"  - fold {f + 1} ({c_name}): {gate_summary(cfg)}")

    fm = metrics(bench.gold, replay(bench, range(n), fitted, fitted_key)[0])
    print(f"\n### Fitted on all {n} posts ({fitted_key})")
    print(f"- {gate_summary(fitted)}, cot_scale={fitted.cot_scale:.2f}")
    print(f"- In-sample (optimistic): acc {pct(fm['accuracy'])}%, κ_w {fm['kappa_w']:.3f}, "
          f"{fitted_routes.count('cot')}/{n} posts routed to CoT. Trust the nested-CV row above, not this line.")


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------

def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap_ = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap_.add_argument("--data", required=True, help="annotated CSV/TSV/JSON/JSONL")
    ap_.add_argument("--text-col")
    ap_.add_argument("--target-col")
    ap_.add_argument("--label-col")
    ap_.add_argument("--reference-col", help="column with stored production predictions")
    ap_.add_argument("--target", help="target for every row when the file has no target column")
    ap_.add_argument("--no-clean", action="store_true", help="skip the production text cleaning")
    ap_.add_argument("--limit", type=int, help="only use the first N rows (smoke tests)")
    ap_.add_argument("--where", help="filter rows: col=val (e.g. label_source=random)")
    ap_.add_argument("--backend", choices=("local", "remote"), default="local")
    ap_.add_argument("--model", default="Qwen/Qwen2.5-3B-Instruct")
    ap_.add_argument("--quant", choices=("none", "8bit", "4bit"), default="none",
                     help="local only; quantized scores differ slightly from production fp16")
    ap_.add_argument("--url", help="Space URL for --backend remote")
    ap_.add_argument("--key", help="API secret (default: $ABSA_API_KEY, $HF_API_SECRET or $API_SECRET)")
    ap_.add_argument("--batch-size", type=int, default=8)
    ap_.add_argument("--self-consistency", type=int, default=0, help="number of self-consistency samples")
    ap_.add_argument("--cache", help="raw-score cache file (default: <out>/raw_<backend>_<version>.jsonl)")
    ap_.add_argument("--skip-run", action="store_true", help="analyze the cache only; never call a model")
    ap_.add_argument("--config", default="hf-space/pipeline_config.json", help="path to pipeline config for shipped row")
    ap_.add_argument("--out", default="benchmark_results")
    ap_.add_argument("--folds", type=int, default=5)
    ap_.add_argument("--seed", type=int, default=13)
    ap_.add_argument("--bootstrap", type=int, default=2000)
    ap_.add_argument("--select-metric", choices=tuple(SELECT), default="kappa_w")
    ap_.add_argument("--tie-tolerance", type=float, default=0.01, help="tolerance for simplest-within-noise tuning")
    ap_.add_argument("--write-config", help="write the config fitted on all rows to this path")
    args = ap_.parse_args(argv)

    rows = load_rows(args)
    os.makedirs(args.out, exist_ok=True)

    if args.backend == "remote":
        if not args.url:
            sys.exit("--backend remote needs --url")
        key = args.key or os.environ.get("ABSA_API_KEY") or os.environ.get("HF_API_SECRET") or os.environ.get("API_SECRET") or ""
        backend = RemoteBackend(args.url, key, self_consistency=args.self_consistency)
        ident = backend.ident
    else:
        ident = f"local-{args.model.split('/')[-1]}-{args.quant}"
        backend = None
    cache_path = args.cache or os.path.join(args.out, f"raw_{ident}_{ap.PIPELINE_VERSION}.jsonl")
    if backend is None and not args.skip_run:
        missing = not os.path.exists(cache_path)
        if not missing:
            with open(cache_path, encoding="utf-8") as fh:
                have = {json.loads(l)["key"] for l in fh if l.strip()}
            missing = any(row_key(r) not in have for r in rows)
        if missing:
            backend = LocalBackend(args.model, args.quant, self_consistency=args.self_consistency)
    if args.skip_run:
        backend = None
    cache = ensure_raw(rows, backend, cache_path, args.batch_size)

    bench = build_bench(rows, cache)
    n = len(rows)
    if args.folds > min(Counter(bench.gold).values()):
        sys.exit(f"--folds {args.folds} exceeds the smallest class size; lower it")

    preds: Dict[str, List[str]] = {}

    # Stored reference row if available
    if bench.ref and any(bench.ref):
        preds["ref"] = [r if r else "neutral" for r in bench.ref]

    # Baseline A
    preds["A"] = argmax_labels(bench.S1["v1"])

    # Legacy CoT rows
    if all(t is not None for t in bench.legacy45):
        preds["B"] = [ap.legacy_parse(t) for t in bench.legacy45]
        preds["B96"] = [ap.strict_parse(t) or "neutral" for t in bench.legacy_full]

    # New CoT alone
    preds["cot_v2"] = argmax_labels(bench.cot)

    # Self-consistency CoT alone if available
    if bench.cot_samples is not None:
        sc_labels = []
        for cs in bench.cot_samples:
            if cs:
                mean_p = np.mean([_softmax_rows(np.array([c["scores"]]))[0] for c in cs], axis=0)
                sc_labels.append(ap.LABELS[int(mean_p.argmax())])
            else:
                sc_labels.append("neutral")
        preds["cot_sc"] = sc_labels

    # Shipped config
    shipped_cfg = ap.PipelineConfig.load(args.config)
    preds["shipped"], _ = replay(bench, range(n), shipped_cfg, shipped_cfg.stage1_variant)

    # Out-of-fold predictions for individual calibrated stage-1 candidates
    for cand_key in bench.S1:
        s1_out = [None] * n
        for test in stratified_folds(bench.y, args.folds, args.seed):
            train = np.setdiff1d(np.arange(n), test)
            cal = calibrated_config(bench, train, cand_key)
            for i in test:
                s1_out[i] = ap.LABELS[ap.argmax(ap.calibrate(bench.S1[cand_key][i], cal))]
        preds[f"s1_{cand_key}_cal"] = s1_out

    # Out-of-fold nested CV for Hybrid
    hyb_cv = [None] * n
    routes_cv = [None] * n
    s1_tuned = [None] * n
    fold_cfgs = []
    mismatches = 0
    for test in stratified_folds(bench.y, args.folds, args.seed):
        train = np.setdiff1d(np.arange(n), test)
        tuned_cand, tuned = tune(bench, train, args.select_metric, args.folds, args.seed, args.tie_tolerance)
        fold_cfgs.append((tuned_cand, tuned))
        mismatches += check_equivalence(bench, test, tuned_cand, tuned)
        for i in test:
            s1_tuned[i] = ap.LABELS[ap.argmax(ap.calibrate(bench.S1[tuned_cand][i], tuned))]
        labels, routes = replay(bench, test, tuned, tuned_cand)
        for i, lab, rt in zip(test, labels, routes):
            hyb_cv[i], routes_cv[i] = lab, rt
    preds["hybrid_cv"] = hyb_cv

    # Deployable config: fit on every row
    all_idx = np.arange(n)
    fitted_key, fitted = tune(bench, all_idx, args.select_metric, args.folds, args.seed, args.tie_tolerance)
    mismatches += check_equivalence(bench, all_idx, fitted_key, fitted)
    _, fitted_routes = replay(bench, all_idx, fitted, fitted_key)

    order = [k for k in SYSTEMS if k in preds]
    results = {k: metrics(bench.gold, preds[k]) for k in order}
    mc = {k: mcnemar_exact(bench.gold, preds["A"], preds[k]) for k in order if k not in ("A", "ref")}
    boot = bootstrap(bench.gold, {k: preds[k] for k in order}, "A", args.bootstrap, args.seed)
    print_report(bench, preds, results, boot, mc, args, ident, fold_cfgs, routes_cv, s1_tuned, fitted_key, fitted, fitted_routes)

    # Artifacts
    pred_path = os.path.join(args.out, "predictions.csv")
    with open(pred_path, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "target", "text", "gold", *order, "hybrid_cv_route", "cues", "cot_reasoning_status"])
        for i, r in enumerate(rows):
            w.writerow([r["id"], r["target"], r["text"], r["gold"], *(preds[k][i] for k in order),
                        routes_cv[i], " ".join(bench.cues[i]), bench.cot_status[i]])
    fitted_dict = fitted.to_dict()
    fitted_dict["_fitted"] = {
        "data": os.path.basename(args.data), "n": n, "scores": ident, "pipeline": ap.PIPELINE_VERSION,
        "candidate": fitted_key,
        "select_metric": args.select_metric, "nested_cv_kappa_w": round(results["hybrid_cv"]["kappa_w"], 4),
        "nested_cv_accuracy": round(results["hybrid_cv"]["accuracy"], 4),
    }
    with open(os.path.join(args.out, "fitted_config.json"), "w", encoding="utf-8") as fh:
        json.dump(fitted_dict, fh, indent=2)
    with open(os.path.join(args.out, "results.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "n": n, "scores": ident, "pipeline": ap.PIPELINE_VERSION,
            "systems": {k: {"description": SYSTEMS.get(k, k), **results[k], **boot[k],
                            **({"mcnemar_p": mc[k][0]} if k in mc else {})} for k in order},
            "fold_cfgs": [(c, cfg.to_dict()) for c, cfg in fold_cfgs],
            "fitted_config": fitted_dict,
        }, fh, indent=2)
    if args.write_config:
        with open(args.write_config, "w", encoding="utf-8") as fh:
            json.dump(fitted_dict, fh, indent=2)
            fh.write("\n")
    print(f"\nWrote {pred_path}, {os.path.join(args.out, 'results.json')}, {os.path.join(args.out, 'fitted_config.json')}"
          + (f" and {args.write_config}" if args.write_config else ""))


if __name__ == "__main__":
    main()
