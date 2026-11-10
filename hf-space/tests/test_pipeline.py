import math
import os
import sys
import numpy as np
import pytest
from scipy.stats import binomtest
from sklearn.metrics import cohen_kappa_score, f1_score

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import absa_pipeline as ap
import benchmark as bm


def test_metrics_vs_sklearn():
    gold = ["positive", "negative", "neutral", "positive", "neutral", "negative", "positive", "neutral"] * 5
    pred = ["positive", "neutral", "neutral", "negative", "neutral", "negative", "positive", "positive"] * 5

    m = bm.metrics(gold, pred)

    k_unw = cohen_kappa_score(gold, pred)
    k_lin = cohen_kappa_score(gold, pred, weights="linear")
    k_quad = cohen_kappa_score(gold, pred, weights="quadratic")
    f1_m = f1_score(gold, pred, average="macro", labels=list(bm.ORDER))

    assert math.isclose(m["kappa"], k_unw, abs_tol=1e-5)
    assert math.isclose(m["kappa_w"], k_lin, abs_tol=1e-5)
    assert math.isclose(m["kappa_qw"], k_quad, abs_tol=1e-5)
    assert math.isclose(m["macro_f1"], f1_m, abs_tol=1e-5)


def test_mcnemar_vs_scipy():
    gold = ["positive"] * 10 + ["negative"] * 10 + ["neutral"] * 10
    a = ["positive"] * 8 + ["neutral"] * 2 + ["negative"] * 6 + ["positive"] * 4 + ["neutral"] * 7 + ["negative"] * 3
    b = ["positive"] * 6 + ["neutral"] * 4 + ["negative"] * 8 + ["positive"] * 2 + ["neutral"] * 9 + ["negative"] * 1

    p, ab, ba = bm.mcnemar_exact(gold, a, b)
    n = ab + ba
    if n > 0:
        expected_p = binomtest(min(ab, ba), n, 0.5).pvalue
        assert math.isclose(p, expected_p, abs_tol=1e-5)


def test_fit_calibration_recovers_known_parameters():
    rng = np.random.default_rng(42)
    N = 600
    true_scale = 1.6
    true_bias = {"positive": 0.0, "negative": -0.7, "neutral": 0.5}

    S = rng.normal(0, 1.5, size=(N, 3))
    Z = true_scale * (S - S.mean(axis=1, keepdims=True)) + np.array([0.0, true_bias["negative"], true_bias["neutral"]])
    P = np.exp(Z - Z.max(axis=1, keepdims=True))
    P /= P.sum(axis=1, keepdims=True)

    y = np.array([rng.choice(3, p=P[i]) for i in range(N)])

    fit_scale, fit_bias = bm.fit_calibration(S, y, l2=0.01)

    assert abs(fit_scale - true_scale) < 0.35
    assert abs(fit_bias["negative"] - true_bias["negative"]) < 0.35
    assert abs(fit_bias["neutral"] - true_bias["neutral"]) < 0.35


def test_two_step_scores_math():
    # Test probabilities sum to 1.0 for arbitrary inputs
    for op in [(-2.0, 3.0), (1.5, -0.5), (0.0, 0.0), (-10.0, 10.0)]:
        for pol in [(1.0, -1.0), (-3.0, 2.0), (0.0, 0.0)]:
            scores = ap.two_step_scores(op, pol)
            # scores are log-probs: exp(s) must sum to 1.0
            probs = [math.exp(s) for s in scores]
            assert math.isclose(sum(probs), 1.0, abs_tol=1e-6)

    # If author has NO opinion (opinion = [0, 100]), neutral prob should be ~1.0
    no_op = ap.two_step_scores((-100.0, 100.0), (0.0, 0.0))
    assert math.isclose(math.exp(no_op[2]), 1.0, abs_tol=1e-5)

    # If author has positive opinion (opinion = [100, -100], polarity = [100, -100]), pos prob ~ 1.0
    pos_op = ap.two_step_scores((100.0, -100.0), (100.0, -100.0))
    assert math.isclose(math.exp(pos_op[0]), 1.0, abs_tol=1e-5)


def test_null_calibration_math():
    raw_scores = {"v1": [2.0, 0.0, 1.0]}
    null_scores = {"v1": [0.5, -0.5, 0.0]}

    # Off: raw scores returned
    cfg_off = ap.PipelineConfig(stage1_variant="v1", null_calibration=False)
    vec_off, _ = ap.stage1_vector(raw_scores, null_scores, cfg_off)
    assert vec_off == [2.0, 0.0, 1.0]

    # On: log_softmax(raw) - null
    cfg_on = ap.PipelineConfig(stage1_variant="v1", null_calibration=True)
    vec_on, _ = ap.stage1_vector(raw_scores, null_scores, cfg_on)
    expected = [a - b for a, b in zip(ap.log_softmax(raw_scores["v1"]), null_scores["v1"])]
    assert np.allclose(vec_on, expected)


