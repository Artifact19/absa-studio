import crypto from "crypto";

/**
 * Computes sha256 deduplication key.
 * - For Reddit: identical post titles/text crossposted across different subreddits or accounts
 *   are deduplicated based on normalized text content alone.
 * - For Twitter / X: deduplicated based on sha256(cleaned_text + '|' + user).
 */
export function computeDedupKey(cleanedText: string, user?: string, platform?: string): string {
  // Normalize text: collapse whitespace, strip common Reddit flairs and prefixes, decode HTML entities
  const normalizedText = (cleanedText || "")
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/, "") // remove leading flairs like [Discussion], [Megathread], [Leak]
    .replace(/^\([^\)]+\)\s*/, "") // remove leading flairs like (Spoiler)
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (platform === "reddit") {
    return crypto.createHash("sha256").update(`reddit|${normalizedText}`, "utf8").digest("hex");
  }

  const normalizedUser = (user || "unknown").toLowerCase().trim();
  const raw = `${normalizedText}|${normalizedUser}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}
