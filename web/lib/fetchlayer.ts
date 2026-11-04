import { FetchLayerSearchResponse, FetchLayerRawPost, SocialPlatform } from "./types";

/**
 * FetchLayer Multi-Platform Adapter (X / Twitter + Reddit)
 * Queries live data across Twitter and Reddit using FetchLayer REST endpoints.
 */

export interface NormalizedScrapedPost {
  id: string;
  text: string;
  time: string;
  user: string;
  platform: SocialPlatform;
  subreddit?: string;
  url?: string;
}

export type NormalizedScrapedTweet = NormalizedScrapedPost;

export interface FetchLayerSearchOptions {
  query: string;
  count?: number;
  apiKey?: string;
  cursor?: string;
  platforms?: SocialPlatform[];
}

/**
 * Fetches posts from Twitter and Reddit in parallel.
 * Gracefully handles partial failures so if one platform is throttled,
 * the other platform's posts are still ingested.
 */
export async function fetchPostsFromFetchLayer({
  query,
  count = 40,
  apiKey,
  cursor,
  platforms = ["twitter", "reddit"],
}: FetchLayerSearchOptions): Promise<{
  posts: NormalizedScrapedPost[];
  twitterCount: number;
  redditCount: number;
  nextCursor: string | null;
}> {
  const token = apiKey || process.env.FETCHLAYER_API_KEY;
  if (!token || !token.trim()) {
    throw new Error("No FetchLayer API key provided. Add your FetchLayer API key or set FETCHLAYER_API_KEY.");
  }

  const baseUrl = (process.env.FETCHLAYER_BASE_URL || "https://api.fetchlayer.dev").replace(/\/+$/, "");

  // Allocate count evenly across requested platforms
  const targetPerPlatform = Math.max(5, Math.ceil(count / platforms.length));

  const fetchTwitter = async (): Promise<{ posts: NormalizedScrapedPost[]; cursor: string | null }> => {
    if (!platforms.includes("twitter")) return { posts: [], cursor: null };
    try {
      const formattedQuery = query.includes("-is:retweet") ? query : `"${query}" -is:retweet lang:en`;
      const payload: Record<string, unknown> = {
        query: formattedQuery,
        product: "Top",
        count: Math.min(targetPerPlatform, 50),
      };
      if (cursor) payload.cursor = cursor;

      const res = await fetch(`${baseUrl}/twitter/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`FetchLayer Twitter search status ${res.status}`);
        return { posts: [], cursor: null };
      }

      const data = (await res.json()) as FetchLayerSearchResponse;
      const rawList = data.tweets || data.results || data.data || [];
      const normalized: NormalizedScrapedPost[] = [];

      for (const item of rawList) {
        const text = (item.text || item.body || "").trim();
        if (!text) continue;

        const id = String(item.id || Math.random().toString(36).substring(2));
        const time = item.createdAt || item.created_at || item.time || new Date().toISOString();
        const handle =
          (typeof item.author === "string" ? item.author : item.author?.handle || item.author?.username) ||
          (typeof item.user === "string" ? item.user : item.user?.handle || item.user?.username) ||
          "x_user";

        normalized.push({
          id: `tw_${id}`,
          text,
          time,
          user: handle.replace(/^@/, ""),
          platform: "twitter",
          url: item.url || (handle !== "x_user" && id ? `https://x.com/${handle}/status/${id}` : undefined),
        });
      }

      return {
        posts: normalized,
        cursor: data.nextCursor || data.cursor || null,
      };
    } catch (err) {
      console.warn("FetchLayer Twitter fetch error:", err);
      return { posts: [], cursor: null };
    }
  };

  const fetchReddit = async (): Promise<{ posts: NormalizedScrapedPost[]; cursor: string | null }> => {
    if (!platforms.includes("reddit")) return { posts: [], cursor: null };
    try {
      const payload: Record<string, unknown> = {
        query: query.trim(),
        sort: "relevance",
        count: Math.min(targetPerPlatform, 50),
      };

      const res = await fetch(`${baseUrl}/reddit/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.warn(`FetchLayer Reddit search status ${res.status}`);
        return { posts: [], cursor: null };
      }

      const data = (await res.json()) as FetchLayerSearchResponse;
      const rawList = data.posts || data.results || data.data || data.tweets || [];
      const normalized: NormalizedScrapedPost[] = [];

      for (const item of rawList) {
        // Construct composite text from Reddit title and selftext/body
        let text = "";
        if (item.title && item.selftext) {
          text = `${item.title.trim()}: ${item.selftext.trim()}`;
        } else if (item.title) {
          text = item.title.trim();
        } else {
          text = (item.text || item.body || "").trim();
        }

        if (!text) continue;

        const id = String(item.id || Math.random().toString(36).substring(2));
        let time = new Date().toISOString();
        if (item.created_utc) {
          time = new Date(item.created_utc * 1000).toISOString();
        } else if (item.createdAt || item.created_at || item.time) {
          time = item.createdAt || item.created_at || item.time || time;
        }

        const authorName =
          typeof item.author === "string"
            ? item.author
            : item.author?.username || item.author?.name || "reddit_user";

        let subreddit = item.subreddit || item.subreddit_name_prefixed || "";
        subreddit = subreddit.replace(/^r\//i, "");

        const permalink = item.permalink
          ? (item.permalink.startsWith("http") ? item.permalink : `https://reddit.com${item.permalink}`)
          : item.url;

        normalized.push({
          id: `rd_${id}`,
          text,
          time,
          user: authorName.replace(/^u\//i, ""),
          platform: "reddit",
          subreddit: subreddit || undefined,
          url: permalink || undefined,
        });
      }

      return {
        posts: normalized,
        cursor: data.nextCursor || data.cursor || null,
      };
    } catch (err) {
      console.warn("FetchLayer Reddit fetch error:", err);
      return { posts: [], cursor: null };
    }
  };

  // Run Twitter and Reddit queries in parallel
  const [twResult, rdResult] = await Promise.all([fetchTwitter(), fetchReddit()]);

  // Interleave Twitter and Reddit results for balanced distribution
  const combined: NormalizedScrapedPost[] = [];
  const maxLen = Math.max(twResult.posts.length, rdResult.posts.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < twResult.posts.length) combined.push(twResult.posts[i]);
    if (i < rdResult.posts.length) combined.push(rdResult.posts[i]);
  }

  return {
    posts: combined,
    twitterCount: twResult.posts.length,
    redditCount: rdResult.posts.length,
    nextCursor: twResult.cursor || rdResult.cursor || null,
  };
}

/**
 * Backward compatibility wrapper for existing Twitter-only calls
 */
export async function fetchTweetsFromFetchLayer(
  options: FetchLayerSearchOptions
): Promise<{ tweets: NormalizedScrapedPost[]; nextCursor: string | null }> {
  const result = await fetchPostsFromFetchLayer(options);
  return {
    tweets: result.posts,
    nextCursor: result.nextCursor,
  };
}