def test_fast_replay_equals_decide():
    rng = np.random.default_rng(123)
    N = 100

    configs = [
        ap.PipelineConfig(cot_weight=0.0, gate_margin=0.0),
        ap.PipelineConfig(cot_weight=0.5, gate_margin=0.25, neutral_guard=0.5, cot_can_neutralize=True),
        ap.PipelineConfig(cot_weight=0.35, gate_margin=0.15, neutral_guard=0.6, cot_can_neutralize=False),
        ap.PipelineConfig(cot_weight=0.85, gate_margin=0.5, gate_cues=list(ap.ALL_CUES)),
        ap.PipelineConfig(cot_weight=0.5, gate_on_disagreement=True, gate_margin=0.0),
    ]

    for cfg in configs:
        P1 = rng.dirichlet((1, 1, 1), size=N)
        PC = rng.dirichlet((1, 1, 1), size=N)
        cues_list = [["profanity"] if rng.random() > 0.5 else [] for _ in range(N)]
        has_cue = np.array([any(c in cfg.gate_cues for c in cues) for cues in cues_list], dtype=bool)
        disagree = rng.choice([False, True], size=N)
        member_labels = [["positive", "negative"] if d else ["positive", "positive"] for d in disagree]

        # Vector fast_replay
        vec_preds, vec_gated = bm.fast_replay(P1, PC, has_cue, disagree, cfg)

        # Pure decide
        for i in range(N):
            # Construct unnormalized logit inputs that softmax to P1[i] and PC[i]
            s1_log = np.log(P1[i])
            cot_log = np.log(PC[i])
            # Set cfg.scale=1.0 and bias=0 for identity calibration in decide()
            c_test = ap.PipelineConfig(
                scale=1.0, bias={"positive": 0.0, "negative": 0.0, "neutral": 0.0},
                cot_scale=1.0, cot_bias={"positive": 0.0, "negative": 0.0, "neutral": 0.0},
                cot_weight=cfg.cot_weight, gate_margin=cfg.gate_margin,
                neutral_guard=cfg.neutral_guard, cot_can_neutralize=cfg.cot_can_neutralize,
                gate_cues=cfg.gate_cues, gate_on_disagreement=cfg.gate_on_disagreement,
            )
            d = ap.decide(s1_log, cues_list[i], c_test, cot_score_list=[cot_log], member_labels=member_labels[i])
            pred_idx = ap.LABELS.index(d["label"])
            assert pred_idx == vec_preds[i], f"Mismatch at {i}: decide={d['label']} vs fast={ap.LABELS[vec_preds[i]]}"
            assert d["gated"] == bool(vec_gated[i]), f"Gating mismatch at {i}"


def test_parsing_and_reasoning_helpers():
    # strict_parse
    assert ap.strict_parse("Reasoning: good.\nVerdict: positive") == "positive"
    assert ap.strict_parse("Reasoning: bad.\n**Verdict:** Negative") == "negative"
    assert ap.strict_parse("Reasoning: plain.\nVerdict: neutral") == "neutral"
    assert ap.strict_parse("Reasoning: unfinished without tag") is None

    # legacy_parse
    assert ap.legacy_parse("Verdict: positive") == "positive"
    assert ap.legacy_parse("The target is positive and great.") == "positive"
    assert ap.legacy_parse("This is negative and bad.") == "negative"
    assert ap.legacy_parse("No opinion here.") == "neutral"

    # cut_reasoning
    r1, st1 = ap.cut_reasoning("Reasoning: Author loves GTA 6.\nVerdict: positive")
    assert r1 == "Author loves GTA 6."
    assert st1 == "ok"

    r2, st2 = ap.cut_reasoning("Reasoning: Incomplete text without")
    assert r2 == "Incomplete text without"
    assert st2 == "truncated"

    r3, st3 = ap.cut_reasoning("")
    assert r3 == ""
    assert st3 == "empty"


def test_shipped_config_is_a_equivalent():
    # Test default PipelineConfig is A-equivalent baseline
    cfg = ap.PipelineConfig()
    assert cfg.stage1_variant == "v1"
    assert cfg.scale == 1.0
    assert all(v == 0.0 for v in cfg.bias.values())
    assert cfg.cot_weight <= 0.0
    assert cfg.gate_margin == 0.0

    # Also verify the persisted pipeline_config.json loads cleanly
    cfg_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "pipeline_config.json"))
    loaded = ap.PipelineConfig.load(cfg_path)
    assert loaded.stage1_variant in ("v1", "v2_zero")

    # For random inputs, decide must never gate and must return v1 argmax
    rng = np.random.default_rng(99)
    for _ in range(50):
        scores = rng.normal(0, 2, size=3)
        d = ap.decide(scores, ["profanity", "slang"], cfg, cot_score_list=[[1.0, 0.0, 0.0]])
        assert not d["gated"]
        assert d["route"] == "logit"
        assert d["label"] == ap.LABELS[int(np.argmax(scores))]

