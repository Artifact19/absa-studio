import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized, verifyCsrfOrigin } from "@/lib/auth";
import { normalizeTopicKey, cleanTweetText } from "@/lib/clean";
import { computeDedupKey } from "@/lib/dedup";
import { fetchTweetsFromFetchLayer } from "@/lib/fetchlayer";
import { hf } from "@/lib/hf";
import { HFClassifyResp, HFExtractResp } from "@/lib/types";

export async function POST(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!verifyCsrfOrigin(req)) {
    return NextResponse.json({ error: "CSRF verification failed" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const query = (body.query || "").trim();
  const countToFetch = Math.min(500, Math.max(1, parseInt(body.tweetCount || "100", 10)));
  const topicOverride = (body.topicOverride || "").trim();
  const customKey = body.fetchlayerKey ? String(body.fetchlayerKey).trim() : undefined;

  if (!query) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  const topicKey = normalizeTopicKey(topicOverride || query);
  const encoder = new TextEncoder();

  // Create streaming NDJSON response
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        sendEvent({
          stage: "initializing",
          message: `Starting scrape for "${query}" (target: ${countToFetch} tweets)`,
          done: 0,
          total: countToFetch,
        });

        // 1. Fetch tweets from FetchLayer with pagination
        const allFetched = [];
        let cursor: string | undefined = undefined;
        let fetchDone = false;

        sendEvent({
          stage: "fetching",
          message: "Querying FetchLayer Twitter search API...",
          done: 0,
          total: countToFetch,
        });

        while (allFetched.length < countToFetch && !fetchDone) {
          const fetchBatchSize = Math.min(50, countToFetch - allFetched.length);
          const result = await fetchTweetsFromFetchLayer({
            query,
            count: fetchBatchSize,
            apiKey: customKey,
            cursor,
          });

          if (!result.tweets || result.tweets.length === 0) {
            fetchDone = true;
            break;
          }

          allFetched.push(...result.tweets);
          cursor = result.nextCursor || undefined;

          sendEvent({
            stage: "fetching",
            message: `Fetched ${allFetched.length} of ${countToFetch} tweets...`,
            done: Math.min(allFetched.length, countToFetch),
            total: countToFetch,
          });

          if (!cursor) {
            fetchDone = true;
          }
        }

        if (allFetched.length === 0) {
          sendEvent({
            stage: "error",
            message: "No tweets found for this search query.",
            done: 0,
            total: countToFetch,
          });
          controller.close();
          return;
        }

        // 2. Text cleaning and deduplication
        sendEvent({
          stage: "cleaning",
          message: "Cleaning text and computing SHA-256 deduplication signatures...",
          done: allFetched.length,
          total: allFetched.length,
        });

        const preprocessed = allFetched
          .map((t) => {
            const cleaned = cleanTweetText(t.text);
            const dedupKey = computeDedupKey(cleaned, t.user);
            return { raw: t, cleaned, dedupKey };
          })
          .filter((t) => t.cleaned.length > 0);

        // Internal deduplication in this batch
        const uniqueInBatch = new Map<string, (typeof preprocessed)[0]>();
        for (const item of preprocessed) {
          if (!uniqueInBatch.has(item.dedupKey)) {
            uniqueInBatch.set(item.dedupKey, item);
          }
        }
        const candidates = Array.from(uniqueInBatch.values());

        // Check against existing keys in Supabase
        const supabase = sb();
        const candidateKeys = candidates.map((c) => c.dedupKey);

        const { data: existingRows } = await supabase
          .from("absa_tweets")
          .select("dedup_key")
          .eq("topic_key", topicKey)
          .in("dedup_key", candidateKeys);

        const existingKeySet = new Set((existingRows || []).map((r) => r.dedup_key));
        const unseenCandidates = candidates.filter((c) => !existingKeySet.has(c.dedupKey));

        const duplicateCount = candidates.length - unseenCandidates.length;

        sendEvent({
          stage: "deduplicating",
          message: `Identified ${unseenCandidates.length} new unseen tweets (${duplicateCount} existing duplicates dropped)`,
          done: candidates.length,
          total: candidates.length,
        });

        if (unseenCandidates.length === 0) {
          sendEvent({
            stage: "completed",
            message: "All fetched tweets already exist in database (zero new rows needed).",
            done: countToFetch,
            total: countToFetch,
            inserted: 0,
            duplicates: duplicateCount,
          });
          controller.close();
          return;
        }

        // 3. Extract aspect entity with HF /extract-target if needed
        let aspectDisplay = topicOverride || query;
        try {
          const ext = await hf<HFExtractResp>("/extract-target", { text: aspectDisplay });
          if (ext && ext.entity) {
            aspectDisplay = ext.entity;
          }
        } catch (extErr) {
          console.warn("Target extraction fallback to query:", extErr);
        }

        // 4. Classify in chunks of 16 using HF Space
        const batchSize = 16;
        const totalToClassify = unseenCandidates.length;
        const rowsToInsert = [];

        for (let i = 0; i < totalToClassify; i += batchSize) {
          const batch = unseenCandidates.slice(i, i + batchSize);
          const texts = batch.map((b) => b.cleaned);

          sendEvent({
            stage: "classifying",
            message: `Classifying batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(totalToClassify / batchSize)} with Qwen2.5-3B...`,
            done: i,
            total: totalToClassify,
          });

          const classified = await hf<HFClassifyResp>("/classify-batch", {
            texts,
            target: aspectDisplay,
          });

          for (let j = 0; j < batch.length; j++) {
            const item = classified.results[j];
            if (!item) continue;
            const cand = batch[j];

            rowsToInsert.push({
              topic_key: topicKey,
              aspect: aspectDisplay,
              user: cand.raw.user,
              time: new Date(cand.raw.time).toISOString(),
              text: cand.raw.text,
              cleaned_text: cand.cleaned,
              dedup_key: cand.dedupKey,
              "qwen2.5-3b-instruct_sentiment": item.label,
              qwen_prob_pos: item.prob_pos,
              qwen_prob_neg: item.prob_neg,
              qwen_prob_neu: item.prob_neu,
            });
          }
        }

        // 5. Upsert into Supabase with ON CONFLICT DO NOTHING
        sendEvent({
          stage: "upserting",
          message: `Upserting ${rowsToInsert.length} classified records into Supabase...`,
          done: rowsToInsert.length,
          total: totalToClassify,
        });

        const { error: upsertErr } = await supabase
          .from("absa_tweets")
          .upsert(rowsToInsert, { onConflict: "topic_key,dedup_key", ignoreDuplicates: true });

        if (upsertErr) {
          throw upsertErr;
        }

        sendEvent({
          stage: "completed",
          message: `Successfully scraped, classified, and saved ${rowsToInsert.length} tweets!`,
          done: countToFetch,
          total: countToFetch,
          inserted: rowsToInsert.length,
          duplicates: duplicateCount,
        });

        controller.close();
      } catch (err: unknown) {
        console.error("Admin scrape pipeline error:", err);
        const errMsg = err instanceof Error ? err.message : "Scrape pipeline failed";
        sendEvent({
          stage: "error",
          message: errMsg,
          done: 0,
          total: countToFetch,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
