import { NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";

/**
 * GET /api/topics - Public-safe topic suggestions from public.topic_summary view
 */
export async function GET() {
  try {
    const supabase = sb();
    const { data, error } = await supabase
      .from("topic_summary")
      .select("topic_key, n, oldest, newest")
      .order("n", { ascending: false })
      .limit(20);

    if (error) {
      // If table/view does not exist yet or empty, return empty list gracefully
      return NextResponse.json({ topics: [] });
    }

    return NextResponse.json({ topics: data || [] });
  } catch {
    return NextResponse.json({ topics: [] });
  }
}
