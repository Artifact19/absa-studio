import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { normalizeTopicKey, cleanTweetText, sanitizeHandle, sanitizePostgrestFilter } from "@/lib/clean";
import { classifyTopicGenre } from "@/lib/genre";
import { computeDedupKey } from "@/lib/dedup";
import { hf } from "@/lib/hf";
import { fetchPostsFromFetchLayer } from "@/lib/fetchlayer";
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
  SocialPlatform,
  PlatformBreakdown,
} from "@/lib/types";
import { checkPublicEndpointRateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const rl = checkPublicEndpointRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a few moments before searching again." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rl.retryAfterSeconds),
          },
        }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawTopic = (body.topic || "").trim();
    const requestedWindow = (body.window as TimeWindowId) || undefined;
    const userApiKey = body.fetchlayerKey ? String(body.fetchlayerKey).trim() : undefined;

    if (!rawTopic) {
      return NextResponse.json({ error: "Topic is required" }, { status: 400 });
    }

    const topicKey = normalizeTopicKey(rawTopic);
    const supabase = sb();

    // 1. If FetchLayer API key provided, fetch and ingest new posts (X + Reddit)
    if (userApiKey) {
      try {
        const scrapeResult = await fetchPostsFromFetchLayer({
          query: rawTopic,
          count: 48, // Vercel Hobby safe chunk
          apiKey: userApiKey,
          platforms: ["twitter", "reddit"],
        });

        if (scrapeResult.posts.length > 0) {
          // Preprocess and compute dedup keys
          const candidateRows = scrapeResult.posts
            .map((p) => {
              const cleaned = cleanTweetText(p.text);
              const dedupKey = computeDedupKey(cleaned, p.user);
              return {
                rawPost: p,
                cleaned,
                dedupKey,
              };
            })
            .filter((c) => c.cleaned.length > 0);

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
            const insertRows: Array<Record<string, unknown>> = [];

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
                    user: cand.rawPost.user,
                    time: new Date(cand.rawPost.time).toISOString(),
                    text: cand.rawPost.text,
                    cleaned_text: cand.cleaned,
                    dedup_key: cand.dedupKey,
                    platform: cand.rawPost.platform || "twitter",
                    subreddit: cand.rawPost.subreddit || null,
                    context_url: cand.rawPost.url || null,
                    rationale: item.rationale || null,
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
              const { error: upsertErr } = await supabase
                .from("absa_tweets")
                .upsert(insertRows, { onConflict: "topic_key,dedup_key", ignoreDuplicates: true });

              if (upsertErr) {
                console.warn("Retrying upsert with legacy schema fallback...", upsertErr.message);
                const legacyRows = insertRows.map((r) => {
                  const { platform, subreddit, context_url, rationale, ...legacy } = r;
                  return legacy;
                });
                await supabase
                  .from("absa_tweets")
                  .upsert(legacyRows, { onConflict: "topic_key,dedup_key", ignoreDuplicates: true });
              }
            }
          }
        }
      } catch (scrapeErr) {
        console.error("FetchLayer scrape failed during analyze:", scrapeErr);
      }
    }

    // 2. Query historical posts for this topic from absa_tweets_v
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

    interface DBRow {
      aspect: string | null;
      tweeted_at: string;
      text: string;
      cleaned_text: string;
      sentiment: string;
      p_pos: number | null;
      p_neg: number | null;
      p_neu: number | null;
      handle: string | null;
      platform?: string | null;
      subreddit?: string | null;
      context_url?: string | null;
      rationale?: string | null;
    }

    const mapRawToDBRows = (list: Array<Record<string, unknown>>): DBRow[] =>
      list.map((d) => ({
        aspect: (d.aspect as string) || null,
        tweeted_at: (d.tweeted_at as string) || (d.time as string) || new Date().toISOString(),
        text: (d.text as string) || "",
        cleaned_text: (d.cleaned_text as string) || "",
        sentiment: (d.sentiment as string) || (d["qwen2.5-3b-instruct_sentiment"] as string) || "neutral",
        p_pos: (d.p_pos as number) ?? (d.qwen_prob_pos as number) ?? null,
        p_neg: (d.p_neg as number) ?? (d.qwen_prob_neg as number) ?? null,
        p_neu: (d.p_neu as number) ?? (d.qwen_prob_neu as number) ?? null,
        handle: (d.handle as string) || (d.user as string) || null,
        platform: (d.platform as string) || "twitter",
        subreddit: (d.subreddit as string) || null,
        context_url: (d.context_url as string) || null,
        rationale: (d.rationale as string) || null,
      }));

    let rows: DBRow[] | null = null;
    let permissionIssue = false;
    let apiKeyIssue = false;

    const selectColumnsWithPlatform =
      "aspect, tweeted_at, text, cleaned_text, sentiment, p_pos, p_neg, p_neu, handle, platform, subreddit, context_url, rationale";
    const selectColumnsLegacy =
      "aspect, tweeted_at, text, cleaned_text, sentiment, p_pos, p_neg, p_neu, handle";

    try {
      // 1. Try querying absa_tweets_v with candidate keys
      const res1 = await supabase
        .from("absa_tweets_v")
        .select(selectColumnsWithPlatform)
        .in("topic_key", candidateKeys)
        .order("tweeted_at", { ascending: false });

      let vData = res1.data as Array<Record<string, unknown>> | null;
      let vErr = res1.error;

      if (vErr && vErr.message?.toLowerCase().includes("does not exist")) {
        const fallback = await supabase
          .from("absa_tweets_v")
          .select(selectColumnsLegacy)
          .in("topic_key", candidateKeys)
          .order("tweeted_at", { ascending: false });
        vData = fallback.data as Array<Record<string, unknown>> | null;
        vErr = fallback.error;
      }

      if (vErr) {
        if (vErr.message?.toLowerCase().includes("permission denied")) {
          permissionIssue = true;
        }
        if (vErr.message?.toLowerCase().includes("invalid api key")) {
          apiKeyIssue = true;
        }
      } else if (vData && vData.length > 0) {
        rows = mapRawToDBRows(vData);
      }

      // 2. If no rows found yet, try ILIKE search on topic_key or aspect in view
      const safeTopicFilter = sanitizePostgrestFilter(topicKey);
      const safeAspectFilter = sanitizePostgrestFilter(rawTopic);

      if (!rows || rows.length === 0) {
        let vQuery = supabase.from("absa_tweets_v").select(selectColumnsWithPlatform);

        if (safeTopicFilter && safeAspectFilter) {
          vQuery = vQuery.or(`topic_key.ilike.%${safeTopicFilter}%,aspect.ilike.%${safeAspectFilter}%`);
        } else if (safeTopicFilter) {
          vQuery = vQuery.ilike("topic_key", `%${safeTopicFilter}%`);
        } else if (safeAspectFilter) {
          vQuery = vQuery.ilike("aspect", `%${safeAspectFilter}%`);
        }

        const res2 = await vQuery.order("tweeted_at", { ascending: false });
        let vIlike = res2.data as Array<Record<string, unknown>> | null;
        let vIlikeErr = res2.error;

        if (vIlikeErr && vIlikeErr.message?.toLowerCase().includes("does not exist")) {
          let fallbackQ = supabase.from("absa_tweets_v").select(selectColumnsLegacy);
          if (safeTopicFilter && safeAspectFilter) {
            fallbackQ = fallbackQ.or(`topic_key.ilike.%${safeTopicFilter}%,aspect.ilike.%${safeAspectFilter}%`);
          } else if (safeTopicFilter) {
            fallbackQ = fallbackQ.ilike("topic_key", `%${safeTopicFilter}%`);
          } else if (safeAspectFilter) {
            fallbackQ = fallbackQ.ilike("aspect", `%${safeAspectFilter}%`);
          }
          const fb = await fallbackQ.order("tweeted_at", { ascending: false });
          vIlike = fb.data as Array<Record<string, unknown>> | null;
          vIlikeErr = fb.error;
        }

        if (vIlikeErr) {
          if (vIlikeErr.message?.toLowerCase().includes("permission denied")) {
            permissionIssue = true;
          }
          if (vIlikeErr.message?.toLowerCase().includes("invalid api key")) {
            apiKeyIssue = true;
          }
        } else if (vIlike && vIlike.length > 0) {
          rows = mapRawToDBRows(vIlike);
        }
      }

      // 3. Fallback: query raw table absa_tweets
      if (!rows || rows.length === 0) {
        const res3 = await supabase
          .from("absa_tweets")
          .select('aspect, time, text, cleaned_text, "qwen2.5-3b-instruct_sentiment", qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, "user", platform, subreddit, context_url, rationale')
          .in("topic_key", candidateKeys)
          .order("time", { ascending: false });

        let tData = res3.data as Array<Record<string, unknown>> | null;
        let tErr = res3.error;

        if (tErr && tErr.message?.toLowerCase().includes("does not exist")) {
          const fb = await supabase
            .from("absa_tweets")
            .select('aspect, time, text, cleaned_text, "qwen2.5-3b-instruct_sentiment", qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, "user"')
            .in("topic_key", candidateKeys)
            .order("time", { ascending: false });
          tData = fb.data as Array<Record<string, unknown>> | null;
          tErr = fb.error;
        }

        if (tErr) {
          if (tErr.message?.toLowerCase().includes("permission denied")) {
            permissionIssue = true;
          }
          if (tErr.message?.toLowerCase().includes("invalid api key")) {
            apiKeyIssue = true;
          }
        } else if (tData && tData.length > 0) {
          rows = mapRawToDBRows(tData);
        }
      }

      // 4. Try raw table ILIKE fallback if still no rows
      if (!rows || rows.length === 0) {
        let tQuery = supabase
          .from("absa_tweets")
          .select('aspect, time, text, cleaned_text, "qwen2.5-3b-instruct_sentiment", qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, "user", platform, subreddit, context_url, rationale');

        if (safeTopicFilter && safeAspectFilter) {
          tQuery = tQuery.or(`topic_key.ilike.%${safeTopicFilter}%,aspect.ilike.%${safeAspectFilter}%`);
        } else if (safeTopicFilter) {
          tQuery = tQuery.ilike("topic_key", `%${safeTopicFilter}%`);
        } else if (safeAspectFilter) {
          tQuery = tQuery.ilike("aspect", `%${safeAspectFilter}%`);
        }

        const res4 = await tQuery.order("time", { ascending: false });
        let tIlike = res4.data as Array<Record<string, unknown>> | null;
        let tIlikeErr = res4.error;

        if (tIlikeErr && tIlikeErr.message?.toLowerCase().includes("does not exist")) {
          let fbQuery = supabase
            .from("absa_tweets")
            .select('aspect, time, text, cleaned_text, "qwen2.5-3b-instruct_sentiment", qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, "user"');

          if (safeTopicFilter && safeAspectFilter) {
            fbQuery = fbQuery.or(`topic_key.ilike.%${safeTopicFilter}%,aspect.ilike.%${safeAspectFilter}%`);
          } else if (safeTopicFilter) {
            fbQuery = fbQuery.ilike("topic_key", `%${safeTopicFilter}%`);
          } else if (safeAspectFilter) {
            fbQuery = fbQuery.ilike("aspect", `%${safeAspectFilter}%`);
          }
          const fb = await fbQuery.order("time", { ascending: false });
          tIlike = fb.data as Array<Record<string, unknown>> | null;
          tIlikeErr = fb.error;
        }

        if (tIlikeErr) {
          if (tIlikeErr.message?.toLowerCase().includes("permission denied")) {
            permissionIssue = true;
          }
          if (tIlikeErr.message?.toLowerCase().includes("invalid api key")) {
            apiKeyIssue = true;
          }
        } else if (tIlike && tIlike.length > 0) {
          rows = mapRawToDBRows(tIlike);
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
            "No posts found for this topic yet. Click 'FetchLayer Key' above and enter your FetchLayer API key to fetch and analyze fresh posts from X and Reddit!",
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
      platform: SocialPlatform;
      subreddit?: string;
      url?: string;
      rationale?: string;
    }

    const processedRows: ProcessedRow[] = rows.map((r) => {
      const p_pos = r.p_pos ?? 0;
      const p_neg = r.p_neg ?? 0;
      const p_neu = r.p_neu ?? 0;
      const confidence = Math.max(p_pos, p_neg, p_neu);
      const sentiment = (r.sentiment as SentimentLabel) || "neutral";
      const platform: SocialPlatform = (r.platform?.toLowerCase() === "reddit" ? "reddit" : "twitter");

      return {
        time: r.tweeted_at,
        sentiment,
        p_pos,
        p_neg,
        p_neu,
        confidence,
        handle: sanitizeHandle(r.handle),
        text: r.text,
        platform,
        subreddit: r.subreddit || undefined,
        url: r.context_url || undefined,
        rationale: r.rationale || undefined,
      };
    });

    // Compute platform breakdown
    let twCount = 0;
    let rdCount = 0;
    for (const row of processedRows) {
      if (row.platform === "reddit") {
        rdCount++;
      } else {
        twCount++;
      }
    }
    const platformBreakdown: PlatformBreakdown = {
      twitter: twCount,
      reddit: rdCount,
      total: processedRows.length,
    };

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
        platform: i.platform,
        subreddit: i.subreddit,
        url: i.url,
        rationale: i.rationale,
      }));

    const times = processedRows.map((t) => new Date(t.time).getTime());
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const days = Math.round((maxTime - minTime) / 86_400_000);

    // Resolve topic genre with metadata persistence
    let genre = classifyTopicGenre(topicKey, aspectDisplay);
    try {
      const { data: meta } = await supabase
        .from("topic_metadata")
        .select("genre")
        .eq("topic_key", topicKey)
        .maybeSingle();

      if (meta && meta.genre) {
        genre = meta.genre;
      } else {
        // Asynchronously persist detected genre into topic_metadata if table exists
        supabase
          .from("topic_metadata")
          .upsert({ topic_key: topicKey, genre }, { onConflict: "topic_key" })
          .then(
            () => {},
            () => {}
          );
      }
    } catch {
      // Gracefully fall back to classified genre if metadata table is not yet created
    }

    const response: AnalyzeResponse = {
      topic: rawTopic,
      aspect: aspectDisplay,
      genre,
      platformBreakdown,
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
