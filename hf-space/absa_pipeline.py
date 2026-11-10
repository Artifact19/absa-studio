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
from typing import Dict, List, Optional, Sequence

log = logging.getLogger("absa_pipeline")

# Bump whenever a prompt, anchor, or raw-score format changes: benchmark caches key on it.
PIPELINE_VERSION = "hybrid-v1"

LABELS = ("positive", "negative", "neutral")
POS, NEG, NEU = 0, 1, 2


# --------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------

ALL_CUES = ("profanity", "slang", "sarcasm", "affect_emoji", "emphasis", "contrast", "defense")


@dataclass
class PipelineConfig:
    # Stage-1 prompt: "v2" (definitions + few-shot anchors), "v2_zero" (definitions only),
    # or "v1" (the original Approach A prompt).
    stage1_variant: str = "v2"
    # Stage-1 calibration: z_k = scale * score_k + bias_k (fitted by benchmark.py).
    scale: float = 1.0
    bias: Dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in LABELS})
    # Same calibration for the CoT verdict distribution (fitted separately).
    cot_scale: float = 1.0
    cot_bias: Dict[str, float] = field(default_factory=lambda: {k: 0.0 for k in LABELS})
    # Gate: send a post to CoT when top1 - top2 < gate_margin, or when it carries one of
    # gate_cues and the stage-1 label is polar.
    gate_margin: float = 0.25
    gate_cues: List[str] = field(default_factory=lambda: list(ALL_CUES))
    # Combination: CoT may not override a neutral label whose calibrated p_neu >= neutral_guard
    # (such posts are not even sent to CoT). Set above 1.0 to disable the guard.
    neutral_guard: float = 0.5
    # Whether CoT may turn a polar stage-1 label into neutral.
    cot_can_neutralize: bool = True
    # Weight of the CoT expert in the log-linear mix with stage 1 (0 = ignore CoT).
    cot_weight: float = 0.5
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


@dataclass(frozen=True)
class Anchor:
    target: str
    post: str
    label: str
    reasoning: str


