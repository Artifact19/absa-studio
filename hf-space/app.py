import os
os.environ["GRADIO_SSR_MODE"] = "false"
import logging
import threading
import re
import hmac
from typing import List, Optional

try:
    import spaces  # MUST be imported before torch/CUDA use on ZeroGPU
except ImportError:
    class _MockSpaces:
        def GPU(self, duration=60):
            def decorator(f):
                return f
            return decorator
    spaces = _MockSpaces()

import torch
import gradio as gr
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

import absa_pipeline as ap

logging.basicConfig(level=logging.INFO)

MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen2.5-3B-Instruct")
API_SECRET = os.environ.get("API_SECRET", "")
USE_GPU = torch.cuda.is_available() or bool(os.environ.get("SPACES_ZERO_GPU"))

tok = AutoTokenizer.from_pretrained(MODEL_ID, padding_side="left")
if tok.pad_token is None:
    tok.pad_token = tok.eos_token

# On ZeroGPU, loading to "cuda" at import time is the supported pattern.
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    dtype=torch.float16 if USE_GPU else torch.float32,
    device_map="cuda" if USE_GPU else None,
)
if USE_GPU and not hasattr(model, "hf_device_map"):
    model.to("cuda")
model.eval()

# Hybrid classifier: calibrated logit verbalizer -> gated CoT -> label-conditioned rationale.
ENGINE = ap.AbsaEngine(model, tok)
CONFIG_PATH = os.environ.get("PIPELINE_CONFIG", os.path.join(os.path.dirname(os.path.abspath(__file__)), "pipeline_config.json"))
CONFIG = ap.PipelineConfig.load(CONFIG_PATH)

def verify(x_api_key: Optional[str] = Header(None)):
    if API_SECRET:
        if not x_api_key or not hmac.compare_digest(x_api_key, API_SECRET):
            raise HTTPException(status_code=401, detail="Unauthorized")

def chat(system: str, user: str) -> str:
    return tok.apply_chat_template(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        tokenize=False,
        add_generation_prompt=True,
    )

# ---------- Schemas ----------
class ExtractReq(BaseModel):
    text: str = Field(..., max_length=2000)

class ExtractResp(BaseModel):
    entity: str
    tier: int  # 1 = rule-based, 2 = LLM

class ClassifyReq(BaseModel):
    texts: List[str] = Field(..., max_length=32)
    target: str

class ClassifyItem(BaseModel):
    label: str
    prob_pos: float
    prob_neg: float
    prob_neu: float
    confidence: float
    rationale: Optional[str] = None
    route: Optional[str] = None  # "logit" (stage 1 only) or "cot" (gated to chain-of-thought)
    cues: List[str] = []

class ClassifyResp(BaseModel):
    results: List[ClassifyItem]

class RawReq(BaseModel):
    texts: List[str] = Field(..., max_length=16)
    target: str
    self_consistency: int = Field(0, ge=0, le=8)

class Evidence(BaseModel):
    user: str
    text: str
    confidence: float
    rationale: Optional[str] = None

class SynthReq(BaseModel):
    target: str
    n_total: int
    pct_pos: float
    pct_neg: float
    pct_neu: float
    top_positive: List[Evidence] = Field(..., max_length=10)
    top_negative: List[Evidence] = Field(..., max_length=10)

# ---------- GPU functions ----------
@spaces.GPU(duration=60)
def _extract_llm(text: str) -> str:
    prompt = chat(
        "You extract the single main product, brand, person, or topic a search query is about. "
        "Reply with ONLY the entity name, 1-4 words, no punctuation.",
        text,
    )
    inp = tok(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(**inp, max_new_tokens=12, do_sample=False)
    ent = tok.decode(out[0][inp["input_ids"].shape[1]:], skip_special_tokens=True)
    return ent.strip().strip('."\'')

@spaces.GPU(duration=60)
def _classify(texts: List[str], target: str) -> List[dict]:
    return ENGINE.classify(texts, target, CONFIG)

@spaces.GPU(duration=120)
def _raw_scores(texts: List[str], target: str, self_consistency: int = 0) -> List[dict]:
    return ENGINE.raw_scores(texts, target, CONFIG, self_consistency=self_consistency)

@spaces.GPU(duration=90)
def _synth_stream(prompt: str):
    inp = tok(prompt, return_tensors="pt").to(model.device)
    streamer = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=True)
    kw = dict(**inp, streamer=streamer, max_new_tokens=350, do_sample=True, temperature=0.4, top_p=0.9)
    th = threading.Thread(target=model.generate, kwargs=kw)
    th.start()
    for piece in streamer:
        yield piece
    th.join()

