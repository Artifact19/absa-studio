import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized } from "@/lib/auth";
import { AdminStats } from "@/lib/types";

export async function GET(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const supabase = sb();

    // 1. Total records and sentiment distribution
    let totalRecords: number | null = null;
    let countPos: number | null = null;
    let countNeg: number | null = null;
    let countNeu: number | null = null;

    const resTotal = await supabase
      .from("absa_tweets")
      .select("*", { count: "exact", head: true });

    if (resTotal.count !== null && resTotal.count !== undefined) {
      totalRecords = resTotal.count;
      const resPos = await supabase
        .from("absa_tweets")
        .select("*", { count: "exact", head: true })
        .eq("qwen2.5-3b-instruct_sentiment", "positive");
      countPos = resPos.count;

      const resNeg = await supabase
        .from("absa_tweets")
        .select("*", { count: "exact", head: true })
        .eq("qwen2.5-3b-instruct_sentiment", "negative");
      countNeg = resNeg.count;

      const resNeu = await supabase
        .from("absa_tweets")
        .select("*", { count: "exact", head: true })
        .eq("qwen2.5-3b-instruct_sentiment", "neutral");
      countNeu = resNeu.count;
    } else {
      // Fallback: try view absa_tweets_v
      const resV = await supabase
        .from("absa_tweets_v")
        .select("*", { count: "exact", head: true });
      totalRecords = resV.count;

      const resPos = await supabase
        .from("absa_tweets_v")
        .select("*", { count: "exact", head: true })
        .eq("sentiment", "positive");
      countPos = resPos.count;

      const resNeg = await supabase
        .from("absa_tweets_v")
        .select("*", { count: "exact", head: true })
        .eq("sentiment", "negative");
      countNeg = resNeg.count;

      const resNeu = await supabase
        .from("absa_tweets_v")
        .select("*", { count: "exact", head: true })
        .eq("sentiment", "neutral");
      countNeu = resNeu.count;
    }

    // 2. Total unique topics and time boundaries
    const { data: topicsData } = await supabase
      .from("topic_summary")
      .select("topic_key, oldest, newest");

    const totalTopics = topicsData ? topicsData.length : 0;

    let oldestRecord: string | null = null;
    let newestRecord: string | null = null;

    if (topicsData && topicsData.length > 0) {
      const oldDates = topicsData.map((t) => (t.oldest ? new Date(t.oldest).getTime() : Infinity));
      const newDates = topicsData.map((t) => (t.newest ? new Date(t.newest).getTime() : -Infinity));
      const minVal = Math.min(...oldDates);
      const maxVal = Math.max(...newDates);
      if (minVal !== Infinity) oldestRecord = new Date(minVal).toISOString();
      if (maxVal !== -Infinity) newestRecord = new Date(maxVal).toISOString();
    }

    // 3. Estimated database table size via RPC admin_table_size()
    let storageBytes = 0;
    try {
      const { data: sizeData, error: rpcErr } = await supabase.rpc("admin_table_size");
      if (!rpcErr && typeof sizeData === "number") {
        storageBytes = sizeData;
      }
    } catch {
      // Fallback estimate: 1 KB per tweet record if RPC unavailable
      storageBytes = (totalRecords || 0) * 1024;
    }

    const stats: AdminStats = {
      totalTopics,
      totalRecords: totalRecords || 0,
      sentimentCounts: {
        positive: countPos || 0,
        negative: countNeg || 0,
        neutral: countNeu || 0,
      },
      oldestRecord,
      newestRecord,
      storageBytes,
      storageLimitBytes: 500 * 1024 * 1024, // Supabase Free 500 MB
    };

    return NextResponse.json(stats, { headers: { "X-Robots-Tag": "noindex" } });
  } catch (err) {
    console.error("Admin stats query error:", err);
    return NextResponse.json({ error: "Failed to load admin stats" }, { status: 500 });
  }
}
