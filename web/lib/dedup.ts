import crypto from "crypto";

/**
 * Computes sha256(cleaned_text.toLowerCase() + '|' + user.toLowerCase()) in hex
 * per §4.3 of the ABSA Studio specification.
 */
export function computeDedupKey(cleanedText: string, user: string): string {
  const normalizedText = (cleanedText || "").toLowerCase().trim();
  const normalizedUser = (user || "unknown").toLowerCase().trim();
  const raw = `${normalizedText}|${normalizedUser}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