# Few-shot anchors: deliberately spread across unrelated domains, and none taken from the
# benchmark. Three of seven are neutral (headline, question, countdown) to counter the
# small model's pull toward finding an emotion.
ANCHORS = (
    Anchor(
        "Beyoncé",
        "y'all can hate all you want, beyoncé's new album fucking SLAPS and i'll fight anyone "
        "who says otherwise 😭🔥",
        "positive",
        "The swearing and the threat are aimed at critics; the author loves Beyoncé's album.",
    ),
    Anchor(
        "Windows 11",
        "love how Windows 11 decided to restart for an update in the middle of my presentation. "
        "great job as always 🙃",
        "negative",
        "'Love how' and 'great job' are sarcastic; the author is annoyed that Windows 11 "
        "restarted during the presentation.",
    ),
    Anchor(
        "Galaxy S25",
        "Samsung will unveil the Galaxy S25 at its Unpacked event on January 22, according to a "
        "new report.",
        "neutral",
        "The post reports a launch date and gives no opinion of the Galaxy S25.",
    ),
    Anchor(
        "Netflix",
        "Disney+ raised prices again and their app is garbage. so glad I switched to Netflix, "
        "way better value",
        "positive",
        "The complaints target Disney+; about Netflix the author is glad and calls it better "
        "value.",
    ),
    # The two contrast anchors mirror each other (target clause first vs. second, praise vs.
    # complaint) so the model cannot learn "the clause after 'but' decides".
    Anchor(
        "Uber",
        "Uber charged me $40 for a 10 minute ride again. meanwhile my Lyft driver yesterday was "
        "amazing",
        "negative",
        "The author is upset about Uber's price; the praise is for a Lyft driver, not Uber.",
    ),
    Anchor(
        "Arsenal",
        "what time does the Arsenal game start tonight? is it on TV in the US?",
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

STAGE1_VARIANTS = ("v1", "v2_zero", "v2")


def _user(target: str, post: str) -> str:
    return f"Target: {target}\nPost: {post}"


def stage1_messages(variant: str, target: str, post: str) -> List[dict]:
    if variant == "v1":
        return [
            {"role": "system", "content": V1_SYS},
            {"role": "user", "content": f"Target: {target}\nTweet: {post}\nSentiment:"},
        ]
    if variant not in ("v2", "v2_zero"):
        raise ValueError(f"unknown stage-1 variant {variant!r}")
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


COT_PREFIX = "Reasoning:"


# --------------------------------------------------------------------------------------
# Informal-language cues (domain-agnostic lexicons)
# --------------------------------------------------------------------------------------

def _words(alternatives: Sequence[str]) -> re.Pattern:
    return re.compile(r"(?<![\w'])(?:" + "|".join(alternatives) + r")(?![\w'])", re.IGNORECASE)


_CUE_PATTERNS: Dict[str, List[re.Pattern]] = {
    "profanity": [
        _words([
            r"f+u+c+k+\w*", r"f[\*#@]+c?k?\w*", r"fk+\w*", r"fkn", r"fcking", r"phuck\w*",
            r"shit\w*", r"sh[\*#]+t\w*", r"bullshit", r"damn\w*", r"dammit", r"goddamn\w*",
            r"wtf", r"stfu", r"af", r"asf", r"bitch\w*", r"ass", r"asshole\w*", r"badass",
            r"crap\w*", r"hell", r"piss\w*", r"dick\w*", r"bastard\w*", r"mf", r"mofo",
            r"motherf\w*",
        ]),
        # Profanity glued into hashtags, e.g. #fuckday1s.
        re.compile(r"#\w*(?:fuck|shit|damn)\w*", re.IGNORECASE),
    ],
    "slang": [
        _words([
            r"lol+", r"lmao+", r"lmfao+", r"rofl", r"ngl", r"fr", r"frfr", r"tbh", r"istg",
            r"smh", r"oomfs?", r"goat(?:ed)?", r"slaps", r"slay(?:ed|ing|s)?", r"bussin",
            r"cooked", r"bruh+", r"sheesh", r"deadass", r"lowkey", r"highkey", r"no cap",
            r"on god", r"iykyk", r"rent free", r"stan(?:s|ning|ned)?", r"simp(?:ing|s)?",
            r"it'?s giving", r"unhinged",
        ]),
        # Standalone W / L ("massive W"), case-sensitive.
        re.compile(r"(?<![\w.'])[WL](?![\w.'])"),
    ],
    "sarcasm": [
        re.compile(r"(?:^|\s)/s\b", re.IGNORECASE),
        _words([
            r"yeah right", r"sure jan", r"love that for \w+", r"thanks a lot",
            r"thanks for nothing", r"what a surprise", r"big surprise", r"shocker",
            r"oh great", r"great job", r"as always", r"just what i needed", r"totally not",
            r"said no one", r"nobody asked",
        ]),
    ],
    "affect_emoji": [re.compile("[\U0001F480\U0001F62D\U0001F644\U0001F643\U0001F921\U0001F612\U0001FAE0\U0001F624\U0001F923\U0001F602]")],
    "emphasis": [
        re.compile(r"([a-z])\1{2,}", re.IGNORECASE),  # sooo, yesss
        re.compile(r"[!?]{3,}|!{2,}"),
    ],
    "contrast": [
        _words([
            r"but", r"however", r"although", r"though", r"whereas", r"unlike", r"instead",
            r"better than", r"worse than", r"vs\.?", r"versus", r"compared to",
        ]),
    ],
    "defense": [
        _words([
            r"fight (?:anyone|everyone|you|y'?all)", r"haters?", r"hate on", r"hating on",
            r"catch these hands", r"square up", r"come at", r"leave \w+ alone",
        ]),
    ],
}

_CAPS_WORD = re.compile(r"(?<![#@\w])[A-Z]{3,}(?!\w)")


def informal_cues(text: str, target: str = "") -> List[str]:
    """Return the cue categories present in a post (deterministic, order of ALL_CUES)."""
    found = set()
    for name, patterns in _CUE_PATTERNS.items():
        if any(p.search(text) for p in patterns):
            found.add(name)
    target_words = {w.upper() for w in re.findall(r"\w+", target)}
    caps = [w for w in _CAPS_WORD.findall(text) if w not in target_words]
    if len(caps) >= 2 or (caps and len(text.split()) <= 6):
        found.add("emphasis")
    return [c for c in ALL_CUES if c in found]


# --------------------------------------------------------------------------------------
# Calibration, gating, combination (pure Python; shared with benchmark.py)
# --------------------------------------------------------------------------------------

def softmax(z: Sequence[float]) -> List[float]:
    m = max(z)
    e = [math.exp(v - m) for v in z]
    s = sum(e)
    return [v / s for v in e]


def calibrate(scores: Sequence[float], cfg: PipelineConfig) -> List[float]:
    return softmax([cfg.scale * s + cfg.bias[k] for s, k in zip(scores, LABELS)])


def calibrate_cot(scores: Sequence[float], cfg: PipelineConfig) -> List[float]:
    return softmax([cfg.cot_scale * s + cfg.cot_bias[k] for s, k in zip(scores, LABELS)])


def argmax(p: Sequence[float]) -> int:
    return max(range(len(p)), key=lambda i: p[i])


def margin(p: Sequence[float]) -> float:
    top = sorted(p, reverse=True)
    return top[0] - top[1]


def needs_cot(p1: Sequence[float], cues: Sequence[str], cfg: PipelineConfig) -> bool:
    label = argmax(p1)
    if label == NEU and p1[NEU] >= cfg.neutral_guard:
        return False  # CoT would not be allowed to change it anyway
    if cfg.cot_weight <= 0:
        return False
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
    s1_scores: Sequence[float],
    cues: Sequence[str],
    cfg: PipelineConfig,
    cot_scores: Optional[Sequence[float]] = None,
) -> dict:
    """Full decision for one post. Without cot_scores, reports whether CoT is needed."""
    p1 = calibrate(s1_scores, cfg)
    gated = needs_cot(p1, cues, cfg)
    if gated and cot_scores is not None:
        final = combine(p1, calibrate_cot(cot_scores, cfg), cfg)
        route = "cot"
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
        self.label_ids = [self._label_token_ids(w) for w in LABELS]
        flat = [i for ids in self.label_ids for i in ids]
        if len(flat) != len(set(flat)):
            raise ValueError("label verbalizer tokens overlap between classes")

    # ---- low-level helpers -----------------------------------------------------------

    def _label_token_ids(self, word: str) -> List[int]:
        # Same three surface forms as the original Approach A verbalizer.
        ids = set()
        for v in (word, " " + word, word.capitalize()):
            ids.add(self.tok.encode(v, add_special_tokens=False)[0])
        return sorted(ids)

    def _prompt(self, messages: List[dict], prefix: str = "") -> str:
        return self.tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True) + prefix

    def clip(self, text: str, max_tokens: int) -> str:
        text = sanitize(text)
        ids = self.tok.encode(text, add_special_tokens=False)
        if len(ids) <= max_tokens:
            return text
        head = self.tok.decode(ids[:max_tokens], skip_special_tokens=True).replace("�", "")
        return head.rstrip() + " …"

    def _encode(self, prompts: List[str]):
        enc = self.tok(prompts, return_tensors="pt", padding=True, add_special_tokens=False)
        return {k: v.to(self.model.device) for k, v in enc.items()}

    def _label_scores(self, prompts: List[str], batch_size: int = 16) -> List[List[float]]:
        """Per prompt: logsumexp of next-token logits over each class's verbalizer tokens."""
        import torch

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
                scores = torch.stack([torch.logsumexp(logits[:, ids], dim=-1) for ids in self.label_ids], dim=-1)
            out.extend(scores.cpu().tolist())
        return out

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

    def _decode(self, ids: List[int]) -> str:
        return self.tok.decode(ids, skip_special_tokens=True)

    # ---- stages ------------------------------------------------------------------------

    def stage1_scores(self, posts: List[str], target: str, variant: str = "v2", batch_size: int = 16) -> List[List[float]]:
        prompts = [self._prompt(stage1_messages(variant, target, p)) for p in posts]
        return self._label_scores(prompts, batch_size)

    def cot(self, posts: List[str], target: str, max_new_tokens: int, batch_size: int = 16) -> List[dict]:
        """Reasoning sentence + verdict distribution read after a forced 'Verdict:'."""
        bases = [self._prompt(cot_messages(target, p)) for p in posts]
        gens = self._generate([b + COT_PREFIX for b in bases], max_new_tokens, batch_size)
        results, verdict_prompts = [], []
        for base, ids in zip(bases, gens):
            reasoning, status = cut_reasoning(self._decode(ids))
            results.append({"reasoning": reasoning, "status": status})
            verdict_prompts.append(f"{base}{COT_PREFIX} {reasoning}\nVerdict:")
        for r, s in zip(results, self._label_scores(verdict_prompts, batch_size)):
            r["scores"] = s
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
        target = sanitize(target)
        posts = [self.clip(t, cfg.max_post_tokens) for t in texts]
        cues = [informal_cues(p, target) for p in posts]
        s1 = self.stage1_scores(posts, target, cfg.stage1_variant)
        decisions = [decide(s, c, cfg) for s, c in zip(s1, cues)]

        gated = [i for i, d in enumerate(decisions) if d["gated"]]
        cot_by_idx: Dict[int, dict] = {}
        if gated:
            try:
                cot_out = self.cot([posts[i] for i in gated], target, cfg.cot_max_new_tokens)
                for i, r in zip(gated, cot_out):
                    cot_by_idx[i] = r
                    decisions[i] = decide(s1[i], cues[i], cfg, r["scores"])
            except Exception:  # degrade to stage-1 labels rather than failing the batch
                log.exception("CoT stage failed; keeping stage-1 labels for %d posts", len(gated))

        rationales: List[Optional[str]] = [None] * len(posts)
        need = []
        for i, d in enumerate(decisions):
            r = cot_by_idx.get(i)
            if r and r["status"] == "ok" and LABELS[argmax(calibrate_cot(r["scores"], cfg))] == d["label"]:
                rationales[i] = clean_rationale(r["reasoning"])
            else:
                need.append(i)
        if cfg.generate_rationales and need:
            try:
                gen = self.rationales([posts[i] for i in need], target, [decisions[i]["label"] for i in need], cfg.rationale_max_new_tokens)
                for i, r in zip(need, gen):
                    rationales[i] = r
            except Exception:
                log.exception("Rationale stage failed for %d posts", len(need))

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

    def raw_scores(self, texts: List[str], target: str, cfg: PipelineConfig, legacy: bool = True) -> List[dict]:
        """Everything benchmark.py needs to replay any configuration offline.

        Runs every stage-1 variant and the CoT on *all* posts (not just gated ones).
        """
        target = sanitize(target)
        posts = [self.clip(t, cfg.max_post_tokens) for t in texts]
        stage1 = {v: self.stage1_scores(posts, target, v) for v in STAGE1_VARIANTS}
        cot = self.cot(posts, target, cfg.cot_max_new_tokens)
        leg = self.legacy_cot(posts, target, max(cfg.cot_max_new_tokens, 96)) if legacy else [None] * len(posts)
        out = []
        for i, p in enumerate(posts):
            out.append({
                "stage1": {v: stage1[v][i] for v in STAGE1_VARIANTS},
                "cues": informal_cues(p, target),
                "cot": cot[i],
                "legacy_cot": leg[i],
                "clipped": p != sanitize(texts[i]),
            })
        return out
