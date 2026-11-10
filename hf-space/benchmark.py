#!/usr/bin/env python
"""Benchmark the hybrid ABSA pipeline against human labels.

Step 1 (model, once): for every post compute the raw scores of all stage-1 prompt variants,
the new CoT (verdict read from logits), and the legacy 45-token CoT. Runs locally with
transformers or through the Space's /eval/raw-scores endpoint. Cached as JSONL, so reruns
and re-analysis cost nothing.

Step 2 (offline): replay every system from the cache. Calibration and gate thresholds are
fitted with stratified K-fold cross-validation, nested so the reported numbers for tuned
systems are out-of-fold. Reports accuracy, Cohen's kappa (unweighted and linear), per-class
recall, macro-F1, exact McNemar tests and paired-bootstrap intervals against Approach A.

Data: CSV/TSV/JSON/JSONL with a text column (cleaned_text|text|tweet|post), a target column
(target|aspect|entity, or pass --target) and a label column (label|gold|gt|ground_truth|
human_label) holding positive/negative/neutral.

Examples:
  python benchmark.py --data bench.csv --backend remote --url https://<space>.hf.space --key <API_SECRET>
  python benchmark.py --data bench.csv --quant 4bit           # local GPU with <8 GB VRAM
  python benchmark.py --data bench.csv --skip-run --write-config pipeline_config.json
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
LABEL_ALIASES = {
    "positive": "positive", "pos": "positive",
    "negative": "negative", "neg": "negative",
    "neutral": "neutral", "neu": "neutral",
}

SYSTEMS = {
    "A": "A: v1 logit verbalizer (pre-CoT production)",
    "B": "B: legacy CoT, 45 tokens, old parser (current production)",
    "B96": "B': legacy CoT, 96 tokens, strict parser",
    "cot_v2": "New CoT prompt alone, verdict from logits",
    "s1_v2_zero": "Stage 1: new prompt, no anchors",
    "s1_v2": "Stage 1: new prompt + anchors",
    "s1_v2_zero_cal": "Stage 1: new prompt, no anchors + calibration (CV)",
    "s1_v2_cal": "Stage 1: new prompt + anchors + calibration (CV)",
    "hybrid_default": "Hybrid, untuned defaults",
    "hybrid_cv": "Hybrid, tuned (nested CV)",
}

# Searched per stage-1 variant (calibration is refitted for each variant). The first value of
# each list is the shipped default, so ties resolve to it. gate_margin 1.01 = send every post
# that is not a guarded neutral to CoT; cot_weight 0 never appears because margin 0 + no cues
# already means "stage 1 only".
VARIANT_ORDER = ("v2", "v2_zero", "v1")
GRID = {
    "gate_margin": [0.25, 0.0, 0.15, 0.35, 0.5, 1.01],
    "gate_cues": ["all", "none"],
    "neutral_guard": [0.5, 0.4, 0.6, 0.75, 1.01],
    "cot_weight": [0.5, 0.35, 0.65, 0.85],
    "cot_can_neutralize": [True, False],
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
    tcol = _pick(cols, args.text_col, TEXT_COLS, "text")
    gcol = _pick(cols, args.target_col, TARGET_COLS, "target")
    lcol = _pick(cols, args.label_col, LABEL_COLS, "label")
    if not tcol or not lcol:
        sys.exit(f"Could not find text/label columns in {sorted(cols)}; use --text-col/--label-col")
    rows, bad = [], Counter()
    for i, rec in enumerate(records):
        gold = LABEL_ALIASES.get(str(rec.get(lcol, "")).strip().lower())
        if gold is None:
            bad[str(rec.get(lcol))] += 1
            continue
        target = str((rec.get(gcol) if gcol else None) or args.target or "").strip()
        if not target:
            sys.exit(f"Row {i} has no target; add a target column or pass --target")
        text = str(rec.get(tcol) or "")
        rows.append({
            "row": i,
            "id": rec.get("id", i),
            "target": target,
            "text": text if args.no_clean else clean_post(text),
            "gold": gold,
        })
    if bad:
        sys.exit(f"Unrecognised labels {dict(bad)}; expected positive/negative/neutral")
    if args.limit:
        rows = rows[: args.limit]
    return rows


# --------------------------------------------------------------------------------------
# Backends + cache
# --------------------------------------------------------------------------------------

class LocalBackend:
    def __init__(self, model_id: str, quant: str):
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

    def __call__(self, texts: List[str], target: str) -> List[dict]:
        return self.engine.raw_scores(texts, target, self.cfg)


class RemoteBackend:
    def __init__(self, url: str, key: str, timeout: int = 600):
        self.url = url.rstrip("/") + "/eval/raw-scores"
        self.key = key
        self.timeout = timeout
        host = re.sub(r"^https?://", "", url).split("/")[0]
        self.ident = "remote-" + re.sub(r"[^A-Za-z0-9.-]", "_", host)
        self._warned = False

    def __call__(self, texts: List[str], target: str) -> List[dict]:
        body = json.dumps({"texts": texts, "target": target}).encode()
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


def kappa_cm(cm: np.ndarray, linear: bool) -> float:
    n = cm.sum()
    i, j = np.indices(cm.shape)
    d = np.abs(i - j) / (cm.shape[0] - 1) if linear else (i != j).astype(float)
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
        "kappa": kappa_cm(cm, False),
        "kappa_w": kappa_cm(cm, True),
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
            kw[k][b] = kappa_cm(confusion(g[s], P[k][s]), True)
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
# Replay
# --------------------------------------------------------------------------------------

@dataclasses.dataclass
class Bench:
    rows: List[dict]
    gold: List[str]
    y: np.ndarray            # pipeline label index (pos, neg, neu)
    S1: Dict[str, np.ndarray]
    cot: np.ndarray
    cot_status: List[str]
    cues: List[List[str]]
    legacy45: List[Optional[str]]
    legacy_full: List[Optional[str]]
    clipped: int


def build_bench(rows: List[dict], cache: Dict[str, dict]) -> Bench:
    raws = [cache[row_key(r)] for r in rows]
    leg = [r.get("legacy_cot") or {} for r in raws]
    return Bench(
        rows=rows,
        gold=[r["gold"] for r in rows],
        y=np.array([LAB_IDX[r["gold"]] for r in rows]),
        S1={v: np.array([r["stage1"][v] for r in raws], dtype=float) for v in ap.STAGE1_VARIANTS},
        cot=np.array([r["cot"]["scores"] for r in raws], dtype=float),
        cot_status=[r["cot"]["status"] for r in raws],
        cues=[r["cues"] for r in raws],
        legacy45=[l.get("text_legacy") for l in leg],
        legacy_full=[l.get("text_full") for l in leg],
        clipped=sum(1 for r in raws if r.get("clipped")),
    )


def argmax_labels(S: np.ndarray) -> List[str]:
    return [ap.LABELS[int(i)] for i in S.argmax(axis=1)]


def replay(bench: Bench, idx: Sequence[int], cfg: ap.PipelineConfig) -> Tuple[List[str], List[str]]:
    """Reference replay through the production decision code (absa_pipeline.decide)."""
    labels, routes = [], []
    for i in idx:
        d = ap.decide(bench.S1[cfg.stage1_variant][i], bench.cues[i], cfg, bench.cot[i])
        labels.append(d["label"])
        routes.append(d["route"])
    return labels, routes


def _softmax_rows(Z: np.ndarray) -> np.ndarray:
    Z = Z - Z.max(axis=1, keepdims=True)
    E = np.exp(Z)
    return E / E.sum(axis=1, keepdims=True)


def _bias_vec(bias: Dict[str, float]) -> np.ndarray:
    return np.array([bias[k] for k in ap.LABELS])


def fast_replay(P1: np.ndarray, PC: np.ndarray, has_cue: np.ndarray, cfg: ap.PipelineConfig) -> Tuple[np.ndarray, np.ndarray]:
    """Vectorised twin of absa_pipeline.decide for the grid search: (label index, gated)."""
    l1, lc = P1.argmax(axis=1), PC.argmax(axis=1)
    top = np.sort(P1, axis=1)
    margin = top[:, -1] - top[:, -2]
    guarded = (l1 == ap.NEU) & (P1[:, ap.NEU] >= cfg.neutral_guard)
    gated = ~guarded & (cfg.cot_weight > 0) & ((margin < cfg.gate_margin) | ((l1 != ap.NEU) & has_cue))
    blocked = (l1 != ap.NEU) & (lc == ap.NEU) & (not cfg.cot_can_neutralize)
    w = min(max(cfg.cot_weight, 0.0), 1.0)
    mixed = ((1 - w) * np.log(np.maximum(P1, 1e-9)) + w * np.log(np.maximum(PC, 1e-9))).argmax(axis=1)
    return np.where(gated & ~blocked, mixed, l1), gated


def _fast_score(gold_ord: np.ndarray, labels: np.ndarray, select: str) -> float:
    cm = confusion(gold_ord, TO_ORD[labels])
    if select == "kappa_w":
        return kappa_cm(cm, True)
    if select == "accuracy":
        return float(np.trace(cm) / cm.sum())
    f1 = []
    for k in range(3):
        tp, support, predicted = cm[k, k], cm[k].sum(), cm[:, k].sum()
        p = tp / predicted if predicted else 0.0
        r = tp / support if support else 0.0
        f1.append(2 * p * r / (p + r) if (p + r) > 0 else 0.0)
    return float(np.mean(f1))


def calibrated_config(bench: Bench, idx: np.ndarray, variant: str = "v2") -> ap.PipelineConfig:
    cfg = ap.PipelineConfig(stage1_variant=variant)
    cfg.scale, cfg.bias = fit_calibration(bench.S1[variant][idx], bench.y[idx])
    cfg.cot_scale, cfg.cot_bias = fit_calibration(bench.cot[idx], bench.y[idx])
    return cfg


def _arrays(bench: Bench, idx: np.ndarray, cfg: ap.PipelineConfig):
    P1 = _softmax_rows(cfg.scale * bench.S1[cfg.stage1_variant][idx] + _bias_vec(cfg.bias))
    PC = _softmax_rows(cfg.cot_scale * bench.cot[idx] + _bias_vec(cfg.cot_bias))
    has_cue = np.array([any(c in cfg.gate_cues for c in bench.cues[i]) for i in idx], dtype=bool)
    return P1, PC, has_cue


def tune(bench: Bench, idx: np.ndarray, select: str, k_inner: int, seed: int) -> ap.PipelineConfig:
    """Pick stage-1 variant + gate/combination params using only the rows in idx.

    Each candidate is scored on out-of-fold calibrated probabilities (calibration refitted on
    inner training folds), so calibration never scores the rows it was fitted on. Ties prefer
    fewer CoT calls, then the shipped defaults. Calibration is finally refitted on all of idx.
    """
    idx = np.asarray(idx)
    gold_ord = _idx([bench.gold[i] for i in idx])
    y_sub = bench.y[idx]
    k = max(2, min(k_inner, min(Counter(y_sub.tolist()).values())))
    inner = stratified_folds(y_sub, k, seed)
    any_cue = np.array([bool(bench.cues[i]) for i in idx], dtype=bool)
    no_cue = np.zeros(len(idx), dtype=bool)
    keys = list(GRID)
    best_key, best = None, None
    for variant in VARIANT_ORDER:
        P1, PC = np.empty((len(idx), 3)), np.empty((len(idx), 3))
        for test_pos in inner:
            train_pos = np.setdiff1d(np.arange(len(idx)), test_pos)
            cal = calibrated_config(bench, idx[train_pos], variant)
            P1[test_pos], PC[test_pos], _ = _arrays(bench, idx[test_pos], cal)
        for values in itertools.product(*(GRID[k] for k in keys)):
            params = dict(zip(keys, values))
            use_cues = params["gate_cues"] == "all"
            params["gate_cues"] = list(ap.ALL_CUES) if use_cues else []
            labels, gated = fast_replay(P1, PC, any_cue if use_cues else no_cue, ap.PipelineConfig(**params))
            key = (round(_fast_score(gold_ord, labels, select), 9), -int(gated.sum()))
            if best_key is None or key > best_key:
                best_key, best = key, (variant, params)
    variant, params = best
    return dataclasses.replace(calibrated_config(bench, idx, variant), **params)


def check_equivalence(bench: Bench, idx: np.ndarray, cfg: ap.PipelineConfig) -> int:
    """Number of posts where the vectorised grid replay disagrees with the production code."""
    ref, _ = replay(bench, idx, cfg)
    labels, _ = fast_replay(*_arrays(bench, idx, cfg), cfg)
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
    return (f"stage1={cfg.stage1_variant}, margin<{cfg.gate_margin:g}, {cues}, guard={cfg.neutral_guard:g}, "
            f"w={cfg.cot_weight:g}, neutralize={'y' if cfg.cot_can_neutralize else 'n'}, "
            f"scale={cfg.scale:.2f}, bias_neu={cfg.bias['neutral']:+.2f}, bias_neg={cfg.bias['negative']:+.2f}")


# --------------------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------------------

def pct(x: float) -> str:
    return "  n/a" if x != x else f"{100 * x:5.1f}"


def print_report(bench: Bench, preds, results, boot, mc, args, ident, fold_cfgs, routes_cv, s1_tuned, fitted, fitted_routes):
    n = len(bench.gold)
    counts = Counter(bench.gold)
    print()
    print(f"## ABSA benchmark: {n} posts (neg {counts['negative']}, neu {counts['neutral']}, pos {counts['positive']})")
    print(f"Scores: {ident}, pipeline {ap.PIPELINE_VERSION}; {args.folds}-fold CV, seed {args.seed}, "
          f"selection metric {args.select_metric}; {bench.clipped} posts clipped to {ap.PipelineConfig().max_post_tokens} tokens")
    print()
    print("| System | Acc % | κ | κ_w [95% CI] | Δκ_w vs A [95% CI] | Recall neg/neu/pos % | Macro-F1 | McNemar vs A |")
    print("|---|---:|---:|---|---|---|---:|---|")
    for key, m in results.items():
        r = m["recall"]
        ci, dci = boot[key]["kappa_w_ci"], boot[key]["delta_ci"]
        if key == "A":
            mc_txt, delta = "—", "—"
        else:
            p, ab, ba = mc[key]
            mc_txt = f"p={p:.3f} (+{ba}/−{ab})"
            delta = f"{m['kappa_w'] - results['A']['kappa_w']:+.3f} [{dci[0]:+.2f}, {dci[1]:+.2f}]"
        print(f"| {SYSTEMS[key]} | {pct(m['accuracy'])} | {m['kappa']:.3f} | {m['kappa_w']:.3f} [{ci[0]:.2f}, {ci[1]:.2f}] "
              f"| {delta} | {pct(r['negative'])}/{pct(r['neutral'])}/{pct(r['positive'])} | {m['macro_f1']:.3f} | {mc_txt} |")
    print()
    print("McNemar column: (+fixed/−broken) = posts A got wrong that the system gets right / A right, system wrong.")

    print("\n### Confusion matrices (rows = gold, cols = predicted: neg, neu, pos)")
    for key in ("A", "B", "s1_v2_cal", "hybrid_cv"):
        if key in results:
            cm = results[key]["confusion"]
            print(f"- {SYSTEMS[key]}: " + " | ".join(f"{ORDER[i][:3]} {cm[i]}" for i in range(3)))

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
    for f, cfg in enumerate(fold_cfgs):
        print(f"  - fold {f + 1}: {gate_summary(cfg)}")

    print("\n### Cue categories (fitted config, in-sample: optimistic)")
    print("| Cue | posts | stage-1 correct | CoT alone correct | hybrid correct |")
    print("|---|---:|---:|---:|---:|")
    p1 = [ap.LABELS[ap.argmax(ap.calibrate(s, fitted))] for s in bench.S1[fitted.stage1_variant]]
    hyb, _ = replay(bench, range(n), fitted)
    for cue in ap.ALL_CUES:
        idx = [i for i in range(n) if cue in bench.cues[i] and p1[i] != "neutral"]
        if idx:
            ok = lambda lab: sum(1 for i in idx if lab[i] == bench.gold[i])
            print(f"| {cue} | {len(idx)} | {ok(p1)} | {ok(preds['cot_v2'])} | {ok(hyb)} |")

    fm = metrics(bench.gold, hyb)
    print(f"\n### Fitted on all {n} posts (deployable config)")
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
    ap_.add_argument("--target", help="target for every row when the file has no target column")
    ap_.add_argument("--no-clean", action="store_true", help="skip the production text cleaning")
    ap_.add_argument("--limit", type=int, help="only use the first N rows (smoke tests)")
    ap_.add_argument("--backend", choices=("local", "remote"), default="local")
    ap_.add_argument("--model", default="Qwen/Qwen2.5-3B-Instruct")
    ap_.add_argument("--quant", choices=("none", "8bit", "4bit"), default="none",
                     help="local only; quantized scores differ slightly from production fp16")
    ap_.add_argument("--url", help="Space URL for --backend remote")
    ap_.add_argument("--key", help="API secret (default: $ABSA_API_KEY, $HF_API_SECRET or $API_SECRET)")
    ap_.add_argument("--batch-size", type=int, default=8)
    ap_.add_argument("--cache", help="raw-score cache file (default: <out>/raw_<backend>_<version>.jsonl)")
    ap_.add_argument("--skip-run", action="store_true", help="analyze the cache only; never call a model")
    ap_.add_argument("--out", default="benchmark_results")
    ap_.add_argument("--folds", type=int, default=5)
    ap_.add_argument("--seed", type=int, default=13)
    ap_.add_argument("--bootstrap", type=int, default=2000)
    ap_.add_argument("--select-metric", choices=tuple(SELECT), default="kappa_w")
    ap_.add_argument("--write-config", help="write the config fitted on all rows to this path")
    args = ap_.parse_args(argv)

    rows = load_rows(args)
    os.makedirs(args.out, exist_ok=True)

    if args.backend == "remote":
        if not args.url:
            sys.exit("--backend remote needs --url")
        key = args.key or os.environ.get("ABSA_API_KEY") or os.environ.get("HF_API_SECRET") or os.environ.get("API_SECRET") or ""
        backend = RemoteBackend(args.url, key)
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
            backend = LocalBackend(args.model, args.quant)
    if args.skip_run:
        backend = None
    cache = ensure_raw(rows, backend, cache_path, args.batch_size)

    bench = build_bench(rows, cache)
    n = len(rows)
    if args.folds > min(Counter(bench.gold).values()):
        sys.exit(f"--folds {args.folds} exceeds the smallest class size; lower it")

    preds: Dict[str, List[str]] = {"A": argmax_labels(bench.S1["v1"])}
    if all(t is not None for t in bench.legacy45):
        preds["B"] = [ap.legacy_parse(t) for t in bench.legacy45]
        preds["B96"] = [ap.strict_parse(t) or "neutral" for t in bench.legacy_full]
    preds["cot_v2"] = argmax_labels(bench.cot)
    preds["s1_v2_zero"] = argmax_labels(bench.S1["v2_zero"])
    preds["s1_v2"] = argmax_labels(bench.S1["v2"])
    preds["hybrid_default"], _ = replay(bench, range(n), ap.PipelineConfig())

    # Out-of-fold predictions for everything that is fitted.
    s1_cal = {v: [None] * n for v in ("v2_zero", "v2")}
    hyb_cv = [None] * n
    routes_cv = [None] * n
    s1_tuned = [None] * n  # stage-1 labels of the config each fold selected
    fold_cfgs = []
    mismatches = 0
    for test in stratified_folds(bench.y, args.folds, args.seed):
        train = np.setdiff1d(np.arange(n), test)
        for v in s1_cal:
            cal = calibrated_config(bench, train, v)
            for i in test:
                s1_cal[v][i] = ap.LABELS[ap.argmax(ap.calibrate(bench.S1[v][i], cal))]
        tuned = tune(bench, train, args.select_metric, args.folds, args.seed)
        fold_cfgs.append(tuned)
        mismatches += check_equivalence(bench, test, tuned)
        for i in test:
            s1_tuned[i] = ap.LABELS[ap.argmax(ap.calibrate(bench.S1[tuned.stage1_variant][i], tuned))]
        labels, routes = replay(bench, test, tuned)
        for i, lab, rt in zip(test, labels, routes):
            hyb_cv[i], routes_cv[i] = lab, rt
    preds["s1_v2_zero_cal"] = s1_cal["v2_zero"]
    preds["s1_v2_cal"] = s1_cal["v2"]
    preds["hybrid_cv"] = hyb_cv

    # Deployable config: fit on every row.
    all_idx = np.arange(n)
    fitted = tune(bench, all_idx, args.select_metric, args.folds, args.seed)
    mismatches += check_equivalence(bench, all_idx, fitted)
    _, fitted_routes = replay(bench, all_idx, fitted)
    if mismatches:
        print(f"WARNING: vectorised grid replay disagreed with absa_pipeline.decide on {mismatches} posts "
              "(near-exact ties); reported predictions use absa_pipeline.decide.")

    order = [k for k in SYSTEMS if k in preds]
    results = {k: metrics(bench.gold, preds[k]) for k in order}
    mc = {k: mcnemar_exact(bench.gold, preds["A"], preds[k]) for k in order if k != "A"}
    boot = bootstrap(bench.gold, {k: preds[k] for k in order}, "A", args.bootstrap, args.seed)
    print_report(bench, preds, results, boot, mc, args, ident, fold_cfgs, routes_cv, s1_tuned, fitted, fitted_routes)

    # Artifacts.
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
        "select_metric": args.select_metric, "nested_cv_kappa_w": round(results["hybrid_cv"]["kappa_w"], 4),
        "nested_cv_accuracy": round(results["hybrid_cv"]["accuracy"], 4),
    }
    with open(os.path.join(args.out, "fitted_config.json"), "w", encoding="utf-8") as fh:
        json.dump(fitted_dict, fh, indent=2)
    with open(os.path.join(args.out, "results.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "n": n, "scores": ident, "pipeline": ap.PIPELINE_VERSION,
            "systems": {k: {"description": SYSTEMS[k], **results[k], **boot[k],
                            **({"mcnemar_p": mc[k][0]} if k in mc else {})} for k in order},
            "fold_configs": [c.to_dict() for c in fold_cfgs],
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
