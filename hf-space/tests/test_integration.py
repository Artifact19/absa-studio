import os
import sys
import io
import json
import pytest
import numpy as np

os.environ["MODEL_ID"] = "Qwen/Qwen2.5-0.5B-Instruct"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["API_SECRET"] = "test-secret-key-123"

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import absa_pipeline as ap
import app as hf_app
import benchmark as bm
from fastapi.testclient import TestClient


def test_engine_smoke_05b_all_flags():
    model = hf_app.model
    tok = hf_app.tok
    engine = ap.AbsaEngine(model, tok)

    cfg = ap.PipelineConfig(
        stage1_variant="ensemble",
        ensemble_members=["v1", "v2_zero", "two_step"],
        null_calibration=True,
        gate_on_disagreement=True,
        cot_samples=3,
        cot_weight=0.5,
        gate_margin=0.5,
        gate_cues=list(ap.ALL_CUES),
    )

    texts = [
        "GTA 6 is looking absolutely insane! Can't wait for the release.",
        "GTA 6 is delayed again, this is so frustrating.",
        "Rockstar announced GTA 6 will release in Fall 2025.",
    ]
    target = "GTA 6"

    # classify() with all flags
    results = engine.classify(texts, target, cfg)
    assert len(results) == 3
    for r in results:
        probs = [r["prob_pos"], r["prob_neg"], r["prob_neu"]]
        assert math_sum_close(sum(probs), 1.0, 0.01)
        assert r["label"] in ap.LABELS
        assert r["route"] in ("logit", "cot")

    # Batched vs single-post stage1 scores match within fp16 noise
    s1_batched = engine.stage1_scores(texts, target, "v1", batch_size=8)
    s1_single = [engine.stage1_scores([t], target, "v1", batch_size=1)[0] for t in texts]
    assert np.allclose(s1_batched, s1_single, atol=0.05)

    # raw_scores() with self_consistency=3
    raws = engine.raw_scores(texts, target, cfg, legacy=True, self_consistency=3)
    assert len(raws) == 3
    for r in raws:
        assert set(r["stage1"].keys()) >= {"v1", "v2_zero", "v2", "two_step"}
        assert set(r["stage1_null"].keys()) >= {"v1", "v2_zero", "v2", "two_step"}
        assert "opinion" in r["two_step_parts"] and "polarity" in r["two_step_parts"]
        assert len(r["cot_samples"]) == 3
        assert r["cot"]["status"] in ("ok", "truncated", "empty")
        assert len(r["cot"]["scores"]) == 3


def test_app_integration():
    client = TestClient(hf_app.api)

    # /health reports hybrid-v2
    h = client.get("/health").json()
    assert h["ok"] is True
    assert h["pipeline"] == "hybrid-v2"

    # missing key -> 401
    resp_no_auth = client.post("/classify-batch", json={"texts": ["hello"], "target": "test"})
    assert resp_no_auth.status_code == 401

    headers = {"X-API-Key": "test-secret-key-123"}

    # /classify-batch schema
    resp = client.post("/classify-batch", json={"texts": ["hello world"], "target": "test"}, headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert len(data["results"]) == 1
    item = data["results"][0]
    for key in ("label", "prob_pos", "prob_neg", "prob_neu", "confidence", "rationale", "route", "cues"):
        assert key in item

    # /eval/raw-scores with self_consistency=2
    resp_raw = client.post(
        "/eval/raw-scores",
        json={"texts": ["cool game"], "target": "game", "self_consistency": 2},
        headers=headers,
    )
    assert resp_raw.status_code == 200
    raw_data = resp_raw.json()
    assert raw_data["pipeline_version"] == "hybrid-v2"
    assert len(raw_data["results"]) == 1
    assert len(raw_data["results"][0]["cot_samples"]) == 2

    # more than 16 posts -> 422
    too_many = client.post(
        "/eval/raw-scores",
        json={"texts": [f"post {i}" for i in range(17)], "target": "test"},
        headers=headers,
    )
    assert too_many.status_code == 422


def test_remote_backend_benchmark_mock(monkeypatch):
    client = TestClient(hf_app.api)

    class MockHTTPResponse:
        def __init__(self, content):
            self._content = content
        def read(self):
            return self._content
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass

    def mock_urlopen(req, timeout=600):
        body = json.loads(req.data.decode())
        headers = {k: v for k, v in req.headers.items()}
        resp = client.post("/eval/raw-scores", json=body, headers=headers)
        if resp.status_code != 200:
            import urllib.error
            raise urllib.error.HTTPError(req.full_url, resp.status_code, resp.text, resp.headers, None)
        return MockHTTPResponse(resp.content)

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    out_dir = "scratch/test_remote_benchmark"
    os.makedirs(out_dir, exist_ok=True)
    bm.main([
        "--data", "data/gta6_annotated.csv",
        "--backend", "remote",
        "--url", "http://testserver",
        "--key", "test-secret-key-123",
        "--limit", "20",
        "--folds", "2",
        "--out", out_dir,
    ])
    assert os.path.exists(os.path.join(out_dir, "predictions.csv"))
    assert os.path.exists(os.path.join(out_dir, "results.json"))


def math_sum_close(val, target, tol):
    return abs(val - target) <= tol

