import { NextRequest, NextResponse } from "next/server";
import { sb } from "@/lib/supabase-server";
import { isRequestAuthorized } from "@/lib/auth";
import { hf } from "@/lib/hf";
import { HFClassifyResp } from "@/lib/types";

export async function POST(req: NextRequest) {
  if (!isRequestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const targetTopic = (body.topic || "").trim().toLowerCase();
    const supabase = sb();

    let query = supabase
      .from("absa_tweets")
      .select("id, topic_key, aspect, cleaned_text, text");

    if (targetTopic) {
      query = query.eq("topic_key", targetTopic);
    }

    const { data: rows, error } = await query;
    if (error || !rows) {
      return NextResponse.json({ error: "Failed to query database records" }, { status: 500 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ message: "No records found to reclassify", count: 0 });
    }

    // Group by target entity
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.aspect || r.topic_key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const BATCH_SIZE = 16;
    let updatedCount = 0;

    for (const [target, groupRows] of groups.entries()) {
      for (let i = 0; i < groupRows.length; i += BATCH_SIZE) {
        const batch = groupRows.slice(i, i + BATCH_SIZE);
        const texts = batch.map((b) => b.cleaned_text || b.text);

        try {
          const classified = await hf<HFClassifyResp>("/classify-batch", {
            texts,
            target,
          });

          for (let j = 0; j < batch.length; j++) {
            const item = classified.results[j];
            if (!item) continue;
            const row = batch[j];

            const { error: updateErr } = await supabase
              .from("absa_tweets")
              .update({
                "qwen2.5-3b-instruct_sentiment": item.label,
                qwen_prob_pos: item.prob_pos,
                qwen_prob_neg: item.prob_neg,
                qwen_prob_neu: item.prob_neu,
                rationale: item.rationale || null,
              })
              .eq("id", row.id);

            if (!updateErr) {
              updatedCount++;
            }
          }
        } catch (batchErr) {
          console.warn("Reclassification batch failed:", batchErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      totalRecords: rows.length,
      updatedRecords: updatedCount,
    });
  } catch (err: unknown) {
    console.error("Reclassify error:", err);
    return NextResponse.json({ error: "Reclassification failed" }, { status: 500 });
  }
}
