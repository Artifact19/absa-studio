/**
 * ABSA Studio - Human Label Import Script
 * Imports ground truth annotations from CSV into Supabase absa_tweets table.
 * Sets label_source = 'import'.
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load .env.local without third-party dependencies
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

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in web/.env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// Basic CSV parser that handles quotes and newlines
function parseCSV(text: string): Record<string, string>[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "\r" || ch === "\n") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  if (lines.length < 2) return [];

  // Parse header
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          q = !q;
        }
      } else if (c === "," && !q) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += c;
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = parseRow(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx] || "";
    });
    rows.push(row);
  }

  return rows;
}

export async function importLabels(csvPathArg?: string) {
  const targetFile = csvPathArg
    ? path.resolve(csvPathArg)
    : path.resolve(__dirname, "../../data/gta6_annotated.csv");

  if (!fs.existsSync(targetFile)) {
    console.error(`CSV file not found at: ${targetFile}`);
    process.exit(1);
  }

  console.log(`Reading annotations from: ${targetFile}`);
  const content = fs.readFileSync(targetFile, "utf-8");
  const records = parseCSV(content);

  console.log(`Parsed ${records.length} records from CSV.`);

  const validLabels = new Set(["positive", "negative", "neutral"]);
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const rec of records) {
    const rawLabel = (rec.ground_truth || rec.human_label || rec.label || "").toLowerCase().trim();
    if (!rawLabel || !validLabels.has(rawLabel)) {
      skipped++;
      continue;
    }

    const id = rec.id?.trim();
    const cleanedText = rec.cleaned_text?.trim() || rec.text?.trim();

    let matched = false;

    // Try update by id first if valid
    if (id && id.length > 5) {
      const { data, error } = await supabase
        .from("absa_tweets")
        .update({
          human_label: rawLabel,
          label_source: "import",
          labeled_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id");

      if (!error && data && data.length > 0) {
        matched = true;
        updated++;
      }
    }

    // Fallback: match by cleaned_text and aspect
    if (!matched && cleanedText) {
      const aspect = rec.aspect?.trim() || "GTA 6";
      const { data, error } = await supabase
        .from("absa_tweets")
        .update({
          human_label: rawLabel,
          label_source: "import",
          labeled_at: new Date().toISOString(),
        })
        .eq("aspect", aspect)
        .eq("cleaned_text", cleanedText)
        .select("id");

      if (!error && data && data.length > 0) {
        matched = true;
        updated += data.length;
      }
    }

    if (!matched) {
      failed++;
    }
  }

  console.log(`Import Complete!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (no label): ${skipped}`);
  console.log(`  Not found in DB: ${failed}`);
}

if (require.main === module) {
  const filePath = process.argv[2];
  importLabels(filePath).catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
}

