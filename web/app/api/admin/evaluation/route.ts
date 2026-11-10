import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized } from "@/lib/auth";
import { sanitizePostgrestFilter } from "@/lib/clean";
import { computeEvaluation, EvaluatedRow, EvaluationResults } from "@/lib/evaluation";
import { SentimentLabel } from "@/lib/types";

export async function GET(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const rawTopic = searchParams.get("topic")?.trim() || "";
    const rawSource = searchParams.get("source")?.trim() || "";

    const supabase = sb();

    let query = supabase
      .from("absa_tweets_v")
      .select("id, topic_key, aspect, sentiment, human_label, label_source, p_pos, p_neg, p_neu")
      .not("human_label", "is", null);

    if (rawTopic) {
      const safeTopic = sanitizePostgrestFilter(rawTopic).toLowerCase();
      if (safeTopic) {
        query = query.eq("topic_key", safeTopic);
      }
    }

    if (rawSource && ["random", "uncertain", "import"].includes(rawSource)) {
      query = query.eq("label_source", rawSource);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error("Evaluation fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const evaluatedRows: EvaluatedRow[] = (rows || []).map((r) => {
      const p_pos = r.p_pos ?? 0;
      const p_neg = r.p_neg ?? 0;
      const p_neu = r.p_neu ?? 0;
      const conf = Math.max(p_pos, p_neg, p_neu);

      return {
        id: String(r.id),
        topic_key: r.topic_key,
        aspect: r.aspect,
        human_label: r.human_label as SentimentLabel,
        model_label: (r.sentiment as SentimentLabel) || "neutral",
        label_source: r.label_source,
        confidence: conf,
        p_pos,
        p_neg,
        p_neu,
      };
    });

    const metrics = computeEvaluation(evaluatedRows);

    // Compute Topic-level breakdown for all topics with labeled rows
    const byTopicMap = new Map<string, EvaluatedRow[]>();
    evaluatedRows.forEach((r) => {
      const key = r.aspect || r.topic_key;
      const list = byTopicMap.get(key) || [];
      list.push(r);
      byTopicMap.set(key, list);
    });

    const topicBreakdown = Array.from(byTopicMap.entries()).map(([topic, tRows]) => {
      const tMetrics = computeEvaluation(tRows);
      return {
        topic,
        count: tRows.length,
        accuracy: tMetrics?.accuracy ?? 0,
        qwk: tMetrics?.kappaQuadratic ?? 0,
        macroF1: tMetrics?.macroF1 ?? 0,
        polarFlips: tMetrics?.polarFlipCount ?? 0,
      };
    }).sort((a, b) => b.count - a.count);

    // Compute Source-level breakdown (random vs uncertain vs import)
    const bySourceMap = new Map<string, EvaluatedRow[]>();
    evaluatedRows.forEach((r) => {
      const key = r.label_source || "manual";
      const list = bySourceMap.get(key) || [];
      list.push(r);
      bySourceMap.set(key, list);
    });

    const sourceBreakdown = Array.from(bySourceMap.entries()).map(([source, sRows]) => {
      const sMetrics = computeEvaluation(sRows);
      return {
        source,
        count: sRows.length,
        accuracy: sMetrics?.accuracy ?? 0,
        qwk: sMetrics?.kappaQuadratic ?? 0,
        macroF1: sMetrics?.macroF1 ?? 0,
      };
    });

    return NextResponse.json({
      metrics,
      topicBreakdown,
      sourceBreakdown,
      totalEvaluated: evaluatedRows.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal evaluation error";
    console.error("Evaluation API error:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
