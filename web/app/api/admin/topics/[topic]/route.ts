import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized, verifyCsrfOrigin } from "@/lib/auth";
import { normalizeTopicKey } from "@/lib/clean";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ topic: string }> }
) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!verifyCsrfOrigin(req)) {
    return NextResponse.json({ error: "CSRF verification failed" }, { status: 403 });
  }

  try {
    const { topic: rawTopic } = await params;
    const topicKey = normalizeTopicKey(decodeURIComponent(rawTopic));

    const { searchParams } = new URL(req.url);
    const olderThanDays = searchParams.get("olderThanDays");

    const supabase = sb();
    let query = supabase.from("absa_tweets").delete({ count: "exact" });

    if (olderThanDays) {
      const days = parseInt(olderThanDays, 10);
      if (!isNaN(days) && days > 0) {
        const cutoffDate = new Date(Date.now() - days * 86_400_000).toISOString();
        if (topicKey && topicKey !== "all") {
          query = query.eq("topic_key", topicKey).lt("time", cutoffDate);
        } else {
          query = query.lt("time", cutoffDate);
        }
      }
    } else {
      if (!topicKey) {
        return NextResponse.json({ error: "Topic is required" }, { status: 400 });
      }
      query = query.eq("topic_key", topicKey);
    }

    const { count, error } = await query;

    if (error) {
      console.error("Purge error:", error);
      return NextResponse.json({ error: "Failed to delete topic records" }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        topic: topicKey,
        deleted: count || 0,
      },
      { headers: { "X-Robots-Tag": "noindex" } }
    );
  } catch (err) {
    console.error("Unhandled error in delete topic:", err);
    return NextResponse.json({ error: "Failed to purge topic" }, { status: 500 });
  }
}
