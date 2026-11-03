import { NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { classifyTopicGenre } from "@/lib/genre";

/**
 * GET /api/topics - Public-safe topic suggestions enriched with genres
 */
export async function GET() {
  try {
    const supabase = sb();
    let rows: Array<{ topic_key: string; genre?: string; n: number; oldest?: string; newest?: string }> = [];

    // Try selecting including genre column
    const { data, error } = await supabase
      .from("topic_summary")
      .select("topic_key, genre, n, oldest, newest")
      .order("n", { ascending: false })
      .limit(30);

    if (error) {
      // Fallback if database migration hasn't been applied yet
      const { data: fallbackData } = await supabase
        .from("topic_summary")
        .select("topic_key, n, oldest, newest")
        .order("n", { ascending: false })
        .limit(30);
      rows = fallbackData || [];
    } else {
      rows = data || [];
    }

    const enriched = rows.map((r) => ({
      ...r,
      genre: r.genre || classifyTopicGenre(r.topic_key),
    }));

    return NextResponse.json({ topics: enriched });
  } catch (err: unknown) {
    return NextResponse.json({
      topics: [],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
