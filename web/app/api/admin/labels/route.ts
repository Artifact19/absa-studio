import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized } from "@/lib/auth";
import { sanitizePostgrestFilter } from "@/lib/clean";

interface UnlabeledRow {
  id: string;
  topic_key: string;
  aspect: string;
  cleaned_text?: string;
  text: string;
  user: string;
  time: string;
  platform?: string;
  subreddit?: string;
  qwen_prob_pos?: number;
  qwen_prob_neg?: number;
  qwen_prob_neu?: number;
  "qwen2.5-3b-instruct_sentiment"?: string;
  rationale?: string;
  human_label?: string;
  label_source?: string;
}

export async function GET(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const isExport = searchParams.get("export") === "csv";
  const rawTopic = searchParams.get("topic")?.trim() || "";
  const mode = searchParams.get("mode") === "uncertain" ? "uncertain" : "random";
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

  const supabase = sb();

  // Export mode: CSV of human-labeled rows
  if (isExport) {
    let exportQuery = supabase
      .from("absa_tweets")
      .select("id, aspect, cleaned_text, text, human_label, label_source, qwen2.5-3b-instruct_sentiment")
      .not("human_label", "is", null);

    if (rawTopic) {
      const safeTopic = sanitizePostgrestFilter(rawTopic).toLowerCase();
      if (safeTopic) {
        exportQuery = exportQuery.eq("topic_key", safeTopic);
      }
    }

    const { data: rows, error } = await exportQuery;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const headers = ["id", "aspect", "cleaned_text", "human_label", "label_source", "qwen2.5-3b-instruct_sentiment"];
    const escapeCsv = (val: unknown) => {
      if (val === null || val === undefined) return "";
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvLines = [
      headers.join(","),
      ...((rows as unknown as UnlabeledRow[]) || []).map((r) =>
        [
          r.id,
          escapeCsv(r.aspect || ""),
          escapeCsv(r.cleaned_text || r.text || ""),
          r.human_label || "",
          r.label_source || "",
          r["qwen2.5-3b-instruct_sentiment"] || "",
        ].join(",")
      ),
    ];

    return new Response(csvLines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="human_labeled_dataset.csv"',
      },
    });
  }

  // Label queue retrieval mode
  try {
    let unlabQuery = supabase
      .from("absa_tweets")
      .select("id, topic_key, aspect, cleaned_text, text, user, time, platform, subreddit, qwen_prob_pos, qwen_prob_neg, qwen_prob_neu, qwen2.5-3b-instruct_sentiment, rationale, human_label")
      .is("human_label", null)
      .limit(2000);

    if (rawTopic) {
      const safeTopic = sanitizePostgrestFilter(rawTopic).toLowerCase();
      if (safeTopic) {
        unlabQuery = unlabQuery.eq("topic_key", safeTopic);
      }
    }

    const [{ data: pool, error: poolErr }, { count: totalLabeled }, { count: totalUnlabeled }] = await Promise.all([
      unlabQuery,
      supabase
        .from("absa_tweets")
        .select("id", { count: "exact", head: true })
        .not("human_label", "is", null)
        .then((res) => ({ count: res.count || 0 })),
      supabase
        .from("absa_tweets")
        .select("id", { count: "exact", head: true })
        .is("human_label", null)
        .then((res) => ({ count: res.count || 0 })),
    ]);

    if (poolErr) {
      return NextResponse.json({ error: poolErr.message }, { status: 500 });
    }

    const typedPool = (pool as unknown as UnlabeledRow[]) || [];
    const sampled = typedPool.slice();

    if (mode === "uncertain") {
      // Sort by lowest model confidence max(p)
      sampled.sort((a, b) => {
        const confA = Math.max(a.qwen_prob_pos || 0, a.qwen_prob_neg || 0, a.qwen_prob_neu || 0);
        const confB = Math.max(b.qwen_prob_pos || 0, b.qwen_prob_neg || 0, b.qwen_prob_neu || 0);
        return confA - confB;
      });
    } else {
      // Random shuffle (Fisher-Yates)
      for (let i = sampled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sampled[i], sampled[j]] = [sampled[j], sampled[i]];
      }
    }

    const items = sampled.slice(0, limit).map((r) => ({
      id: r.id,
      topic_key: r.topic_key,
      aspect: r.aspect,
      text: r.text,
      cleaned_text: r.cleaned_text || r.text,
      user: r.user,
      time: r.time,
      platform: r.platform || "twitter",
      subreddit: r.subreddit,
      // Store model predictions to reveal after user labels
      model_label: r["qwen2.5-3b-instruct_sentiment"],
      confidence: Math.max(r.qwen_prob_pos || 0, r.qwen_prob_neg || 0, r.qwen_prob_neu || 0),
      p_pos: r.qwen_prob_pos,
      p_neg: r.qwen_prob_neg,
      p_neu: r.qwen_prob_neu,
      rationale: r.rationale,
    }));

    return NextResponse.json({
      items,
      totalLabeled: totalLabeled || 0,
      totalUnlabeled: totalUnlabeled || 0,
      mode,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Something went wrong";
    console.error("Error in /api/admin/labels GET:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, label, source } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
    }

    if (!["positive", "negative", "neutral"].includes(label)) {
      return NextResponse.json({ error: "Label must be positive, negative, or neutral" }, { status: 400 });
    }

    const validSource = ["random", "uncertain", "import"].includes(source) ? source : "random";

    const supabase = sb();
    const { error } = await supabase
      .from("absa_tweets")
      .update({
        human_label: label,
        label_source: validSource,
        labeled_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id, label, source: validSource });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Something went wrong";
    console.error("Error in /api/admin/labels POST:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
