import { SentimentLabel, TimeWindowId, AvailableWindow, ActiveWindowInfo, VelocityData } from "./types";

export const LAMBDA = Math.LN2 / 14;

export const weight = (tweetTime: Date, now = new Date()): number => {
  const ageDays = Math.max(0, (now.getTime() - tweetTime.getTime()) / 86_400_000);
  return Math.exp(-LAMBDA * ageDays);
};

export interface RawTweetItem {
  time: string | Date;
  sentiment: SentimentLabel;
  confidence?: number;
  handle?: string;
  text?: string;
}

/**
 * Formats date range according to §7.1:
 * "All Time: Oct 14, 2025 – Oct 19, 2026 (370 days)"
 * using Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'})
 * and days = round((max-min)/86400000).
 */
export function formatAllTimeLabel(oldestDate: Date, newestDate: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const oldestStr = formatter.format(oldestDate);
  const newestStr = formatter.format(newestDate);
  const diffDays = Math.round((newestDate.getTime() - oldestDate.getTime()) / 86_400_000);
  return `All Time: ${oldestStr} – ${newestStr} (${diffDays} days)`;
}

export interface WindowFilterResult {
  availableWindows: AvailableWindow[];
  defaultWindowId: TimeWindowId;
}

/**
 * Computes dynamic temporal windows per §7.1.
 */
