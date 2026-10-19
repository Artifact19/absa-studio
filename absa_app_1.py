import html
import os
import re
import threading
import time
import warnings
from collections import Counter

import numpy as np
import pandas as pd
import requests
import streamlit as st
import torch
import torch.nn.functional as F
from supabase import Client, create_client
from transformers import (
    BitsAndBytesConfig,
    GenerationConfig,
    TextIteratorStreamer,
    pipeline,
)


# SUPPRESSING WARNINGS
# Ignore non-critical quantization and transformer runtime warnings for a clean UI
warnings.filterwarnings("ignore", message=".*MatMul8bitLt.*")
warnings.filterwarnings("ignore")


# CONFIGURATION & CLOUD DATABASE INITIALIZATION
# Define external API endpoints, Hugging Face model identifiers, and database table name
FETCHLAYER_API_URL = "https://api.fetchlayer.dev/twitter/search"
QWEN_MODEL_ID = "Qwen/Qwen2.5-3B-Instruct"
SUPABASE_TABLE = "absa_tweets"

# Configure Streamlit page metadata and layout properties
st.set_page_config(
    page_title="Target-Oriented ABSA Studio",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="expanded",
)


# CUSTOM CSS STYLING
# Inject custom CSS styles for sentiment metric cards, polarity tweet cards, and confidence badges
st.markdown(
    """
    <style>
    .metric-card {
        background-color: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
    }
    .tweet-card-pos {
        background-color: rgba(16, 185, 129, 0.08);
        border-left: 4px solid #10b981;
        border-radius: 8px;
        padding: 14px;
        margin-bottom: 12px;
    }
    .tweet-card-neg {
        background-color: rgba(239, 68, 68, 0.08);
        border-left: 4px solid #ef4444;
        border-radius: 8px;
        padding: 14px;
        margin-bottom: 12px;
    }
    .conf-badge-pos {
        background-color: #065f46;
        color: #ecfdf5;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.78rem;
        font-weight: 600;
    }
    .conf-badge-neg {
        background-color: #7f1d1d;
        color: #fef2f2;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.78rem;
        font-weight: 600;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


# CACHED MODEL & DATABASE LOADERS
# Initialize and cache the Supabase client using credentials stored in Streamlit secrets
@st.cache_resource(show_spinner="Connecting to Supabase Cloud Database...")
def init_supabase_client() -> Client:
    supabase_url = st.secrets.get("SUPABASE_URL", os.environ.get("SUPABASE_URL", ""))
    supabase_key = st.secrets.get("SUPABASE_KEY", os.environ.get("SUPABASE_KEY", ""))
    if not supabase_url or not supabase_key:
        st.error(
            "Supabase credentials missing! Please set `SUPABASE_URL` and `SUPABASE_KEY` "
            "inside `.streamlit/secrets.toml` or Streamlit Cloud Secrets."
        )
        st.stop()
    return create_client(supabase_url, supabase_key)


# Load and cache Qwen 2.5-3B-Instruct with 8-bit quantization on GPU (or FP32 fallback on CPU)
@st.cache_resource(show_spinner="Loading Qwen 2.5-3B-Instruct...")
def load_qwen_pipeline():
    if torch.cuda.is_available():
        bnb_config = BitsAndBytesConfig(load_in_8bit=True,
                                        llm_int8_enable_fp32_cpu_offload=True,
                                       )
        model_kwargs = {
            "quantization_config": bnb_config,
            "torch_dtype": torch.float16,
        }
        device_map = "auto"
    else:
        model_kwargs = {"dtype": torch.float32}
        device_map = None

    pipe = pipeline(
        "text-generation",
        model=QWEN_MODEL_ID,
        model_kwargs=model_kwargs,
        device_map=device_map,
    )
    pipe.tokenizer.padding_side = "left"
    if pipe.tokenizer.pad_token_id is None:
        pipe.tokenizer.pad_token_id = pipe.tokenizer.eos_token_id
    pipe.tokenizer.clean_up_tokenization_spaces = False

    # Clear default sampling parameters to guarantee deterministic inference outputs
    pipe.model.generation_config.temperature = None
    pipe.model.generation_config.top_p = None
    pipe.model.generation_config.top_k = None
    pipe.model.generation_config.max_length = None
    pipe.model.generation_config.do_sample = False
    pipe.model.generation_config.pad_token_id = pipe.tokenizer.pad_token_id
    pipe.model.generation_config.eos_token_id = pipe.tokenizer.eos_token_id

    # Precompute token IDs for the three sentiment verbalizer labels
    candidate_words = ["positive", "negative", "neutral"]
    candidate_ids = [
        pipe.tokenizer.encode(w, add_special_tokens=False)[0]
        for w in candidate_words
    ]
    return pipe, candidate_words, candidate_ids


# TOPIC EXTRACTION & NORMALIZATION UTILITIES
# Extract the core target entity from natural language input using a 2-tier Qwen 2.5-3B pipeline
def extract_target_from_input(user_input: str, qwen_pipe) -> str:
    cleaned_input = user_input.strip()
    stripped_entity = cleaned_input.strip(" ?!.,;:'\"")
    words = stripped_entity.split()

    # Tier 1: Zero-latency short-circuit if the user typed a direct 1-3 word entity name
    conversational_tokens = {
        "what", "how", "why", "analyze", "check", "tell", "find", "search",
        "show", "sentiment", "tweets", "about", "for", "is", "are", "do",
        "people", "think", "thoughts", "opinion", "opinions", "on", "towards",
    }
    if 1 <= len(words) <= 3 and not any(w.lower() in conversational_tokens for w in words):
        return stripped_entity

    # Tier 2: Fast Qwen 2.5-3B zero-shot extraction for natural language sentences
    messages = [
        {
            "role": "system",
            "content": (
                "Extract ONLY the main target entity, product, topic, person, or company "
                "from the user's sentence. Output ONLY the exact entity name and nothing else."
            ),
        },
        {"role": "user", "content": "What are people saying about GTA 6 on twitter?"},
        {"role": "assistant", "content": "GTA 6"},
        {"role": "user", "content": "What do people think about Max Verstappen?"},
        {"role": "assistant", "content": "Max Verstappen"},
        {"role": "user", "content": "Analyze public sentiment towards Nvidia RTX 5090"},
        {"role": "assistant", "content": "Nvidia RTX 5090"},
        {"role": "user", "content": cleaned_input},
    ]
    prompt = qwen_pipe.tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    gen_cfg = GenerationConfig(
        max_new_tokens=15,
        do_sample=False,
        pad_token_id=qwen_pipe.tokenizer.pad_token_id,
        eos_token_id=qwen_pipe.tokenizer.eos_token_id,
    )
    out = qwen_pipe(
        prompt,
        generation_config=gen_cfg,
        clean_up_tokenization_spaces=False,
        return_full_text=False,
    )
    extracted_target = out[0]["generated_text"].strip().strip(" ?!.,;:'\"")
    return extracted_target if extracted_target else stripped_entity


# Normalize topic strings into a canonical alphanumeric key so variations map to the same topic
def get_canonical_topic_key(topic: str) -> str:
    alphanumeric = re.sub(r"[^a-zA-Z0-9]", "", topic).lower()
    return alphanumeric if alphanumeric else "general_topic"


# TEXT PREPROCESSING & DEDUPLICATION
# Strip URLs, normalize user mentions to @user, and collapse whitespace for model inference
def clean_tweet_for_transformers(text: str) -> str:
    if not isinstance(text, str):
        return ""
    cleaned = re.sub(r"https?://\S+", "", text)
    cleaned = re.sub(r"(@\w+[\s,]*)+", "@user ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


# Generate a normalized alphanumeric signature to identify and filter duplicate tweets
def create_dedup_key(text: str) -> str:
    if not isinstance(text, str):
        return ""
    t = re.sub(r"@user", "", text)
    t = re.sub(r"[^\w\s]", "", t)
    return re.sub(r"\s+", " ", t).strip().lower()


# FETCHLAYER API TWEET SCRAPER
# Query the FetchLayer API using the user-supplied API key and return a cleaned DataFrame
def fetch_tweets_from_fetchlayer(
    target: str, count_to_fetch: int, api_key: str
) -> pd.DataFrame:
    if not api_key or not api_key.strip():
        raise ValueError("No FetchLayer API key provided.")

    headers = {
        "Authorization": f"Bearer {api_key.strip()}",
        "Content-Type": "application/json",
    }
    hashtag = re.sub(r"[^a-zA-Z0-9]", "", target)
    if hashtag and hashtag.lower() != target.lower():
        query = f'("{target}" OR #{hashtag}) -is:retweet lang:en'
    else:
        query = f'"{target}" -is:retweet lang:en'

    unique_tweets = {}
    cursor = None
    max_requests = max(2, (count_to_fetch // 15) + 1)

    for _ in range(max_requests):
        payload = {
            "query": query,
            "product": "Top",
            "count": 20,
        }
        if cursor:
            payload["cursor"] = cursor

        response = requests.post(
            FETCHLAYER_API_URL, headers=headers, json=payload, timeout=20
        )
        response.raise_for_status()
        data = response.json()

        tweets = data.get("tweets") or data.get("results") or []
        for t in tweets:
            tweet_id = str(t.get("id", ""))
            text = t.get("text", "")
            if text and tweet_id not in unique_tweets:
                unique_tweets[tweet_id] = {
                    "id": tweet_id,
                    "text": text,
                    "time": str(t.get("createdAt", "")),
                    "user": (
                        t.get("author", {}).get("handle")
                        if isinstance(t.get("author"), dict)
                        else "unknown"
                    ),
                }
            if len(unique_tweets) >= count_to_fetch:
                break

        if len(unique_tweets) >= count_to_fetch:
            break

        cursor = data.get("nextCursor")
        if not cursor:
            break
        time.sleep(1.0)

    df_fetched = pd.DataFrame(list(unique_tweets.values()))
    if not df_fetched.empty:
        df_fetched["aspect"] = target.upper() if len(target) <= 5 else target.title()
        df_fetched["cleaned_text"] = df_fetched["text"].apply(
            clean_tweet_for_transformers
        )
    return df_fetched


# QWEN ABSA LOGIT INFERENCE & INSIGHTS SUMMARIZATION
# Construct a few-shot prompt instructing Qwen to isolate sentiment strictly toward the target
def build_generalized_absa_prompt(tweet: str, target: str, tokenizer) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "You are an expert Aspect-Based Sentiment Analyzer.\n"
                f"Your task is to determine the sentiment expressed strictly toward the target: '{target}'.\n\n"
                "Classification Guidelines:\n"
                "- 'positive': The author expresses praise, enthusiasm, anticipation, satisfaction, or a favorable stance specifically toward the target.\n"
                "- 'negative': The author expresses criticism, disappointment, hostility, rejection, or an unfavorable stance specifically toward the target.\n"
                "- 'neutral': The post is objective news, a schedule/date, a factual query, or mentions the target as a benchmark/reference without expressing personal attitude toward it.\n\n"
                "Core Disentanglement Rule:\n"
                "Separate collateral emotion from the target stance. If the author expresses anger or frustration toward external entities (e.g., third-party platforms, retailers, pricing, unrelated people), but their stance toward the target remains favorable, classify as 'positive' (and vice versa).\n\n"
                "Output exactly one single word: 'positive', 'negative', or 'neutral'."
            ),
        },
        {
            "role": "user",
            "content": 'Target: Product Alpha\nTweet: "The official update for Product Alpha has been scheduled for release next month."\nSentiment toward Product Alpha:',
        },
        {"role": "assistant", "content": "neutral"},
        {
            "role": "user",
            "content": 'Target: App Beta\nTweet: "The payment gateway and servers are completely broken today, but App Beta itself is genuinely incredible."\nSentiment toward App Beta:',
        },
        {"role": "assistant", "content": "positive"},
        {
            "role": "user",
            "content": 'Target: Company Gamma\nTweet: "Company Gamma just doubled their prices while cutting half the features. Completely unacceptable."\nSentiment toward Company Gamma:',
        },
        {"role": "assistant", "content": "negative"},
        {
            "role": "user",
            "content": 'Target: Device Delta\nTweet: "Will the conference wrap up before or after Device Delta goes on sale?"\nSentiment toward Device Delta:',
        },
        {"role": "assistant", "content": "neutral"},
        {
            "role": "user",
            "content": f'Target: {target}\nTweet: "{tweet}"\nSentiment toward {target}:',
        },
    ]
    return tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )


# Extract next-token logits for candidate sentiment labels and compute softmax probabilities
def classify_tweets_with_qwen(
    df: pd.DataFrame, target: str, pipe, candidate_words, candidate_ids
) -> pd.DataFrame:
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    prompts = [
        build_generalized_absa_prompt(text, target=target, tokenizer=pipe.tokenizer)
        for text in df["cleaned_text"]
    ]

    batch_size = 2
    all_probs = []
    progress_bar = st.progress(0, text="Running Qwen 2.5-3B ABSA Logit Extraction...")

    total_batches = max(1, (len(prompts) + batch_size - 1) // batch_size)
    for b_idx, i in enumerate(range(0, len(prompts), batch_size)):
        batch_prompts = prompts[i : i + batch_size]
        encoded = pipe.tokenizer(
            batch_prompts, padding=True, return_tensors="pt"
        ).to(pipe.model.device)

        with torch.no_grad():
            outputs = pipe.model(**encoded)
            next_token_logits = outputs.logits[:, -1, candidate_ids]
            probs = F.softmax(next_token_logits, dim=-1).cpu().numpy()
            all_probs.extend(probs)

        del encoded, outputs
        progress_bar.progress(
            (b_idx + 1) / total_batches,
            text=f"Running Qwen 2.5-3B ABSA Logit Extraction... ({b_idx + 1}/{total_batches} batches)",
        )

    progress_bar.empty()
    all_probs = np.array(all_probs)

    df = df.copy()
    df["qwen_prob_pos"] = all_probs[:, 0].astype(float)
    df["qwen_prob_neg"] = all_probs[:, 1].astype(float)
    df["qwen_prob_neu"] = all_probs[:, 2].astype(float)
    df["qwen2.5-3b-instruct_sentiment"] = [
        candidate_words[idx] for idx in all_probs.argmax(axis=1)
    ]
    return df


# Stream the executive insights report with real-time token speed, elapsed time, and ETA countdown
def generate_qwen_insights_with_timer(
    target: str,
    top_pos_df: pd.DataFrame,
    top_neg_df: pd.DataFrame,
    pipe,
    report_placeholder,
) -> tuple[str, float]:
    pos_lines = (
        "\n".join(
            [
                f"{i+1}. \"{row['cleaned_text']}\" (Confidence: {row['qwen_prob_pos']*100:.1f}%)"
                for i, (_, row) in enumerate(top_pos_df.iterrows())
            ]
        )
        if not top_pos_df.empty
        else "No high-confidence positive tweets recorded yet."
    )
    neg_lines = (
        "\n".join(
            [
                f"{i+1}. \"{row['cleaned_text']}\" (Confidence: {row['qwen_prob_neg']*100:.1f}%)"
                for i, (_, row) in enumerate(top_neg_df.iterrows())
            ]
        )
        if not top_neg_df.empty
        else "No high-confidence negative tweets recorded yet."
    )

    user_prompt = f"""You are a Senior Social Media Intelligence Analyst.
Analyze the following high-confidence positive and negative tweets strictly regarding the target: '{target}'.

Top High-Confidence Positive Tweets:
{pos_lines}

Top High-Confidence Negative Tweets:
{neg_lines}

Write a visually appealing, well-structured Markdown report with the following sections:
### 🟢 Why Sentiment is Positive (Top Excitement & Praise Drivers)
- Summarize the core reasons users are praising or excited about **{target}** in 2 to 3 bullet points with bold theme titles. Briefly reference specific points from the positive tweets.

### 🔴 Why Sentiment is Negative (Top Pain Points & Criticisms)
- Summarize the core complaints, concerns, or criticisms directed at **{target}** in 2 to 3 bullet points with bold theme titles. Briefly reference specific points from the negative tweets.

### ⚖️ Executive Takeaway
- Provide a crisp 2-sentence synthesis of the overall public mood toward **{target}**."""

    messages = [
        {
            "role": "system",
            "content": "You are a concise, insightful market research analyst. Use clean Markdown formatting.",
        },
        {"role": "user", "content": user_prompt},
    ]

    formatted_prompt = pipe.tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )

    max_new_tokens = 450
    expected_report_tokens = 280
    inputs = pipe.tokenizer(formatted_prompt, return_tensors="pt").to(pipe.model.device)

    streamer = TextIteratorStreamer(
        pipe.tokenizer, skip_prompt=True, skip_special_tokens=True
    )
    gen_kwargs = dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=max_new_tokens,
        do_sample=False,
        pad_token_id=pipe.tokenizer.pad_token_id,
        eos_token_id=pipe.tokenizer.eos_token_id,
    )

    # Launch model generation in a background thread to update the UI timer continuously
    thread = threading.Thread(target=pipe.model.generate, kwargs=gen_kwargs)
    start_time = time.time()
    thread.start()

    timer_bar = st.progress(
        0.0,
        text="⏳ Initializing Qwen 2.5-3B Executive Report Generator...",
    )

    generated_text = ""
    chunk_count = 0

    for new_text in streamer:
        generated_text += new_text
        chunk_count += 1
        elapsed = time.time() - start_time

        # Dynamically adjust target token budget if generation exceeds initial estimate
        dynamic_target = (
            expected_report_tokens
            if chunk_count < expected_report_tokens
            else max_new_tokens
        )
        progress_ratio = min(0.98, chunk_count / dynamic_target)
        tok_per_sec = chunk_count / max(elapsed, 0.1)
        remaining_tokens = max(0, dynamic_target - chunk_count)
        eta_seconds = remaining_tokens / max(tok_per_sec, 0.1)

        timer_bar.progress(
            progress_ratio,
            text=(
                f"⏳ Generating Executive Insights... {int(progress_ratio * 100)}%  |  "
                f"Elapsed: {elapsed:.1f}s  |  "
                f"Est. Time Remaining: ~{eta_seconds:.1f}s  ({tok_per_sec:.1f} tok/s)"
            ),
        )
        report_placeholder.markdown(generated_text + "▌")

    thread.join()
    total_time = time.time() - start_time
    timer_bar.empty()
    final_report = generated_text.strip()
    report_placeholder.markdown(final_report)

    return final_report, total_time


# CLOUD DATABASE MERGING & PERSISTENCE MANAGER
# Fetch stored topic summaries from Supabase and render them inside the sidebar placeholder
def render_sidebar_datasets(sidebar_placeholder, supabase: Client):
    with sidebar_placeholder.container():
        try:
            response = (
                supabase.table(SUPABASE_TABLE)
                .select("topic_key, aspect")
                .execute()
            )
            rows = response.data or []
            if rows:
                counts = Counter(r["topic_key"] for r in rows if r.get("topic_key"))
                aspect_map = {
                    r["topic_key"]: r.get("aspect", r["topic_key"])
                    for r in rows
                    if r.get("topic_key")
                }
                for t_key in sorted(counts.keys()):
                    display_aspect = aspect_map.get(t_key, t_key)
                    st.markdown(
                        f"- `{t_key}` — **{display_aspect}** (**{counts[t_key]}** unique tweets)"
                    )
            else:
                st.info("No topic datasets stored in Supabase yet.")
        except Exception as e:
            st.warning(f"Unable to load topic list from Supabase: {e}")


# Synchronize newly scraped tweets with Supabase, classify only unseen rows, and upsert
def update_and_classify_topic_dataset(
    new_df: pd.DataFrame,
    target: str,
    pipe,
    candidate_words,
    candidate_ids,
    supabase: Client,
) -> tuple[pd.DataFrame, int, int]:
    canonical_key = get_canonical_topic_key(target)

    # Query existing tweets for this canonical topic key from Supabase
    try:
        res = (
            supabase.table(SUPABASE_TABLE)
            .select("*")
            .eq("topic_key", canonical_key)
            .execute()
        )
        existing_records = res.data or []
        existing_df = pd.DataFrame(existing_records)
    except Exception as e:
        st.warning(f"Database read warning: {e}")
        existing_df = pd.DataFrame()

    if not existing_df.empty:
        existing_df["cleaned_text"] = existing_df["text"].apply(
            clean_tweet_for_transformers
        )
        existing_df["dedup_key"] = existing_df["cleaned_text"].apply(create_dedup_key)
        existing_keys = set(existing_df["dedup_key"])
    else:
        existing_keys = set()

    # Deduplicate newly scraped tweets internally and against historical database keys
    if not new_df.empty:
        new_df = new_df.copy()
        new_df["dedup_key"] = new_df["cleaned_text"].apply(create_dedup_key)
        new_df = new_df.drop_duplicates(subset=["dedup_key"], keep="first")
        truly_new_df = new_df[~new_df["dedup_key"].isin(existing_keys)].copy()
        truly_new_df = truly_new_df[truly_new_df["dedup_key"] != ""].copy()
    else:
        truly_new_df = pd.DataFrame()

    newly_added_count = len(truly_new_df)

    # Run Qwen logit classification strictly on new unseen tweets to conserve compute
    if not truly_new_df.empty:
        truly_new_df = classify_tweets_with_qwen(
            truly_new_df, target, pipe, candidate_words, candidate_ids
        )
        truly_new_df["topic_key"] = canonical_key

        # Format records and upsert into Supabase using the (topic_key, dedup_key) constraint
        db_columns = [
            "topic_key",
            "aspect",
            "id",
            "user",
            "time",
            "text",
            "cleaned_text",
            "dedup_key",
            "qwen2.5-3b-instruct_sentiment",
            "qwen_prob_pos",
            "qwen_prob_neg",
            "qwen_prob_neu",
        ]
        records_to_upsert = truly_new_df[db_columns].to_dict(orient="records")
        try:
            supabase.table(SUPABASE_TABLE).upsert(
                records_to_upsert, on_conflict="topic_key,dedup_key"
            ).execute()
        except Exception as e:
            st.error(f"Failed to upsert new tweets to Supabase: {e}")

    # Backfill sentiment predictions if any historical database records lack annotations
    if not existing_df.empty and (
        "qwen2.5-3b-instruct_sentiment" not in existing_df.columns
        or existing_df["qwen2.5-3b-instruct_sentiment"].isna().any()
    ):
        existing_df = classify_tweets_with_qwen(
            existing_df, target, pipe, candidate_words, candidate_ids
        )

    # Combine historical and newly classified records for downstream dashboard analytics
    if not existing_df.empty and not truly_new_df.empty:
        combined_df = pd.concat([existing_df, truly_new_df], ignore_index=True)
    elif not existing_df.empty:
        combined_df = existing_df
    else:
        combined_df = truly_new_df

    if not combined_df.empty:
        combined_df["dedup_key"] = combined_df["cleaned_text"].apply(create_dedup_key)
        combined_df = (
            combined_df.drop_duplicates(subset=["dedup_key"], keep="first")
            .reset_index(drop=True)
        )

    return combined_df, newly_added_count, len(existing_df)


# STREAMLIT USER INTERFACE
# Render the main application layout, sidebar controls, and interactive analytics dashboard
def main():
    st.title("Target-Oriented ABSA & Insights Studio")
    st.caption(
        "Powered by **Qwen 2.5-3B-Instruct** (Verbalizer Logits + Executive Synthesis), **FetchLayer API**, & **Supabase Cloud DB**"
    )

    # Load database client and machine learning pipelines
    supabase = init_supabase_client()
    qwen_pipe, candidate_words, candidate_ids = load_qwen_pipeline()

    # Render sidebar configuration settings and cloud dataset inventory
    with st.sidebar:
        st.header("⚙️ Pipeline Settings")
        api_key_input = st.text_input(
            "FetchLayer API Key",
            value="",
            placeholder="Enter your FetchLayer API key (ss-...)",
            type="password",
            help="Enter your personal FetchLayer API key to scrape live tweets from X.",
        )
        fetch_count = st.slider(
            "Tweets to Fetch per Query", min_value=10, max_value=60, value=20, step=10
        )

        st.divider()
        st.subheader("☁️ Stored Cloud Datasets")
        st.caption(f"Supabase Table: `{SUPABASE_TABLE}`")
        sidebar_datasets_placeholder = st.empty()
        render_sidebar_datasets(sidebar_datasets_placeholder, supabase)

    # Render primary user query input and action button
    col_input, col_btn = st.columns([4, 1])
    with col_input:
        user_query = st.text_input(
            "Enter a topic or natural language sentence:",
            placeholder="e.g., What do people think about Nvidia?",
        )
    with col_btn:
        st.write("")
        st.write("")
        run_btn = st.button(
            "Analyze Sentiment", type="primary", use_container_width=True
        )

    if run_btn and user_query.strip():
        # Step 1: Extract target entity and compute canonical database key
        with st.spinner("Extracting target aspect from query..."):
            extracted_target = extract_target_from_input(user_query, qwen_pipe)
            canonical_key = get_canonical_topic_key(extracted_target)

        st.info(
            f"**Detected Target Aspect:** `{extracted_target}`  |  "
            f"**Canonical Cloud Key:** `{canonical_key}`  |  "
            f"**Database Table:** `{SUPABASE_TABLE}`"
        )

        # Step 2: Scrape live tweets via FetchLayer API if user provided an API key
        fetched_df = pd.DataFrame()
        if api_key_input.strip():
            with st.spinner(
                f"Fetching {fetch_count} tweets for '{extracted_target}' via FetchLayer..."
            ):
                try:
                    fetched_df = fetch_tweets_from_fetchlayer(
                        extracted_target,
                        count_to_fetch=fetch_count,
                        api_key=api_key_input,
                    )
                except Exception as e:
                    st.warning(
                        f"FetchLayer API warning: {e}. Checking Supabase cloud storage..."
                    )
        else:
            st.warning(
                "No FetchLayer API key entered in the sidebar. Skipping live X scraping and "
                "querying existing tweets stored in Supabase..."
            )

        # Step 3: Merge with cloud dataset, deduplicate, classify new tweets, and refresh sidebar
        df_topic, newly_added, previous_count = update_and_classify_topic_dataset(
            fetched_df,
            extracted_target,
            qwen_pipe,
            candidate_words,
            candidate_ids,
            supabase,
        )
        render_sidebar_datasets(sidebar_datasets_placeholder, supabase)

        if df_topic.empty:
            st.error(
                "No tweets were found for this topic in Supabase. Please provide a valid "
                "FetchLayer API key in the sidebar to fetch new tweets."
            )
            return

        st.success(
            f"✅ **Cloud Dataset Synced!** Historical tweets in DB: **{previous_count}** | "
            f"New unique tweets appended: **{newly_added}** | "
            f"Total unique tweets for `{canonical_key}`: **{len(df_topic)}**"
        )

        # Step 4: Calculate and render overall majority sentiment metrics
        counts = df_topic["qwen2.5-3b-instruct_sentiment"].value_counts()
        pos_cnt = int(counts.get("positive", 0))
        neg_cnt = int(counts.get("negative", 0))
        neu_cnt = int(counts.get("neutral", 0))
        total_cnt = len(df_topic)

        dominant_sentiment = counts.idxmax().upper()
        sentiment_meta = {
            "POSITIVE": ("🟢 POSITIVE", "#10b981"),
            "NEGATIVE": ("🔴 NEGATIVE", "#ef4444"),
            "NEUTRAL": ("⚪ NEUTRAL", "#94a3b8"),
        }
        badge_label, badge_color = sentiment_meta.get(
            dominant_sentiment, ("⚪ NEUTRAL", "#94a3b8")
        )

        st.markdown("### 📊 Overall Target Sentiment Overview")
        m1, m2, m3, m4 = st.columns(4)
        with m1:
            st.markdown(
                f"""<div class="metric-card">
                <div style="color:#94a3b8;font-size:0.85rem;">OVERALL VERDICT</div>
                <div style="color:{badge_color};font-size:1.65rem;font-weight:800;margin-top:6px;">{badge_label}</div>
                <div style="color:#cbd5e1;font-size:0.8rem;margin-top:4px;">Majority Class Winner</div>
                </div>""",
                unsafe_allow_html=True,
            )
        with m2:
            st.metric(
                "🟢 Positive Tweets", f"{pos_cnt}", f"{pos_cnt/total_cnt*100:.1f}%"
            )
        with m3:
            st.metric(
                "🔴 Negative Tweets", f"{neg_cnt}", f"{neg_cnt/total_cnt*100:.1f}%"
            )
        with m4:
            st.metric(
                "⚪ Neutral Tweets", f"{neu_cnt}", f"{neu_cnt/total_cnt*100:.1f}%"
            )

        st.write("")

        # Step 5: Filter top 5 highest-confidence positive and negative tweets
        top_5_pos = (
            df_topic[df_topic["qwen2.5-3b-instruct_sentiment"] == "positive"]
            .sort_values(by="qwen_prob_pos", ascending=False)
            .head(5)
        )
        top_5_neg = (
            df_topic[df_topic["qwen2.5-3b-instruct_sentiment"] == "negative"]
            .sort_values(by="qwen_prob_neg", ascending=False)
            .head(5)
        )

        # Step 6: Stream executive insights report with live progress bar and ETA countdown
        st.markdown("### 🧠 Qwen 2.5-3B Executive Sentiment Synthesis")
        with st.container(border=True):
            report_placeholder = st.empty()
            _, gen_duration = generate_qwen_insights_with_timer(
                extracted_target,
                top_5_pos,
                top_5_neg,
                qwen_pipe,
                report_placeholder,
            )
            st.caption(
                f"⏱️ Executive synthesis completed in **{gen_duration:.1f} seconds**."
            )

        # Step 7: Render HTML-escaped polarity evidence cards for top 5 positive and negative tweets
        st.markdown("### 🏆 Top 5 High-Confidence Polarity Evidence")
        col_pos, col_neg = st.columns(2)

        with col_pos:
            st.subheader("🟢 Top 5 Confident Positive Tweets")
            if top_5_pos.empty:
                st.info("No positive tweets classified yet.")
            else:
                for rank, (_, row) in enumerate(top_5_pos.iterrows(), 1):
                    conf_pct = row["qwen_prob_pos"] * 100
                    safe_user = html.escape(str(row.get("user", "user")))
                    safe_text = html.escape(str(row["cleaned_text"]))
                    st.markdown(
                        f"""<div class="tweet-card-pos">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="font-weight:700;color:#10b981;">#{rank} • @{safe_user}</span>
                            <span class="conf-badge-pos">Confidence: {conf_pct:.1f}%</span>
                        </div>
                        <div style="color:#f1f5f9;font-size:0.95rem;line-height:1.45;">{safe_text}</div>
                        </div>""",
                        unsafe_allow_html=True,
                    )

        with col_neg:
            st.subheader("🔴 Top 5 Confident Negative Tweets")
            if top_5_neg.empty:
                st.info("No negative tweets classified yet.")
            else:
                for rank, (_, row) in enumerate(top_5_neg.iterrows(), 1):
                    conf_pct = row["qwen_prob_neg"] * 100
                    safe_user = html.escape(str(row.get("user", "user")))
                    safe_text = html.escape(str(row["cleaned_text"]))
                    st.markdown(
                        f"""<div class="tweet-card-neg">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="font-weight:700;color:#ef4444;">#{rank} • @{safe_user}</span>
                            <span class="conf-badge-neg">Confidence: {conf_pct:.1f}%</span>
                        </div>
                        <div style="color:#f1f5f9;font-size:0.95rem;line-height:1.45;">{safe_text}</div>
                        </div>""",
                        unsafe_allow_html=True,
                    )

        # Step 8: Display interactive full dataset table inside an expandable container
        with st.expander(
            f"📋 View Full Deduplicated Topic Dataset ({len(df_topic)} Tweets)"
        ):
            display_cols = [
                c
                for c in [
                    "user",
                    "time",
                    "cleaned_text",
                    "qwen2.5-3b-instruct_sentiment",
                    "qwen_prob_pos",
                    "qwen_prob_neg",
                    "qwen_prob_neu",
                ]
                if c in df_topic.columns
            ]
            st.dataframe(df_topic[display_cols], use_container_width=True)


if __name__ == "__main__":
    main()