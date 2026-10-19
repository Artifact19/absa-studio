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
 * Sanitize the handle to /^[A-Za-z0-9_]{1,30}$/ before rendering; otherwise show 'unknown'.
 */
export function sanitizeHandle(handle: string | undefined | null): string {
  if (!handle || typeof handle !== "string") return "unknown";
  const trimmed = handle.replace(/^@/, "").trim();
  if (/^[A-Za-z0-9_]{1,30}$/.test(trimmed)) {
    return trimmed;
  }
  return "unknown";
}