# ---------- Tier-1 rule extraction ----------
_RE = re.compile(r"(?:#|@|\$)([A-Za-z0-9_]{2,30})")
def _tier1(text: str) -> Optional[str]:
    t = text.strip()
    if 0 < len(t.split()) <= 3 and len(t) <= 40:
        return t  # short query IS the entity
    m = _RE.search(t)
    return m.group(1) if m else None

# ---------- FastAPI ----------
api = FastAPI(title="ABSA Inference", version="1.0.0")

@api.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "pipeline": ap.PIPELINE_VERSION}

@api.post("/extract-target", response_model=ExtractResp, dependencies=[Depends(verify)])
def extract_target(req: ExtractReq):
    t1 = _tier1(req.text)
    if t1:
        return ExtractResp(entity=t1, tier=1)
    return ExtractResp(entity=_extract_llm(req.text) or req.text[:40], tier=2)

@api.post("/classify-batch", response_model=ClassifyResp, dependencies=[Depends(verify)])
def classify_batch(req: ClassifyReq):
    if not req.texts:
        return ClassifyResp(results=[])
    items = _classify(req.texts, req.target)
    out = [ClassifyItem(**item) for item in items]
    return ClassifyResp(results=out)

@api.post("/eval/raw-scores", dependencies=[Depends(verify)])
def eval_raw_scores(req: RawReq):
    """Benchmark support: every stage-1 variant plus CoT on all posts (see benchmark.py)."""
    results = _raw_scores(req.texts, req.target, req.self_consistency) if req.texts else []
    return {"pipeline_version": ap.PIPELINE_VERSION, "model": MODEL_ID, "results": results}

INSIGHT_SYS = """You write executive sentiment briefs for busy readers. Output EXACTLY this markdown, nothing else:

## ⚡ 10-Second Verdict
**One crisp sentence, exactly 15 words, summarizing the prevailing public consensus across X and Reddit. Always state the real TARGET name explicitly; never use placeholder words like 'NAME' or '<NAME>', and never output angle brackets < or >.**

## 🟢 The Exciting
- **[Two Word Theme]** One crisp sentence.
- **[Two Word Theme]** One crisp sentence.

## 🔴 The Frustrating
- **[Two Word Theme]** One crisp sentence.
- **[Two Word Theme]** One crisp sentence.

## 🎯 The Bottom Line
One single actionable sentence.

Rules: use only the provided evidence from X and Reddit; always name the target; synthesize across both communities; never invent facts; never output angle brackets < or >."""

def _synth_prompt(r: SynthReq) -> str:
    pos = "\n".join(f"- ({e.confidence:.2f}) {e.text[:240]}" for e in r.top_positive)
    neg = "\n".join(f"- ({e.confidence:.2f}) {e.text[:240]}" for e in r.top_negative)
    user = (
        f"Target: {r.target}\nPosts analyzed: {r.n_total}\n"
        f"Positive {r.pct_pos:.0f}% | Negative {r.pct_neg:.0f}% | Neutral {r.pct_neu:.0f}%\n\n"
        f"--- POSITIVE POSTS ---\n{pos}\n\n--- NEGATIVE POSTS ---\n{neg}"
    )
    return chat(INSIGHT_SYS, user)

@api.post("/synthesize-insights", dependencies=[Depends(verify)])
def synthesize(req: SynthReq):
    prompt = _synth_prompt(req)
    return StreamingResponse(_synth_stream(prompt), media_type="text/plain; charset=utf-8")

# Minimal Gradio UI required by the Gradio SDK / ZeroGPU runtime.
@spaces.GPU(duration=60)
def demo_classify(text: str, target: str):
    if not text or not target:
        return "Please provide both text and target."
    res = _classify([text], target)[0]
    rationale = f"\nReasoning: {res['rationale']}" if res.get("rationale") else ""
    route = "chain-of-thought" if res.get("route") == "cot" else "logit verbalizer"
    return f"Verdict: {res['label'].capitalize()} (Confidence: {res['confidence']:.0%}, via {route}){rationale}"

with gr.Blocks(title="ABSA Studio Inference") as demo:
    gr.Markdown("# Target-Oriented ABSA Studio Inference API\nFastAPI REST endpoints available at `/docs`.")
    with gr.Row():
        d_text = gr.Textbox(label="Sample Post", value="The battery on iPhone 17 is incredible!")
        d_target = gr.Textbox(label="Target Entity", value="iPhone 17")
    d_out = gr.Textbox(label="ZeroGPU Sentiment Output")
    d_btn = gr.Button("Analyze Sentiment with ZeroGPU", variant="primary")
    d_btn.click(fn=demo_classify, inputs=[d_text, d_target], outputs=d_out)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    demo.launch(
        server_name="0.0.0.0",
        server_port=port,
        prevent_thread_lock=True,
        ssr_mode=False,
    )
    demo.app.include_router(api.router)
    demo.block_thread()
