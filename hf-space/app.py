import os
os.environ["GRADIO_SSR_MODE"] = "false"
import json
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

# Label verbalizer constants
LABELS = ["positive", "negative", "neutral"]

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

class ClassifyResp(BaseModel):
    results: List[ClassifyItem]

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

COT_SYS = (
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

@spaces.GPU(duration=60)
def _classify(texts: List[str], target: str) -> List[dict]:
    prompts = [chat(COT_SYS, f"Target: {target}\nPost: {t}\nReasoning:") for t in texts]
    enc = tok(prompts, return_tensors="pt", padding=True, truncation=True, max_length=512).to(model.device)
    
    with torch.no_grad():
        out_ids = model.generate(
            **enc,
            max_new_tokens=45,
            do_sample=False,
            pad_token_id=tok.pad_token_id,
        )

    results = []
    input_len = enc["input_ids"].shape[1]

    for i in range(len(texts)):
        gen_tokens = out_ids[i][input_len:]
        gen_text = tok.decode(gen_tokens, skip_special_tokens=True).strip()

        reasoning = ""
        verdict = "neutral"

        if "Verdict:" in gen_text:
            parts = gen_text.split("Verdict:", 1)
            reasoning = parts[0].replace("Reasoning:", "").strip()
            v_raw = parts[1].strip().lower()
        else:
            reasoning = gen_text
            v_raw = gen_text.lower()

        if "positive" in v_raw:
            verdict = "positive"
            prob_pos, prob_neg, prob_neu = 0.92, 0.04, 0.04
            conf = 0.92
        elif "negative" in v_raw:
            verdict = "negative"
            prob_pos, prob_neg, prob_neu = 0.04, 0.92, 0.04
            conf = 0.92
        else:
            verdict = "neutral"
            prob_pos, prob_neg, prob_neu = 0.10, 0.10, 0.80
            conf = 0.80

        results.append({
            "label": verdict,
            "prob_pos": prob_pos,
            "prob_neg": prob_neg,
            "prob_neu": prob_neu,
            "confidence": conf,
            "rationale": reasoning or None,
        })
    return results

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
    return {"ok": True, "model": MODEL_ID}

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

INSIGHT_SYS = """You write executive sentiment briefs for busy readers. Output EXACTLY this markdown, nothing else:

## ⚡ 10-Second Verdict
**One crisp sentence, exactly 15 words, summarizing the prevailing public consensus across X and Reddit without using any angle brackets.**

## 🟢 The Exciting
- **[Two Word Theme]** One crisp sentence.
- **[Two Word Theme]** One crisp sentence.

## 🔴 The Frustrating
- **[Two Word Theme]** One crisp sentence.
- **[Two Word Theme]** One crisp sentence.

## 🎯 The Bottom Line
One single actionable sentence.

Rules: use only the provided evidence from X and Reddit; synthesize across both communities; never invent facts; never output angle brackets < or >."""

def _synth_prompt(r: SynthReq) -> str:
    pos = "\n".join(f"- ({e.confidence:.2f}) {e.text[:240]}" for e in r.top_positive)
    neg = "\n".join(f"- ({e.confidence:.2f}) {e.text[:240]}" for e in r.top_negative)
    user = (
        f"Target: {r.target}\nPosts analyzed: {r.n_total}\n"
        f"Positive {r.pct_pos:.0f}% | Negative {r.pct_neg:.0f}% | Neutral {r.pct_neu:.0f}%\n\n"
        f"<positive_evidence>\n{pos}\n</positive_evidence>\n\n<negative_evidence>\n{neg}\n</negative_evidence>"
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
    return f"Verdict: {res['label'].capitalize()} (Confidence: {res['confidence']:.0%}){rationale}"

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
