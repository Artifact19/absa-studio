/**
 * ABSA Studio - Database Re-classifier Pipeline
 * Re-runs existing database records through the Hugging Face Qwen2.5-3B CoT model
 * and updates sentiment, confidence probabilities, and rationales in Supabase.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Read .env.local without third-party dependencies
const envPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hfBaseUrl = (process.env.HF_SPACE_URL || "").replace(/\/+$/, "");
const hfSecret = process.env.HF_API_SECRET || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (!hfBaseUrl) {
  console.error("Missing HF_SPACE_URL in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface HFClassifyItem {
  label: "positive" | "negative" | "neutral";
  prob_pos: number;
  prob_neg: number;
  prob_neu: number;
  confidence: number;
  rationale?: string;
}

interface HFClassifyResp {
  results: HFClassifyItem[];
}

async function classifyBatch(texts: string[], target: string): Promise<HFClassifyItem[]> {
  const res = await fetch(`${hfBaseUrl}/classify-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": hfSecret,
    },
    body: JSON.stringify({ texts, target }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HF Space returned status ${res.status}: ${txt}`);
  }

  const data = (await res.json()) as HFClassifyResp;
  return data.results || [];
}

export async function reclassifyTopic(topicKeyFilter?: string) {
  console.log(`Starting reclassification pipeline...`);
  console.log(`Target Space: ${hfBaseUrl}`);

  // 1. Fetch records to reclassify (including dedup_key for unique targeting)
  let query = supabase
    .from("absa_tweets")
    .select("id, dedup_key, topic_key, aspect, cleaned_text, text");

  if (topicKeyFilter) {
    query = query.eq("topic_key", topicKeyFilter.toLowerCase().trim());
  }

  const { data: rows, error } = await query;
  if (error || !rows) {
    console.error("Failed to query records:", error);
    return;
  }

  console.log(`Found ${rows.length} records to process.`);

  // 2. Group by topic/aspect for accurate target-oriented ABSA
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.aspect || r.topic_key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const BATCH_SIZE = 16;
  let totalUpdated = 0;

  for (const [target, groupRows] of groups.entries()) {
    console.log(`\nProcessing topic "${target}" (${groupRows.length} records)...`);

    for (let i = 0; i < groupRows.length; i += BATCH_SIZE) {
      const batch = groupRows.slice(i, i + BATCH_SIZE);
      const texts = batch.map((b) => b.cleaned_text || b.text);

      try {
        console.log(`  Classifying batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} posts)...`);
        const results = await classifyBatch(texts, target);

        for (let j = 0; j < batch.length; j++) {
          const item = results[j];
          if (!item) continue;
          const row = batch[j];

          // Target update by (topic_key, dedup_key) unique constraint or id
          let updateQuery = supabase
            .from("absa_tweets")
            .update({
              "qwen2.5-3b-instruct_sentiment": item.label,
              qwen_prob_pos: item.prob_pos,
              qwen_prob_neg: item.prob_neg,
              qwen_prob_neu: item.prob_neu,
              rationale: item.rationale || null,
            });

          if (row.dedup_key) {
            updateQuery = updateQuery.eq("topic_key", row.topic_key).eq("dedup_key", row.dedup_key);
          } else {
            updateQuery = updateQuery.eq("id", row.id);
          }

          let { error: updateErr } = await updateQuery;

          if (updateErr && updateErr.message?.includes("rationale")) {
            // Fallback for legacy schema without rationale column
            let fbQuery = supabase
              .from("absa_tweets")
              .update({
                "qwen2.5-3b-instruct_sentiment": item.label,
                qwen_prob_pos: item.prob_pos,
                qwen_prob_neg: item.prob_neg,
                qwen_prob_neu: item.prob_neu,
              });

            if (row.dedup_key) {
              fbQuery = fbQuery.eq("topic_key", row.topic_key).eq("dedup_key", row.dedup_key);
            } else {
              fbQuery = fbQuery.eq("id", row.id);
            }

            const fallback = await fbQuery;
            updateErr = fallback.error;
          }

          if (updateErr) {
            console.warn(`    Failed to update row:`, updateErr.message);
          } else {
            totalUpdated++;
          }
        }
      } catch (batchErr) {
        console.error(`    Classification error in batch:`, batchErr);
      }
    }
  }

  console.log(`\nReclassification complete! Successfully updated ${totalUpdated} records in Supabase with CoT model.`);
}

const targetTopic = process.argv[2];
reclassifyTopic(targetTopic);
