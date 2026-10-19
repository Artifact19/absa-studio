import { FetchLayerSearchResponse } from "./types";

/**
 * FetchLayer Twitter Search Adapter
 *
 * NOTE / TODO: Verify endpoints and schemas against https://fetchlayer.dev/dashboard docs.
 * Default endpoint based on production implementation:
 * POST https://api.fetchlayer.dev/twitter/search
 */

export interface NormalizedScrapedTweet {
  id: string;
  text: string;
  time: string;
  user: string;
}

export interface FetchLayerSearchOptions {
  query: string;
  count?: number;
  apiKey?: string;
  cursor?: string;
}

export async function fetchTweetsFromFetchLayer({
  query,
  count = 20,
  apiKey,
  cursor,
}: FetchLayerSearchOptions): Promise<{ tweets: NormalizedScrapedTweet[]; nextCursor: string | null }> {
  const token = apiKey || process.env.FETCHLAYER_API_KEY;
  if (!token || !token.trim()) {
    throw new Error("No FetchLayer API key provided. Add your FetchLayer API key or set FETCHLAYER_API_KEY.");
  }

  const baseUrl = (process.env.FETCHLAYER_BASE_URL || "https://api.fetchlayer.dev").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/twitter/search`;

  // Build query if simple keyword passed
  const formattedQuery = query.includes("-is:retweet") ? query : `"${query}" -is:retweet lang:en`;

  const payload: Record<string, unknown> = {
    query: formattedQuery,
    product: "Top",
    count: Math.min(count, 50),
  };
  if (cursor) {
    payload.cursor = cursor;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`FetchLayer API returned ${res.status}: ${errorText || res.statusText}`);
  }

  const data = (await res.json()) as FetchLayerSearchResponse;
  const rawList = data.tweets || data.results || data.data || [];

  const normalized: NormalizedScrapedTweet[] = [];
  for (const item of rawList) {
    const text = item.text || "";
    if (!text.trim()) continue;

    const id = String(item.id || Math.random().toString(36).substring(2));
    const time = item.createdAt || item.created_at || item.time || new Date().toISOString();
    const handle = item.author?.handle || item.author?.username || item.user?.handle || item.user?.username || "unknown";

    normalized.push({
      id,
      text,
      time,
      user: handle,
    });
  }

  const nextCursor = data.nextCursor || data.cursor || null;

  return {
    tweets: normalized,
    nextCursor,
  };
}
