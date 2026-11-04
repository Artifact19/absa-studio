/**
 * Text cleaning and normalization utilities according to §4.3 & §9
 */

/**
 * topic_key = lower(trim(topic)).replace(/\s+/g,' ')
 */
export function normalizeTopicKey(topic: string): string {
  if (!topic) return "";
  return topic.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * cleaned_text: strip URLs, collapse whitespace, remove leading RT @x:, keep emoji, keep @mentions as @user.
 */
export function cleanTweetText(text: string): string {
  if (!text || typeof text !== "string") return "";

  // Remove leading RT @handle:
  let cleaned = text.replace(/^RT\s+@[\w_]+:\s*/i, "");

  // Strip URLs (http / https)
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, "");

  // Normalize @mentions to @user
  cleaned = cleaned.replace(/(@[\w_]+[\s,]*)+/gi, "@user ");

  // Collapse multiple whitespaces and trim
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

/**
 * Sanitize handle before rendering (supports Twitter @handles & Reddit u/usernames with hyphens)
 */
export function sanitizeHandle(handle: string | undefined | null): string {
  if (!handle || typeof handle !== "string") return "unknown";
  const trimmed = handle.replace(/^[u@]\//, "").replace(/^[@u]/, "").trim();
  if (/^[A-Za-z0-9_-]{1,40}$/.test(trimmed)) {
    return trimmed;
  }
  return "unknown";
}

/**
 * Sanitizes input before interpolating into PostgREST filter expressions (.or, .ilike).
 * Strips PostgREST special control characters: () , . : " ' \ % and limits length.
 */
export function sanitizePostgrestFilter(input: string | undefined | null): string {
  if (!input || typeof input !== "string") return "";
  // Strip PostgREST operators & reserved chars: commas, parens, dots, quotes, percent
  return input
    .replace(/[(),.:"'\\%]/g, "")
    .trim()
    .slice(0, 80);
}
