import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { normalizeTopicKey, cleanTweetText, sanitizeHandle } from "@/lib/clean";
import { computeDedupKey } from "@/lib/dedup";
import { hf } from "@/lib/hf";
import { fetchTweetsFromFetchLayer } from "@/lib/fetchlayer";
import {
  computeDynamicWindows,
  filterTweetsByWindow,
  calculateWeightedSentiment,
  calculateSentimentVelocity,
  RawTweetItem,
} from "@/lib/analytics";
import {
  AnalyzeResponse,
  TimeWindowId,
  HFClassifyResp,
  HFExtractResp,
  Evidence,
  SentimentLabel,
} from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawTopic = (body.topic || "").trim();
    const requestedWindow = (body.window as TimeWindowId) || undefined;
    const userApiKey = body.fetchlayerKey ? String(body.fetchlayerKey).trim() : undefined;

    if (!rawTopic) {
      return NextResponse.json({ error: "Topic is required" }, { status: 400 });
    }

    const topicKey = normalizeTopicKey(rawTopic);
    const supabase = sb();

    // 1. If FetchLayer API key provided, fetch and ingest new posts first
    if (userApiKey) {
      try {
        const scrapeResult = await fetchTweetsFromFetchLayer({
          query: rawTopic,
          count: 48, // Vercel Hobby safe chunk
          apiKey: userApiKey,
        });

        if (scrapeResult.tweets.length > 0) {
          // Preprocess and compute dedup keys
          const candidateRows = scrapeResult.tweets.map((t) => {
            const cleaned = cleanTweetText(t.text);
            const dedupKey = computeDedupKey(cleaned, t.user);
            return {
              rawTweet: t,
              cleaned,
              dedupKey,
            };
          }).filter((c) => c.cleaned.length > 0);

          // Check which keys already exist in DB
          const dedupKeys = candidateRows.map((c) => c.dedupKey);
          const { data: existingRows } = await supabase
            .from("absa_tweets")
            .select("dedup_key")
            .eq("topic_key", topicKey)
            .in("dedup_key", dedupKeys);

          const existingKeySet = new Set((existingRows || []).map((r) => r.dedup_key));
          const newCandidates = candidateRows.filter((c) => !existingKeySet.has(c.dedupKey));

          if (newCandidates.length > 0) {
            // Extract canonical target aspect if needed
            let aspect = rawTopic;
            try {
              const ext = await hf<HFExtractResp>("/extract-target", { text: rawTopic });
              if (ext && ext.entity) {
                aspect = ext.entity;
              }
            } catch {
              // Fallback to raw topic
            }

            // Classify in batches of 16
            const batchSize = 16;
            const insertRows = [];

            for (let i = 0; i < newCandidates.length; i += batchSize) {
              const batch = newCandidates.slice(i, i + batchSize);
              const texts = batch.map((b) => b.cleaned);

              try {
                const classified = await hf<HFClassifyResp>("/classify-batch", {
                  texts,
                  target: aspect,
                });

                for (let j = 0; j < batch.length; j++) {
                  const item = classified.results[j];
                  if (!item) continue;
                  const cand = batch[j];

                  insertRows.push({
                    topic_key: topicKey,
                    aspect: aspect,
                    user: cand.rawTweet.user,
                    time: new Date(cand.rawTweet.time).toISOString(),
                    text: cand.rawTweet.text,
                    cleaned_text: cand.cleaned,
                    dedup_key: cand.dedupKey,
                    "qwen2.5-3b-instruct_sentiment": item.label,
                    qwen_prob_pos: item.prob_pos,
                    qwen_prob_neg: item.prob_neg,
                    qwen_prob_neu: item.prob_neu,
                  });
                }
              } catch (hfErr) {
                console.error("HF classification batch error:", hfErr);
              }
            }

            if (insertRows.length > 0) {
              await supabase
                .from("absa_tweets")
                .upsert(insertRows, { onConflict: "topic_key,dedup_key", ignoreDuplicates: true });
            }
          }
        }
      } catch (scrapeErr) {
        console.error("FetchLayer scrape failed during analyze:", scrapeErr);
      }
    }

    // 2. Query historical tweets for this topic from absa_tweets_v
    const candidateKeys = Array.from(
      new Set(
        [
          topicKey,
          topicKey.replace(/\s+/g, ""),
          rawTopic.trim(),
          rawTopic.trim().toLowerCase(),
        ].filter(Boolean)
      )
    );

    let rows: Array<{
      aspect: string | null;
      tweeted_at: string;
      text: string;
      cleaned_text: string;
      sentiment: string;
      p_pos: number | null;
      p_neg: number | null;
      p_neu: number | null;
      handle: string | null;
    }> | null = null;

    let permissionIssue = false;
    let apiKeyIssue = false;

    try {
      // 1. Try querying absa_tweets_v with candidate keys
      const { data: vData, error: vErr } = await supabase
        .from("absa_tweets_v")
        .select("aspect, tweeted_at, text, cleaned_text, sentiment, p_pos, p_neg, p_neu, handle")
        .in("topic_key", candidateKeys)
        .order("tweeted_at", { ascending: false });

      if (vErr) {
        if (vErr.message?.toLowerCase().includes("permission denied")) {
          permissionIssue = true;
        }
        if (vErr.message?.toLowerCase().includes("invalid api key")) {
          apiKeyIssue = true;
        }
      } else if (vData && vData.length > 0) {
        rows = vData;
      }

      // 2. If no rows found yet, try ILIKE search on topic_key or aspect in view
      if (!rows || rows.length === 0) {
        const { data: vIlike, error: vIlikeErr } = await supabase
          .from("absa_tweets_v")
          .select("aspect, tweeted_at, text, cleaned_text, sentiment, p_pos, p_neg, p_neu, handle")
          .or(`topic_key.ilike.%${topicKey}%,aspect.ilike.%${rawTopic}%`)
          .order("tweeted_at", { ascending: false });

        if (vIlikeErr) {
          if (vIlikeErr.message?.toLowerCase().includes("permission denied")) {
            permissionIssue = true;
          }
          if (vIlikeErr.message?.toLowerCase().includes("invalid api key")) {
            apiKeyIssue = true;
          }
        } else if (vIlike && vIlike.length > 0) {
          rows = vIlike;
        }
      }

      // 3. Fallback: query raw table absa_tweets
      if (!rows || rows.length === 0) {
        const { data: tData, error: tErr } = await supabase
          .from("absa_tweets")
          .select('aspect, time, text, cleaned_text, "qwen2.5-3b-instruct_sentiment", qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, "user"')
          .in("topic_key", candidateKeys)
          .order("time", { ascending: false });

        if (tErr) {
          if (tErr.message?.toLowerCase().includes("permission denied")) {
            permissionIssue = true;
          }
          if (tErr.message?.toLowerCase().includes("invalid api key")) {
            apiKeyIssue = true;
          }
        } else if (tData && tData.length > 0) {
          rows = tData.map((d) => ({
            aspect: d.aspect,
            tweeted_at: d.time,
            text: d.text,
            cleaned_text: d.cleaned_text,
            sentiment: (d as Record<string, unknown>)["qwen2.5-3b-instruct_sentiment"] as string,
            p_pos: d.qwen_prob_pos,
            p_neg: d.qwen_prob_neg,
            p_neu: d.qwen_prob_neu,
            handle: (d as Record<string, unknown>)["user"] as string,
          }));
        }
      }

      // 4. Try raw table ILIKE fallback if still no rows
      if (!rows || rows.length === 0) {
        const { data: tIlike, error: tIlikeErr } = await supabase
          .from("absa_tweets")
          .select('aspect, time, text, cleaned_text, "qwen2.5-3b-instruct_sentiment", qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, "user"')
          .or(`topic_key.ilike.%${topicKey}%,aspect.ilike.%${rawTopic}%`)
          .order("time", { ascending: false });

        if (tIlikeErr) {
          if (tIlikeErr.message?.toLowerCase().includes("permission denied")) {
            permissionIssue = true;
          }
          if (tIlikeErr.message?.toLowerCase().includes("invalid api key")) {
            apiKeyIssue = true;
          }
        } else if (tIlike && tIlike.length > 0) {
          rows = tIlike.map((d) => ({
            aspect: d.aspect,
            tweeted_at: d.time,
            text: d.text,
            cleaned_text: d.cleaned_text,
            sentiment: (d as Record<string, unknown>)["qwen2.5-3b-instruct_sentiment"] as string,
            p_pos: d.qwen_prob_pos,
            p_neg: d.qwen_prob_neg,
            p_neu: d.qwen_prob_neu,
            handle: (d as Record<string, unknown>)["user"] as string,
          }));
        }
      }
    } catch (dbErr) {
      console.warn("Database read warning:", dbErr);
    }

    if (!rows || rows.length === 0) {
      if (apiKeyIssue) {
        return NextResponse.json(
          {
            notFound: true,
            authError: true,
            message:
              "Supabase returned 'Invalid API key'. Please check your SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL in Vercel Environment Variables. Make sure you copy the exact key from Supabase Dashboard -> Project Settings -> API without extra spaces.",
          },
          { status: 401 }
        );
      }

      if (permissionIssue) {
        return NextResponse.json(
          {
            notFound: true,
            permissionError: true,
            message:
              "Supabase returned 'permission denied' when reading database rows. Please execute the SQL grant snippet in your Supabase SQL Editor and ensure SUPABASE_SERVICE_ROLE_KEY is set to your project's service_role secret key.",
          },
          { status: 403 }
        );
      }

      return NextResponse.json(
        {
          notFound: true,
          message:
            "No posts found for this topic yet. Click 'FetchLayer Key' above and enter your FetchLayer API key to fetch and analyze fresh posts!",
        },
        { status: 404 }
      );
    }

    // Map into normalized analytics objects
    const aspectDisplay = rows[0]?.aspect || rawTopic;
    const now = new Date();

    interface ProcessedRow extends RawTweetItem {
      p_pos: number;
      p_neg: number;
      p_neu: number;
      confidence: number;
      handle: string;
      text: string;
    }

    const processedRows: ProcessedRow[] = rows.map((r) => {
      const p_pos = r.p_pos ?? 0;
      const p_neg = r.p_neg ?? 0;
      const p_neu = r.p_neu ?? 0;
      const confidence = Math.max(p_pos, p_neg, p_neu);
      const sentiment = (r.sentiment as SentimentLabel) || "neutral";

      return {
        time: r.tweeted_at,
        sentiment,
        p_pos,
        p_neg,
        p_neu,
        confidence,
        handle: sanitizeHandle(r.handle),
        text: r.text,
      };
    });

    // 3. Compute dynamic windows
    const { availableWindows, defaultWindowId } = computeDynamicWindows(processedRows, now);
    const chosenWindowId: TimeWindowId =
      requestedWindow && availableWindows.some((w) => w.id === requestedWindow)
        ? requestedWindow
        : defaultWindowId;

    const { filtered, windowInfo } = filterTweetsByWindow(processedRows, chosenWindowId, now);

    // 4. Calculate weighted & raw sentiment on the selected window
    const { counts, weighted, rawVerdict } = calculateWeightedSentiment(filtered, now);

    // 5. Calculate velocity over all historical data
    const velocity = calculateSentimentVelocity(processedRows, now);

    // 6. Select top 5 positive and top 5 negative evidence items
    const positivePool = (filtered as ProcessedRow[])
      .filter((t) => t.sentiment === "positive")
      .sort((a, b) => b.confidence - a.confidence || new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);

    const negativePool = (filtered as ProcessedRow[])
      .filter((t) => t.sentiment === "negative")
      .sort((a, b) => b.confidence - a.confidence || new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);

    const formatEvidence = (items: ProcessedRow[]): Evidence[] =>
      items.map((i) => ({
        handle: i.handle,
        time: new Date(i.time).toISOString(),
        text: i.text,
        confidence: Number(i.confidence.toFixed(3)),
      }));

    const times = processedRows.map((t) => new Date(t.time).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const days = Math.round((maxTime - minTime) / 86_400_000);

    const response: AnalyzeResponse = {
      topic: rawTopic,
      aspect: aspectDisplay,
      coverage: {
        oldest: new Date(minTime).toISOString(),
        newest: new Date(maxTime).toISOString(),
        days,
      },
      availableWindows,
      window: windowInfo,
      counts,
      weighted,
      rawVerdict,
      velocity,
      evidence: {
        positive: formatEvidence(positivePool),
        negative: formatEvidence(negativePool),
      },
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("Unhandled error in /api/analyze:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