export function computeDynamicWindows(
  tweets: RawTweetItem[],
  now = new Date()
): WindowFilterResult {
  if (tweets.length === 0) {
    return {
      availableWindows: [{ id: "all", label: "All Time (0 posts)", n: 0 }],
      defaultWindowId: "all",
    };
  }

  const times = tweets.map((t) => new Date(t.time).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  const oldestDate = new Date(minTime);
  const newestDate = new Date(maxTime);
  const depthDays = Math.ceil((maxTime - minTime) / 86_400_000);

  const nowTime = now.getTime();
  const ms24h = 24 * 60 * 60 * 1000;
  const ms7d = 7 * ms24h;
  const ms30d = 30 * ms24h;
  const ms365d = 365 * ms24h;

  const countToday = tweets.filter((t) => nowTime - new Date(t.time).getTime() <= ms24h).length;
  const count7d = tweets.filter((t) => nowTime - new Date(t.time).getTime() <= ms7d).length;
  const count30d = tweets.filter((t) => nowTime - new Date(t.time).getTime() <= ms30d).length;
  const count1y = tweets.filter((t) => nowTime - new Date(t.time).getTime() <= ms365d).length;
  const countAll = tweets.length;

  const available: AvailableWindow[] = [];

  // Today: newest within last 24h
  const hasTweetIn24h = (nowTime - maxTime) <= ms24h;
  if (hasTweetIn24h && countToday > 0) {
    available.push({ id: "today", label: "Today", n: countToday });
  }

  // Past 7 Days: depthDays >= 2
  if (depthDays >= 2 && count7d > 0) {
    available.push({ id: "7d", label: "Past 7 Days", n: count7d });
  }

  // Past 30 Days: depthDays >= 8
  if (depthDays >= 8 && count30d > 0) {
    available.push({ id: "30d", label: "Past 30 Days", n: count30d });
  }

  // Past 1 Year: depthDays >= 31
  if (depthDays >= 31 && count1y > 0) {
    available.push({ id: "1y", label: "Past 1 Year", n: count1y });
  }

  // All Time: always
  const allTimeLabel = formatAllTimeLabel(oldestDate, newestDate);
  available.push({ id: "all", label: allTimeLabel, n: countAll });

  // Default selection: shortest window with n >= 20, else All Time
  // Window hierarchy from shortest to longest: today -> 7d -> 30d -> 1y -> all
  let defaultWindowId: TimeWindowId = "all";
  for (const win of available) {
    if (win.id !== "all" && win.n >= 20) {
      defaultWindowId = win.id;
      break;
    }
  }

  return { availableWindows: available, defaultWindowId };
}

/**
 * Filter tweets within a specific time window.
 */
export function filterTweetsByWindow(
  tweets: RawTweetItem[],
  windowId: TimeWindowId,
  now = new Date()
): { filtered: RawTweetItem[]; windowInfo: ActiveWindowInfo } {
  if (tweets.length === 0) {
    return {
      filtered: [],
      windowInfo: {
        id: windowId,
        label: "All Time",
        from: now.toISOString(),
        to: now.toISOString(),
        n: 0,
      },
    };
  }

  const times = tweets.map((t) => new Date(t.time).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const nowTime = now.getTime();

  let fromTime = minTime;
  let toTime = maxTime;
  let label = "All Time";

  switch (windowId) {
    case "today":
      fromTime = nowTime - 24 * 60 * 60 * 1000;
      toTime = nowTime;
      label = "Today";
      break;
    case "7d":
      fromTime = nowTime - 7 * 24 * 60 * 60 * 1000;
      toTime = nowTime;
      label = "Past 7 Days";
      break;
    case "30d":
      fromTime = nowTime - 30 * 24 * 60 * 60 * 1000;
      toTime = nowTime;
      label = "Past 30 Days";
      break;
    case "1y":
      fromTime = nowTime - 365 * 24 * 60 * 60 * 1000;
      toTime = nowTime;
      label = "Past 1 Year";
      break;
    case "all":
    default:
      fromTime = minTime;
      toTime = maxTime;
      label = formatAllTimeLabel(new Date(minTime), new Date(maxTime));
      break;
  }

  const filtered = tweets.filter((t) => {
    const tTime = new Date(t.time).getTime();
    if (windowId === "all") return true;
    return tTime >= fromTime && tTime <= toTime;
  });

  return {
    filtered,
    windowInfo: {
      id: windowId,
      label,
      from: new Date(fromTime).toISOString(),
      to: new Date(toTime).toISOString(),
      n: filtered.length,
    },
  };
}

/**
 * Calculates exponential recency weighted sentiment shares per §7.2.
 */
export function calculateWeightedSentiment(
  tweets: RawTweetItem[],
  now = new Date()
): {
  counts: { positive: number; negative: number; neutral: number; total: number };
  weighted: {
    positive: number;
    negative: number;
    neutral: number;
    pctPos: number;
    pctNeg: number;
    pctNeu: number;
    verdict: SentimentLabel;
  };
  rawVerdict: SentimentLabel;
} {
  const counts = { positive: 0, negative: 0, neutral: 0, total: tweets.length };
  if (tweets.length === 0) {
    return {
      counts,
      weighted: {
        positive: 0,
        negative: 0,
        neutral: 0,
        pctPos: 0,
        pctNeg: 0,
        pctNeu: 0,
        verdict: "neutral",
      },
      rawVerdict: "neutral",
    };
  }

  let sumW = 0;
  let sumWPos = 0;
  let sumWNeg = 0;
  let sumWNeu = 0;

  for (const tweet of tweets) {
    const s = tweet.sentiment;
    if (s === "positive") counts.positive += 1;
    else if (s === "negative") counts.negative += 1;
    else counts.neutral += 1;

    const w = weight(new Date(tweet.time), now);
    sumW += w;
    if (s === "positive") sumWPos += w;
    else if (s === "negative") sumWNeg += w;
    else sumWNeu += w;
  }

  // Calculate weighted shares Sc
  const pctPos = sumW > 0 ? (sumWPos / sumW) * 100 : 0;
  const pctNeg = sumW > 0 ? (sumWNeg / sumW) * 100 : 0;
  const pctNeu = sumW > 0 ? (sumWNeu / sumW) * 100 : 0;

  // Determine weighted verdict = argmax_c S_c
  let weightedVerdict: SentimentLabel = "neutral";
  if (pctPos >= pctNeg && pctPos >= pctNeu) {
    weightedVerdict = "positive";
  } else if (pctNeg >= pctPos && pctNeg >= pctNeu) {
    weightedVerdict = "negative";
  } else {
    weightedVerdict = "neutral";
  }

  // Determine raw verdict
  let rawVerdict: SentimentLabel = "neutral";
  if (counts.positive >= counts.negative && counts.positive >= counts.neutral) {
    rawVerdict = "positive";
  } else if (counts.negative >= counts.positive && counts.negative >= counts.neutral) {
    rawVerdict = "negative";
  } else {
    rawVerdict = "neutral";
  }

  return {
    counts,
    weighted: {
      positive: Number(sumWPos.toFixed(3)),
      negative: Number(sumWNeg.toFixed(3)),
      neutral: Number(sumWNeu.toFixed(3)),
      pctPos: Number(pctPos.toFixed(1)),
      pctNeg: Number(pctNeg.toFixed(1)),
      pctNeu: Number(pctNeu.toFixed(1)),
      verdict: weightedVerdict,
    },
    rawVerdict,
  };
}

/**
 * Calculates Sentiment Velocity Badge per §7.3.
 * P = positive share (percent, unweighted) = 100 * positive / total
 * Delta = P_recent(7D) - P_baseline(All-Time) (percentage points)
 * State:
 *   bullish: Delta > +3
 *   declining: Delta < -3
 *   stable: -3 <= Delta <= +3
 *   insufficient: recent n < 10 or depthDays < 14
 */
export function calculateSentimentVelocity(
  allTweets: RawTweetItem[],
  now = new Date()
): VelocityData {
  if (allTweets.length === 0) {
    return { delta: 0, state: "insufficient", pRecent: 0, pBaseline: 0 };
  }

  const times = allTweets.map((t) => new Date(t.time).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const depthDays = Math.ceil((maxTime - minTime) / 86_400_000);

  const nowTime = now.getTime();
  const ms7d = 7 * 24 * 60 * 60 * 1000;
  const recentTweets = allTweets.filter((t) => nowTime - new Date(t.time).getTime() <= ms7d);

  if (recentTweets.length < 10 || depthDays < 14) {
    return { delta: 0, state: "insufficient", pRecent: 0, pBaseline: 0 };
  }

  const recentPos = recentTweets.filter((t) => t.sentiment === "positive").length;
  const pRecent = (recentPos / recentTweets.length) * 100;

  const baselinePos = allTweets.filter((t) => t.sentiment === "positive").length;
  const pBaseline = (baselinePos / allTweets.length) * 100;

  const rawDelta = pRecent - pBaseline;
  const roundedDelta = Math.round(rawDelta);

  let state: VelocityData["state"] = "stable";
  if (rawDelta > 3) {
    state = "bullish";
  } else if (rawDelta < -3) {
    state = "declining";
  } else {
    state = "stable";
  }

  return {
    delta: roundedDelta,
    state,
    pRecent: Number(pRecent.toFixed(1)),
    pBaseline: Number(pBaseline.toFixed(1)),
  };
}
