import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized } from "@/lib/auth";
import { AdminTweet, SentimentLabel } from "@/lib/types";

export async function GET(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get("topic")?.trim() || "";
    const sentiment = searchParams.get("sentiment")?.trim() || "";
    const query = searchParams.get("q")?.trim() || "";
    const sort = searchParams.get("sort")?.trim() || "time.desc";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || "50", 10)));

    const supabase = sb();
    let dbQuery = supabase.from("absa_tweets_v").select("*", { count: "exact" });

    // Filter by topic
    if (topic) {
      dbQuery = dbQuery.eq("topic_key", topic.toLowerCase());
    }

    // Filter by sentiment
    if (sentiment && ["positive", "negative", "neutral"].includes(sentiment)) {
      dbQuery = dbQuery.eq("sentiment", sentiment);
    }

    // Filter by text search (ilike)
    if (query) {
      dbQuery = dbQuery.or(`text.ilike.%${query}%,cleaned_text.ilike.%${query}%,handle.ilike.%${query}%`);
    }

    // Sort order
    const [sortField, sortDirection] = sort.split(".");
    const ascending = sortDirection === "asc";

    switch (sortField) {
      case "time":
        dbQuery = dbQuery.order("tweeted_at", { ascending });
        break;
      case "user":
        dbQuery = dbQuery.order("handle", { ascending });
        break;
      case "sentiment":
        dbQuery = dbQuery.order("sentiment", { ascending });
        break;
      case "confidence":
        // Order by max probability approximation
        dbQuery = dbQuery.order("p_pos", { ascending });
        break;
      default:
        dbQuery = dbQuery.order("tweeted_at", { ascending: false });
        break;
    }

    // Server-side pagination
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;
    dbQuery = dbQuery.range(fromIndex, toIndex);

    const { data: rows, count: totalCount, error } = await dbQuery;

    if (error) {
      console.error("Tweets query error:", error);
      return NextResponse.json({ error: "Failed to fetch tweets" }, { status: 500 });
    }

    const tweets: AdminTweet[] = (rows || []).map((r) => {
      const p_pos = r.p_pos ?? 0;
      const p_neg = r.p_neg ?? 0;
      const p_neu = r.p_neu ?? 0;
      const confidence = Math.max(p_pos, p_neg, p_neu);

      return {
        id: r.id,
        topic_key: r.topic_key,
        aspect: r.aspect,
        handle: r.handle || "unknown",
        tweeted_at: r.tweeted_at,
        text: r.text,
        cleaned_text: r.cleaned_text,
        sentiment: (r.sentiment as SentimentLabel) || "neutral",
        p_pos,
        p_neg,
        p_neu,
        confidence: Number(confidence.toFixed(3)),
        created_at: r.created_at,
      };
    });

    return NextResponse.json(
      {
        tweets,
        total: totalCount || 0,
        page,
        pageSize,
        totalPages: Math.ceil((totalCount || 0) / pageSize),
      },
      { headers: { "X-Robots-Tag": "noindex" } }
    );
  } catch (err) {
    console.error("Unhandled error in /api/admin/tweets:", err);
    return NextResponse.json({ error: "Failed to load tweets" }, { status: 500 });
  }
}
