"""Target-oriented ABSA inference pipeline (Qwen2.5-3B-Instruct, no fine-tuning).

Stage 1  Next-token verbalizer over every post: one forward pass, probabilities from
         logsumexp over the label tokens, then temperature/bias calibration.
Stage 2  Chain-of-thought on a gated subset only: posts whose stage-1 margin is small,
         or whose stage-1 label is polar while the text carries informal cues (profanity,
         slang, sarcasm markers, contrast). The CoT verdict is read from logits after a
         forced "Verdict:" prefix, so it is a real distribution, never a parsed string.
Stage 3  A one-sentence rationale conditioned on the final label. The rationale is
         generated after the decision, so it can never change the classification.

The pure-Python parts (cues, calibration, gating, combination) do not touch torch, so
benchmark.py can replay any configuration offline over cached raw scores.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
from dataclasses import asdict, dataclass, field, fields
from typing import Dict, List, Optional, Sequence, Tuple

log = logging.getLogger("absa_pipeline")

# Bump whenever a prompt, anchor, or raw-score format changes: benchmark caches key on it.
PIPELINE_VERSION = "hybrid-v2"

LABELS = ("positive", "negative", "neutral")
POS, NEG, NEU = 0, 1, 2


# --------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------

ALL_CUES = ("profanity", "slang", "sarcasm", "affect_emoji", "emphasis", "contrast", "defense")
STAGE1_VARIANTS = ("v1", "v2_zero", "v2", "two_step", "ensemble")


@dataclass
class PipelineConfig:
    # Stage-1 prompt variant: "v1", "v2_zero", "v2", "two_step", or "ensemble".
    stage1_variant: str = "v1"
    # Stage-1 calibration: z_k = scale * score_k + bias_k (fitted by benchmark.py).
    scale: float = 1.0
    bias: Dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in LABELS})
    # Same calibration for the CoT verdict distribution (fitted separately).
    cot_scale: float = 1.0
    cot_bias: Dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in LABELS})
    # Gate: send a post to CoT when top1 - top2 < gate_margin, or when it carries one of
    # gate_cues and the stage-1 label is polar.
    gate_margin: float = 0.0
    gate_cues: List[str] = field(default_factory=list)
    # Combination: CoT may not override a neutral label whose calibrated p_neu >= neutral_guard
    # (such posts are not even sent to CoT). Set above 1.0 to disable the guard.
    neutral_guard: float = 0.5
    # Whether CoT may turn a polar stage-1 label into neutral.
    cot_can_neutralize: bool = True
    # Weight of the CoT expert in the log-linear mix with stage 1 (0 = ignore CoT).
    cot_weight: float = 0.0

    # Step 3 candidate flags
    null_calibration: bool = False
    ensemble_members: List[str] = field(default_factory=lambda: ["v1", "v2_zero"])
    gate_on_disagreement: bool = False
    cot_samples: int = 1
    cot_temperature: float = 0.7
    cot_seed: int = 0

    # Budgets.
    max_post_tokens: int = 320
    cot_max_new_tokens: int = 96
    rationale_max_new_tokens: int = 40
    generate_rationales: bool = True

    @classmethod
    def from_dict(cls, data: dict) -> "PipelineConfig":
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(data) - known - {"_comment", "_fitted"})
        if unknown:
            log.warning("Ignoring unknown pipeline config keys: %s", unknown)
        cfg = cls(**{k: v for k, v in data.items() if k in known})
        cfg.bias = {k: float(cfg.bias.get(k, 0.0)) for k in LABELS}
        cfg.cot_bias = {k: float(cfg.cot_bias.get(k, 0.0)) for k in LABELS}
        cfg.gate_cues = [c for c in cfg.gate_cues if c in ALL_CUES]
        if cfg.stage1_variant not in STAGE1_VARIANTS:
            raise ValueError(f"stage1_variant must be one of {STAGE1_VARIANTS}")
        return cfg

    @classmethod
    def load(cls, path: str) -> "PipelineConfig":
        if not os.path.exists(path):
            log.warning("No pipeline config at %s; using built-in defaults.", path)
            return cls()
        with open(path, encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------------------

# Approach A exactly as it was deployed before the CoT switch (kept for benchmarking).
V1_SYS = (
    "You are an aspect-based sentiment classifier. Given a tweet and a target, "
    "answer with exactly one word: positive, negative, or neutral. "
    "Judge sentiment toward the TARGET only."
)

V2_SYS = (
    "You classify the sentiment of a social media post (X or Reddit) toward one TARGET.\n"
    "positive: the author likes, praises, supports, defends, or is excited about the TARGET.\n"
    "negative: the author dislikes, criticizes, mocks, or is disappointed by the TARGET. "
    "Sarcastic praise is negative.\n"
    "neutral: the author shares news, facts, announcements, dates, countdowns, rumors, or "
    "questions about the TARGET without giving an opinion of it, or mentions the TARGET only "
    "in passing.\n"
    "Only the author's sentiment toward the TARGET counts; praise or attacks aimed at other "
    "people, rivals, or things do not.\n"
    "Swearing and slang often express love or loyalty; judge what the author means, not the "
    "words.\n"
    "If the post gives no clear opinion about the TARGET, answer neutral.\n"
    "Answer with one word: positive, negative, or neutral."
)

OPINION_SYS = (
    "You read a social media post (X or Reddit) and decide whether its author expresses "
    "their own opinion of one TARGET. Answer yes if the author praises, criticizes, mocks, defends, or shows "
    "excitement or disappointment about the TARGET, including through sarcasm or slang. Answer no if the post "
    "only shares news, facts, announcements, dates, countdowns, rumors, or questions about the TARGET, or "
    "mentions it only in passing. Answer with one word: yes or no."
)

POLARITY_SYS = (
    "The author of this social media post expresses an opinion of the TARGET. Decide whether "
    "that opinion is positive or negative. Only the author's opinion of the TARGET counts, not of other people, "
    "rivals, or things. Sarcastic praise is negative. Swearing and slang often express love or loyalty; judge "
    "what the author means, not the words. Answer with one word: positive or negative."
)

COT_SYS = (
    "You analyze the sentiment of a social media post (X or Reddit) toward one TARGET.\n"
    "First check whether the author gives their own opinion of the TARGET at all. News, facts, "
    "announcements, dates, countdowns, rumors, and questions without an opinion are neutral; "
    "do not invent an emotion the post does not express.\n"
    "If there is an opinion:\n"
    "- Only sentiment toward the TARGET counts, not toward other people, rivals, or things.\n"
    "- Sarcastic praise is negative.\n"
    "- Swearing and slang often express love or loyalty; judge what the author means, not the "
    "words.\n"
    "- With mixed opinions, give the author's overall stance toward the TARGET.\n"
    "Answer in exactly this format:\n"
    "Reasoning: <one short sentence>\n"
    "Verdict: <positive, negative, or neutral>"
)

# The CoT prompt that produced the 51.92% benchmark (kept verbatim for diagnostics only).
LEGACY_COT_SYS = (
    "You are an aspect-based sentiment reasoning engine. Analyze the author's authentic attitude strictly toward the TARGET in the post (from X or Reddit).\n"
    "Core Rules (Domain-Agnostic):\n"
    "1. TARGET FOCUS: Evaluate sentiment ONLY toward TARGET. Hostility or praise toward bystanders, rivals, or external factors is NOT toward TARGET.\n"
    "2. SARCASM: Sarcastic praise is negative. Sarcastic self-deprecation or hyperbolic praise is positive.\n"
    "3. SLANG & PROFANITY: Profanity used for excitement, fan loyalty, or attacking bystanders (e.g. 'I'd fight anyone for [target]', 'this is f***ing incredible') is POSITIVE toward TARGET.\n"
    "4. CONFLICTING CLAUSES: When a post contains mixed opinions, determine whether the author's net stance toward the TARGET itself is positive, negative, or neutral.\n"
    "Output format:\n"
    "Reasoning: <one concise sentence analyzing author's stance toward TARGET, decoding any slang or sarcasm>\n"
    "Verdict: <positive | negative | neutral>"
)
LEGACY_COT_TOKENS = 45

RATIONALE_SYS = (
    "You explain sentiment labels for social media posts. You are given a post, a TARGET, and "
    "the author's sentiment toward the TARGET. Write one short sentence (at most 25 words) that "
    "points to what in the post shows that sentiment. For a neutral post, say what kind of post "
    "it is, for example news, a question, or a factual update. Write only the sentence."
)

COT_PREFIX = "Reasoning:"


# --------------------------------------------------------------------------------------
# Anchors (few-shot demonstrations of the domain-agnostic rules)
# --------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Anchor:
    target: str
    post: str
    label: str
    reasoning: str


ANCHORS: Tuple[Anchor, ...] = (
    Anchor(
        "OpenAI",
        "OpenAI just dropped GPT-5. Google is completely cooked lmaooo.",
        "positive",
        "The attack on Google is bystander rivalry; the stance toward OpenAI is excited praise.",
    ),
    Anchor(
        "Elden Ring",
        "Elden Ring DLC is so fucking good I want to punch my monitor.",
        "positive",
        "Profanity and violent hyperbole express extreme love for the game.",
    ),
    Anchor(
        "Tesla",
        "Tesla's build quality is truly unmatched, panels falling off after 200 miles.",
        "negative",
        "The praise is sarcastic; panels falling off shows disappointment with Tesla.",
    ),
    Anchor(
        "Arsenal",
        "Anyone know what channel the Arsenal match is on tonight?",
        "neutral",
        "The author only asks when and where to watch the game and gives no opinion of Arsenal.",
    ),
    Anchor(
        "Paris Olympics",
        "10 days until the Paris Olympics opening ceremony.",
        "neutral",
        "The post is a plain countdown with no opinion of the Paris Olympics.",
    ),
)


def _user(target: str, post: str) -> str:
    return f"Target: {target}\nPost: {post}"


def stage1_messages(variant: str, target: str, post: str) -> List[dict]:
    if variant == "v1":
        return [
            {"role": "system", "content": V1_SYS},
            {"role": "user", "content": f"Target: {target}\nTweet: {post}\nSentiment:"},
        ]
    if variant not in ("v2", "v2_zero"):
        raise ValueError(f"unknown stage-1 single-prompt variant {variant!r}")
    msgs = [{"role": "system", "content": V2_SYS}]
    if variant == "v2":
        for a in ANCHORS:
            msgs.append({"role": "user", "content": _user(a.target, a.post)})
            msgs.append({"role": "assistant", "content": a.label})
    msgs.append({"role": "user", "content": _user(target, post)})
    return msgs


def cot_messages(target: str, post: str) -> List[dict]:
    msgs = [{"role": "system", "content": COT_SYS}]
    for a in ANCHORS:
        msgs.append({"role": "user", "content": _user(a.target, a.post)})
        msgs.append({"role": "assistant", "content": f"Reasoning: {a.reasoning}\nVerdict: {a.label}"})
    msgs.append({"role": "user", "content": _user(target, post)})
    return msgs


# --------------------------------------------------------------------------------------
# Rule-based cues (domain-agnostic, zero-cost gate triggers)
# --------------------------------------------------------------------------------------

CUE_PATTERNS = {
    "profanity": re.compile(
        r"\b(?:f+u+c*k+(?:ing|ed|er)?|sh+i+t+(?:ty)?|damn|bitch|ass(?:hole)?|crap|hell)\b",
        re.IGNORECASE,
    ),
    "slang": re.compile(
        r"\b(?:cooked|peak|mid|goated|fire|trash|garbage|clowned|bodied|carried|diff|cap|no\s+cap|fr\b|frfr)\b",
        re.IGNORECASE,
    ),
    "sarcasm": re.compile(
        r"(?:/s\b|\b(?:yeah\s+right|surely|as\s+if|obviously)\b|\b(?:brilliant|genius|masterclass)\b(?=.*(?:broken|fail|bug|delay)))",
        re.IGNORECASE,
    ),
    "affect_emoji": re.compile(r"[\U0001F480\U0001F525\U0001F44E\U0001F44D\U0001F921\U0001F62D\U0001F979]"),
    "emphasis": re.compile(r"[!?]{2,}|\b[A-Z]{3,}\b"),
    "contrast": re.compile(r"\b(?:but|however|although|except|despite)\b", re.IGNORECASE),
}


def informal_cues(text: str, target: str) -> List[str]:
    cues = [name for name, pat in CUE_PATTERNS.items() if pat.search(text)]
    if re.search(r"\b(?:leave\s+\w+\s+alone|don't\s+blame|not\s+(?:their|his|her)\s+fault)\b", text, re.IGNORECASE):
        cues.append("defense")
    return cues


# --------------------------------------------------------------------------------------
# Pure math, calibration, and combination
# --------------------------------------------------------------------------------------

def softmax(z: Sequence[float]) -> List[float]:
    m = max(z)
    e = [math.exp(v - m) for v in z]
    s = sum(e)
    return [v / s for v in e]


def log_softmax(z: Sequence[float]) -> List[float]:
    m = max(z)
    lse = m + math.log(sum(math.exp(v - m) for v in z))
    return [v - lse for v in z]


def two_step_scores(op: Sequence[float], pol: Sequence[float]) -> List[float]:
    """Combine opinion (yes/no) and polarity (pos/neg) into 3-class log-probs in LABELS order."""
    l_op = log_softmax(op)
    l_pol = log_softmax(pol)
    pos = l_op[0] + l_pol[0]
    neg = l_op[0] + l_pol[1]
    neu = l_op[1]
    return [pos, neg, neu]


def stage1_vector(
    stage1: Dict[str, Sequence[float]],
    null: Optional[Dict[str, Sequence[float]]],
    cfg: PipelineConfig,
) -> Tuple[List[float], Optional[List[str]]]:
    """Build the single stage-1 score vector (and member labels if ensemble) for one post."""
    if cfg.stage1_variant == "ensemble":
        members = cfg.ensemble_members
        member_scores = []
        member_labels = []
        for m in members:
            s = stage1[m]
            lsm = log_softmax(s)
            if cfg.null_calibration and null and m in null:
                s_cal = [a - b for a, b in zip(lsm, null[m])]
            else:
                s_cal = lsm
            member_scores.append(s_cal)
            member_labels.append(LABELS[argmax(s_cal)])
        mean_scores = [sum(member_scores[i][k] for i in range(len(members))) / len(members) for k in range(3)]
        return mean_scores, member_labels
    else:
        variant = cfg.stage1_variant
        s = stage1[variant]
        if cfg.null_calibration and null and variant in null:
            scores = [a - b for a, b in zip(log_softmax(s), null[variant])]
        else:
            scores = list(s)
        return scores, None


def calibrate(scores: Sequence[float], cfg: PipelineConfig) -> List[float]:
    return softmax([cfg.scale * s + cfg.bias[k] for s, k in zip(scores, LABELS)])


def calibrate_cot(scores: Sequence[float], cfg: PipelineConfig) -> List[float]:
    return softmax([cfg.cot_scale * s + cfg.cot_bias[k] for s, k in zip(scores, LABELS)])


def argmax(p: Sequence[float]) -> int:
    return max(range(len(p)), key=lambda i: p[i])


def margin(p: Sequence[float]) -> float:
    top = sorted(p, reverse=True)
    return top[0] - top[1]


def needs_cot(
    p1: Sequence[float],
    cues: Sequence[str],
    cfg: PipelineConfig,
    member_labels: Optional[Sequence[str]] = None,
) -> bool:
    label = argmax(p1)
    if label == NEU and p1[NEU] >= cfg.neutral_guard:
        return False  # CoT would not be allowed to change it anyway
    if cfg.cot_weight <= 0:
        return False
    if cfg.gate_on_disagreement and member_labels and len(set(member_labels)) > 1:
        return True
    if margin(p1) < cfg.gate_margin:
        return True
    return label != NEU and any(c in cfg.gate_cues for c in cues)


def combine(p1: Sequence[float], pc: Sequence[float], cfg: PipelineConfig) -> List[float]:
    """Log-linear mix of the stage-1 and CoT distributions, subject to the guards."""
    l1, lc = argmax(p1), argmax(pc)
    if l1 == NEU and p1[NEU] >= cfg.neutral_guard:
        return list(p1)
    if l1 != NEU and lc == NEU and not cfg.cot_can_neutralize:
        return list(p1)
    w = min(max(cfg.cot_weight, 0.0), 1.0)
    eps = 1e-9
    z = [(1 - w) * math.log(max(a, eps)) + w * math.log(max(b, eps)) for a, b in zip(p1, pc)]
    return softmax(z)


def decide(
    scores: Sequence[float],
    cues: Sequence[str],
    cfg: PipelineConfig,
    cot_score_list: Optional[Sequence] = None,
    member_labels: Optional[Sequence[str]] = None,
) -> dict:
    """Full decision for one post. cot_score_list can be [s0, s1, s2] or a list of such vectors."""
    p1 = calibrate(scores, cfg)
    gated = needs_cot(p1, cues, cfg, member_labels)
    if gated and cot_score_list is not None and len(cot_score_list) > 0:
        first = cot_score_list[0]
        if isinstance(first, (int, float)) or (hasattr(first, "item") and not hasattr(first, "__len__")):
            chains = [cot_score_list]
        else:
            chains = [c for c in cot_score_list if c is not None]
        if chains:
            if len(chains) == 1:
                pc = calibrate_cot(chains[0], cfg)
            else:
                pc_list = [calibrate_cot(cs, cfg) for cs in chains]
                pc = [sum(p[k] for p in pc_list) / len(pc_list) for k in range(3)]
            final = combine(p1, pc, cfg)
            route = "cot"
        else:
            final = p1
            route = "logit"
    else:
        final = p1
        route = "logit"
    return {"p1": p1, "probs": final, "label": LABELS[argmax(final)], "gated": gated, "route": route}


# --------------------------------------------------------------------------------------
# Text helpers
# --------------------------------------------------------------------------------------

_SPECIAL_TOKEN_RE = re.compile(r"<\|[^<>|]{1,40}\|>")
_VERDICT_RE = re.compile(r"verdict\s*:\s*\**\s*(positive|negative|neutral)", re.IGNORECASE)
_REASON_PREFIX_RE = re.compile(r"^\s*(?:reasoning|reason|rationale|explanation)\s*:\s*", re.IGNORECASE)


def sanitize(text: str) -> str:
    """Drop chat-template control tokens a post could use to break out of its turn."""
    return _SPECIAL_TOKEN_RE.sub("", text or "").strip()


def cut_reasoning(generated: str) -> tuple:
    """Return (reasoning sentence, status) from a CoT continuation after 'Reasoning:'."""
    text = _REASON_PREFIX_RE.sub("", generated.strip())
    m = re.search(r"verdict\s*:", text, re.IGNORECASE)
    complete = m is not None
    if m:
        text = text[: m.start()]
    line = text.strip().split("\n")[0].strip()
    if not line:
        return "", "empty"
    return line, ("ok" if complete else "truncated")


def legacy_parse(generated: str) -> str:
    """The parser that shipped with the 45-token CoT (reproduced for the benchmark)."""
    gen_text = generated.strip()
    if "Verdict:" in gen_text:
        v_raw = gen_text.split("Verdict:", 1)[1].strip().lower()
    else:
        v_raw = gen_text.lower()
    if "positive" in v_raw:
        return "positive"
    if "negative" in v_raw:
        return "negative"
    return "neutral"


def strict_parse(generated: str) -> Optional[str]:
    m = _VERDICT_RE.search(generated)
    return m.group(1).lower() if m else None


def clean_rationale(text: str, limit: int = 220) -> Optional[str]:
    line = _REASON_PREFIX_RE.sub("", (text or "").strip()).split("\n")[0].strip().strip('"').strip()
    if not line:
        return None
    if len(line) > limit:
        line = line[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return line


# --------------------------------------------------------------------------------------
# Model engine (torch)
# --------------------------------------------------------------------------------------

class AbsaEngine:
    """Runs the three stages on a causal LM. One instance per loaded model."""

    def __init__(self, model, tok):
        self.model = model
        self.tok = tok
        self.tok.padding_side = "left"
        if self.tok.pad_token is None:
            self.tok.pad_token = self.tok.eos_token
        self._word_ids_cache: Dict[Tuple[str, ...], List[List[int]]] = {}
        # Pre-verify label token ids
        self.label_ids = self._word_ids(LABELS)

    # ---- low-level helpers -----------------------------------------------------------

    def _word_ids(self, words: Sequence[str]) -> List[List[int]]:
        cache_key = tuple(words)
        if cache_key in self._word_ids_cache:
            return self._word_ids_cache[cache_key]
        res = []
        for word in words:
            ids = set()
            for v in (word, " " + word, word.capitalize()):
                ids.add(self.tok.encode(v, add_special_tokens=False)[0])
            res.append(sorted(ids))
        flat = [i for group in res for i in group]
        if len(flat) != len(set(flat)):
            raise ValueError(f"verbalizer tokens overlap between words: {words}")
        self._word_ids_cache[cache_key] = res
        return res

    def _prompt(self, messages: List[dict], prefix: str = "") -> str:
        return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True) + prefix

    def clip(self, text: str, max_tokens: int) -> str:
        text = sanitize(text)
        ids = self.tok.encode(text, add_special_tokens=False)
        if len(ids) <= max_tokens:
            return text
        head = self.tok.decode(ids[:max_tokens], skip_special_tokens=True).replace("", "")
        return head.rstrip() + " …"

    def _encode(self, prompts: List[str]):
        enc = self.tok(prompts, return_tensors="pt", padding=True, add_special_tokens=False)
        return {k: v.to(self.model.device) for k, v in enc.items()}

    def _verbalizer_scores(self, prompts: List[str], words: Sequence[str], batch_size: int = 16) -> List[List[float]]:
        """Per prompt: logsumexp of next-token logits over each word's verbalizer tokens."""
        import torch

        word_ids = self._word_ids(words)
        out: List[List[float]] = []
        for i in range(0, len(prompts), batch_size):
            enc = self._encode(prompts[i : i + batch_size])
            attn = enc["attention_mask"]
            pos = attn.long().cumsum(-1) - 1
            pos.masked_fill_(attn == 0, 1)
            with torch.inference_mode():
                base = getattr(self.model, "model", None)
                head = getattr(self.model, "lm_head", None)
                if base is not None and head is not None:
                    hidden = base(input_ids=enc["input_ids"], attention_mask=attn, position_ids=pos, use_cache=False)
                    logits = head(hidden.last_hidden_state[:, -1, :]).float()
                else:  # generic fallback: full forward
                    logits = self.model(**enc, position_ids=pos, use_cache=False).logits[:, -1, :].float()
                scores = torch.stack([torch.logsumexp(logits[:, ids], dim=-1) for ids in word_ids], dim=-1)
            out.extend(scores.cpu().tolist())
        return out

    def _label_scores(self, prompts: List[str], batch_size: int = 16) -> List[List[float]]:
        return self._verbalizer_scores(prompts, LABELS, batch_size)

    def _generate(self, prompts: List[str], max_new_tokens: int, batch_size: int = 16) -> List[List[int]]:
        """Greedy continuation token ids per prompt."""
        import torch

        gen_ids: List[List[int]] = []
        for i in range(0, len(prompts), batch_size):
            enc = self._encode(prompts[i : i + batch_size])
            with torch.inference_mode():
                out = self.model.generate(
                    **enc,
                    max_new_tokens=max_new_tokens,
                    do_sample=False,
                    temperature=None,
                    top_p=None,
                    top_k=None,
                    pad_token_id=self.tok.pad_token_id,
                )
            width = enc["input_ids"].shape[1]
            for row in out[:, width:].tolist():
                gen_ids.append([t for t in row if t != self.tok.pad_token_id])
        return gen_ids

    def _generate_samples(
        self,
        prompts: List[str],
        max_new_tokens: int,
        k: int,
        temperature: float,
        seed: int,
        batch_size: int = 16,
    ) -> List[List[List[int]]]:
        """Sample k continuations per prompt."""
        import torch

        torch.manual_seed(seed)
        gen_ids: List[List[List[int]]] = []
        for i in range(0, len(prompts), batch_size):
            chunk = prompts[i : i + batch_size]
            enc = self._encode(chunk)
            with torch.inference_mode():
                out = self.model.generate(
                    **enc,
                    max_new_tokens=max_new_tokens,
                    do_sample=True,
                    temperature=temperature,
                    top_p=0.9,
                    num_return_sequences=k,
                    pad_token_id=self.tok.pad_token_id,
                )
            width = enc["input_ids"].shape[1]
            for p_idx in range(len(chunk)):
                post_samples = []
                for s_idx in range(k):
                    row = out[p_idx * k + s_idx, width:].tolist()
                    post_samples.append([t for t in row if t != self.tok.pad_token_id])
                gen_ids.append(post_samples)
        return gen_ids

    def _decode(self, ids: List[int]) -> str:
        return self.tok.decode(ids, skip_special_tokens=True)

    # ---- stages ------------------------------------------------------------------------

    def _two_step_scores_with_parts(
        self, posts: List[str], target: str, batch_size: int = 16
    ) -> Tuple[List[List[float]], List[List[float]]]:
        op_prompts = [
            self._prompt([
                {"role": "system", "content": OPINION_SYS},
                {"role": "user", "content": f"Target: {target}\nPost: {p}\nDoes the author express an opinion of the TARGET?"},
            ])
            for p in posts
        ]
        pol_prompts = [
            self._prompt([
                {"role": "system", "content": POLARITY_SYS},
                {"role": "user", "content": f"Target: {target}\nPost: {p}\nOpinion of the TARGET:"},
            ])
            for p in posts
        ]
        op_scores = self._verbalizer_scores(op_prompts, ("yes", "no"), batch_size)
        pol_scores = self._verbalizer_scores(pol_prompts, ("positive", "negative"), batch_size)
        return op_scores, pol_scores

    def stage1_scores(self, posts: List[str], target: str, variant: str = "v2", batch_size: int = 16) -> List[List[float]]:
        if variant == "two_step":
            op, pol = self._two_step_scores_with_parts(posts, target, batch_size)
            return [two_step_scores(o, p) for o, p in zip(op, pol)]
        prompts = [self._prompt(stage1_messages(variant, target, p)) for p in posts]
        return self._label_scores(prompts, batch_size)

    def null_stage1_scores(self, target: str, variants: Sequence[str], batch_size: int = 16) -> Dict[str, List[float]]:
        null_posts = ["N/A", ""]
        res = {}
        for v in variants:
            if v == "ensemble":
                continue
            s = self.stage1_scores(null_posts, target, v, batch_size)
            l0 = log_softmax(s[0])
            l1 = log_softmax(s[1])
            res[v] = [0.5 * (a + b) for a, b in zip(l0, l1)]
        return res

    def cot(
        self,
        posts: List[str],
        target: str,
        max_new_tokens: int,
        samples: int = 1,
        temperature: float = 0.7,
        seed: int = 0,
        batch_size: int = 16,
    ):
        """Reasoning sentence(s) + verdict distribution read after forced 'Verdict:'."""
        bases = [self._prompt(cot_messages(target, p)) for p in posts]
        prompts = [b + COT_PREFIX for b in bases]
        if samples <= 1:
            gens = self._generate(prompts, max_new_tokens, batch_size)
            results, verdict_prompts = [], []
            for base, ids in zip(bases, gens):
                reasoning, status = cut_reasoning(self._decode(ids))
                results.append({"reasoning": reasoning, "status": status})
                verdict_prompts.append(f"{base}{COT_PREFIX} {reasoning}\nVerdict:")
            for r, s in zip(results, self._label_scores(verdict_prompts, batch_size)):
                r["scores"] = s
            return results
        else:
            gens = self._generate_samples(prompts, max_new_tokens, samples, temperature, seed, batch_size)
            all_verdict_prompts = []
            results = []
            for base, post_gens in zip(bases, gens):
                post_results = []
                for ids in post_gens:
                    reasoning, status = cut_reasoning(self._decode(ids))
                    post_results.append({"reasoning": reasoning, "status": status})
                    all_verdict_prompts.append(f"{base}{COT_PREFIX} {reasoning}\nVerdict:")
                results.append(post_results)
            all_scores = self._label_scores(all_verdict_prompts, batch_size)
            idx = 0
            for post_results in results:
                for r in post_results:
                    r["scores"] = all_scores[idx]
                    idx += 1
            return results

    def legacy_cot(self, posts: List[str], target: str, max_new_tokens: int = 96, batch_size: int = 16) -> List[dict]:
        prompts = [
            self._prompt([
                {"role": "system", "content": LEGACY_COT_SYS},
                {"role": "user", "content": f"Target: {target}\nPost: {p}\nReasoning:"},
            ])
            for p in posts
        ]
        gens = self._generate(prompts, max_new_tokens, batch_size)
        return [
            {"text_legacy": self._decode(ids[:LEGACY_COT_TOKENS]), "text_full": self._decode(ids)}
            for ids in gens
        ]

    def rationales(self, posts: List[str], target: str, labels: List[str], max_new_tokens: int, batch_size: int = 16) -> List[Optional[str]]:
        prompts = [
            self._prompt([
                {"role": "system", "content": RATIONALE_SYS},
                {"role": "user", "content": f"{_user(target, p)}\nSentiment toward {target}: {lab}"},
            ])
            for p, lab in zip(posts, labels)
        ]
        return [clean_rationale(self._decode(ids)) for ids in self._generate(prompts, max_new_tokens, batch_size)]

    # ---- public entry points -------------------------------------------------------------

    def classify(self, texts: List[str], target: str, cfg: PipelineConfig) -> List[dict]:
        import time

        t0 = time.time()
        target = sanitize(target)
        posts = [self.clip(t, cfg.max_post_tokens) for t in texts]
        cues = [informal_cues(p, target) for p in posts]

        # Stage 1
        variants_needed = list(cfg.ensemble_members) if cfg.stage1_variant == "ensemble" else [cfg.stage1_variant]
        s1_by_variant = {}
        for v in set(variants_needed):
            s1_by_variant[v] = self.stage1_scores(posts, target, v)

        null_dict = self.null_stage1_scores(target, set(variants_needed)) if cfg.null_calibration else None

        s1_vecs = []
        m_labels_list = []
        for i in range(len(posts)):
            v_dict = {v: s1_by_variant[v][i] for v in variants_needed}
            s1_vec, m_labels = stage1_vector(v_dict, null_dict, cfg)
            s1_vecs.append(s1_vec)
            m_labels_list.append(m_labels)

        decisions = [decide(s1_vecs[i], cues[i], cfg, member_labels=m_labels_list[i]) for i in range(len(posts))]
        t1 = time.time()

        # Stage 2: CoT
        gated = [i for i, d in enumerate(decisions) if d["gated"]]
        cot_results_by_idx: Dict[int, list] = {}
        if gated:
            try:
                gated_posts = [posts[i] for i in gated]
                if cfg.cot_samples > 1:
                    cot_out = self.cot(
                        gated_posts, target, cfg.cot_max_new_tokens,
                        samples=cfg.cot_samples, temperature=cfg.cot_temperature, seed=cfg.cot_seed
                    )
                    for i, chains in zip(gated, cot_out):
                        cot_results_by_idx[i] = chains
                        decisions[i] = decide(
                            s1_vecs[i], cues[i], cfg,
                            cot_score_list=[c["scores"] for c in chains],
                            member_labels=m_labels_list[i]
                        )
                else:
                    cot_out = self.cot(gated_posts, target, cfg.cot_max_new_tokens, samples=1)
                    for i, r in zip(gated, cot_out):
                        cot_results_by_idx[i] = [r]
                        decisions[i] = decide(
                            s1_vecs[i], cues[i], cfg,
                            cot_score_list=[r["scores"]],
                            member_labels=m_labels_list[i]
                        )
            except Exception:
                log.exception("CoT stage failed; keeping stage-1 labels for %d posts", len(gated))
        t2 = time.time()

        # Stage 3: Rationales
        rationales: List[Optional[str]] = [None] * len(posts)
        need = []
        for i, d in enumerate(decisions):
            chains = cot_results_by_idx.get(i)
            found_rationale = None
            if chains:
                for c in chains:
                    if c["status"] == "ok" and LABELS[argmax(calibrate_cot(c["scores"], cfg))] == d["label"]:
                        found_rationale = clean_rationale(c["reasoning"])
                        break
            if found_rationale:
                rationales[i] = found_rationale
            else:
                need.append(i)

        if cfg.generate_rationales and need:
            try:
                gen = self.rationales([posts[i] for i in need], target, [decisions[i]["label"] for i in need], cfg.rationale_max_new_tokens)
                for i, r in zip(need, gen):
                    rationales[i] = r
            except Exception:
                log.exception("Rationale stage failed for %d posts", len(need))
        t3 = time.time()

        log.info(
            "Classified %d posts in %d ms (stage1: %d ms, cot: %d ms on %d posts, rationale: %d ms)",
            len(posts),
            int((t3 - t0) * 1000),
            int((t1 - t0) * 1000),
            int((t2 - t1) * 1000),
            len(gated),
            int((t3 - t2) * 1000),
        )

        results = []
        for i, d in enumerate(decisions):
            p = d["probs"]
            results.append({
                "label": d["label"],
                "prob_pos": round(p[POS], 4),
                "prob_neg": round(p[NEG], 4),
                "prob_neu": round(p[NEU], 4),
                "confidence": round(max(p), 4),
                "rationale": rationales[i],
                "route": d["route"],
                "cues": cues[i],
            })
        return results

    def raw_scores(
        self,
        texts: List[str],
        target: str,
        cfg: PipelineConfig,
        legacy: bool = True,
        self_consistency: int = 0,
    ) -> List[dict]:
        """Everything benchmark.py needs to replay any configuration offline.

        Runs every stage-1 variant and CoT on all posts (not just gated ones).
        """
        target = sanitize(target)
        posts = [self.clip(t, cfg.max_post_tokens) for t in texts]

        # Stage 1 for v1, v2_zero, v2
        stage1 = {v: self.stage1_scores(posts, target, v) for v in ("v1", "v2_zero", "v2")}

        # Stage 1 for two_step
        op_scores, pol_scores = self._two_step_scores_with_parts(posts, target)
        stage1["two_step"] = [two_step_scores(op, pol) for op, pol in zip(op_scores, pol_scores)]
        two_step_parts = [{"opinion": op, "polarity": pol} for op, pol in zip(op_scores, pol_scores)]

        # Null calibration for each base variant
        stage1_null = self.null_stage1_scores(target, ("v1", "v2_zero", "v2", "two_step"))

        cues = [informal_cues(p, target) for p in posts]
        cot = self.cot(posts, target, cfg.cot_max_new_tokens, samples=1)
        cot_samples = (
            self.cot(
                posts, target, cfg.cot_max_new_tokens,
                samples=self_consistency, temperature=cfg.cot_temperature, seed=cfg.cot_seed
            )
            if self_consistency > 0
            else None
        )
        leg = self.legacy_cot(posts, target, max(cfg.cot_max_new_tokens, 96)) if legacy else [None] * len(posts)

        out = []
        for i, p in enumerate(posts):
            out.append({
                "stage1": {v: stage1[v][i] for v in ("v1", "v2_zero", "v2", "two_step")},
                "stage1_null": stage1_null,
                "two_step_parts": two_step_parts[i],
                "cues": cues[i],
                "cot": cot[i],
                "cot_samples": cot_samples[i] if cot_samples is not None else None,
                "legacy_cot": leg[i],
                "clipped": p != sanitize(texts[i]),
            })
        return out
