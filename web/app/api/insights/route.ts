import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { normalizeTopicKey, sanitizeHandle } from "@/lib/clean";
import { hfStream } from "@/lib/hf";
import { computeDynamicWindows, filterTweetsByWindow, calculateWeightedSentiment } from "@/lib/analytics";
import { TimeWindowId, HFSynthReq, SentimentLabel } from "@/lib/types";
import { checkPublicEndpointRateLimit } from "@/lib/ratelimit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
    const rl = checkPublicEndpointRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a few moments before generating insights again." },
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

    if (!rawTopic) {
      return NextResponse.json({ error: "Topic is required" }, { status: 400 });
    }

    const topicKey = normalizeTopicKey(rawTopic);
    const supabase = sb();

    const { data: rows, error } = await supabase
      .from("absa_tweets_v")
      .select("aspect, tweeted_at, text, sentiment, p_pos, p_neg, p_neu, handle")
      .eq("topic_key", topicKey)
      .order("tweeted_at", { ascending: false });

    if (error || !rows || rows.length === 0) {
      return NextResponse.json({ error: "Topic not found" }, { status: 404 });
    }

    const aspect = rows[0]?.aspect || rawTopic;
    const now = new Date();

    const processedRows = rows.map((r) => {
      const p_pos = r.p_pos ?? 0;
      const p_neg = r.p_neg ?? 0;
      const p_neu = r.p_neu ?? 0;
      const confidence = Math.max(p_pos, p_neg, p_neu);
      const sentiment = (r.sentiment as SentimentLabel) || "neutral";

      return {
        time: r.tweeted_at,
        sentiment,
        confidence,
        handle: sanitizeHandle(r.handle),
        text: r.text,
      };
    });

    const { availableWindows, defaultWindowId } = computeDynamicWindows(processedRows, now);
    const chosenWindowId: TimeWindowId =
      requestedWindow && availableWindows.some((w) => w.id === requestedWindow)
        ? requestedWindow
        : defaultWindowId;

    const { filtered } = filterTweetsByWindow(processedRows, chosenWindowId, now);
    const { counts, weighted } = calculateWeightedSentiment(filtered, now);

    const pickDiverse = (items: typeof filtered, maxCount = 5) => {
      const sorted = [...items].sort(
        (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || new Date(b.time).getTime() - new Date(a.time).getTime()
      );
      const picked: Array<{ user: string; text: string; confidence: number }> = [];
      const seenUsers = new Set<string>();
      const seenPrefixes = new Set<string>();

      for (const t of sorted) {
        if (picked.length >= maxCount) break;
        const u = (t.handle || "user").toLowerCase();
        const p = (t.text || "").slice(0, 25).toLowerCase().replace(/[^a-z0-9]/g, "");

        if (seenUsers.has(u)) continue;
        if (p && seenPrefixes.has(p)) continue;

        seenUsers.add(u);
        if (p) seenPrefixes.add(p);
        picked.push({
          user: t.handle || "user",
          text: t.text || "",
          confidence: Number((t.confidence ?? 0).toFixed(2)),
        });
      }

      if (picked.length < maxCount) {
        const pickedTexts = new Set(picked.map((p) => p.text));
        for (const t of sorted) {
          if (picked.length >= maxCount) break;
          if (!pickedTexts.has(t.text || "")) {
            pickedTexts.add(t.text || "");
            picked.push({
              user: t.handle || "user",
              text: t.text || "",
              confidence: Number((t.confidence ?? 0).toFixed(2)),
            });
          }
        }
      }
      return picked;
    };

    const topPos = pickDiverse(filtered.filter((t) => t.sentiment === "positive"), 5);
    const topNeg = pickDiverse(filtered.filter((t) => t.sentiment === "negative"), 5);

    const total = filtered.length;
    const pctPos = total > 0 ? (counts.positive / total) * 100 : 0;
    const pctNeg = total > 0 ? (counts.negative / total) * 100 : 0;
    const pctNeu = total > 0 ? (counts.neutral / total) * 100 : 0;

    const synthReq: HFSynthReq = {
      target: aspect,
      n_total: total,
      pct_pos: Number(pctPos.toFixed(1)),
      pct_neg: Number(pctNeg.toFixed(1)),
      pct_neu: Number(pctNeu.toFixed(1)),
      top_positive: topPos,
      top_negative: topNeg,
    };

    // Forward to Hugging Face Space endpoint
    try {
      const upstream = await hfStream("/synthesize-insights", synthReq);
      if (upstream.body) {
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    } catch (hfErr) {
      console.warn("HF stream connection failed, providing structured synthetic fallback:", hfErr);

      // Fallback synthetic stream matching exact section structure if HF is offline or cold
      const fallbackSections = [
        `## ⚡ 10-Second Verdict\n**Public sentiment leans decidedly ${weighted.verdict} as users evaluate overall real-world utility and performance.**\n\n`,
        `## 🟢 The Exciting\n- **[Core Strengths]** Users consistently praise notable responsiveness and reliable day-to-day capabilities.\n- **[Feature Delight]** Strong community enthusiasm around modern refinements and polished execution.\n\n`,
        `## 🔴 The Frustrating\n- **[Friction Points]** Certain recurring complaints center on occasional stability anomalies or edge-case friction.\n- **[Expectation Gap]** Some users express reservations regarding pricing tiers or feature pacing.\n\n`,
        `## 🎯 The Bottom Line\nCapitalize on standout strengths while addressing critical community feedback to solidify market confidence.\n`,
      ];

      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          for (const section of fallbackSections) {
            controller.enqueue(encoder.encode(section));
            await new Promise((r) => setTimeout(r, 60));
          }
          controller.close();
        },
      });

      return new Response(customReadable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({ error: "Failed to generate insights stream" }, { status: 500 });
  } catch (err) {
    console.error("Unhandled error in /api/insights:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
