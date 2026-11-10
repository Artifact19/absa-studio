export type SentimentLabel = "positive" | "negative" | "neutral";

export type TimeWindowId = "today" | "7d" | "30d" | "1y" | "all";

export type VelocityState = "bullish" | "declining" | "stable" | "insufficient";

export type SocialPlatform = "twitter" | "reddit";

export interface Evidence {
  handle: string;
  time: string;
  text: string;
  confidence: number;
  platform?: SocialPlatform;
  subreddit?: string;
  url?: string;
  rationale?: string;
}

export interface AvailableWindow {
  id: TimeWindowId;
  label: string;
  n: number;
}

export interface ActiveWindowInfo {
  id: TimeWindowId;
  label: string;
  from: string;
  to: string;
  n: number;
}

export interface VelocityData {
  delta: number;
  state: VelocityState;
  pRecent: number;
  pBaseline: number;
}

export interface PlatformBreakdown {
  twitter: number;
  reddit: number;
  total: number;
}

export interface AnalyzeResponse {
  topic: string;
  aspect: string;
  genre: string;
  platformBreakdown?: PlatformBreakdown;
  coverage: {
    oldest: string;
    newest: string;
    days: number;
  };
  availableWindows: AvailableWindow[];
  window: ActiveWindowInfo;
  counts: {
    positive: number;
    negative: number;
    neutral: number;
    total: number;
  };
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
  velocity: VelocityData;
  evidence: {
    positive: Evidence[];
    negative: Evidence[];
  };
}

export interface ExecutiveInsights {
  verdict: string;
  exciting: Array<{ theme: string; sentence: string }>;
  frustrating: Array<{ theme: string; sentence: string }>;
  bottomLine: string;
  rawMarkdown?: string;
}

export interface AdminStats {
  totalTopics: number;
  totalRecords: number;
  sentimentCounts: {
    positive: number;
    negative: number;
    neutral: number;
  };
  oldestRecord: string | null;
  newestRecord: string | null;
  storageBytes: number;
  storageLimitBytes: number;
}

export interface TopicSummaryItem {
  topic_key: string;
  genre: string;
  n: number;
  oldest?: string | null;
  newest?: string | null;
}

export interface AdminTweet {
  id: string;
  topic_key: string;
  aspect: string | null;
  genre?: string;
  platform?: SocialPlatform;
  subreddit?: string;
  context_url?: string;
  handle: string;
  tweeted_at: string;
  text: string;
  cleaned_text: string;
  sentiment: SentimentLabel;
  p_pos: number;
  p_neg: number;
  p_neu: number;
  confidence: number;
  created_at: string;
}

export interface HFExtractReq {
  text: string;
}

export interface HFExtractResp {
  entity: string;
  tier: number;
}

export interface HFClassifyItem {
  label: SentimentLabel;
  prob_pos: number;
  prob_neg: number;
  prob_neu: number;
  confidence: number;
  rationale?: string;
  route?: string;
  cues?: string[];
}

export interface HFClassifyResp {
  results: HFClassifyItem[];
}

export interface HFSynthEvidence {
  user: string;
  text: string;
  confidence: number;
  rationale?: string;
}

export interface HFSynthReq {
  target: string;
  n_total: number;
  pct_pos: number;
  pct_neg: number;
  pct_neu: number;
  top_positive: HFSynthEvidence[];
  top_negative: HFSynthEvidence[];
}

export interface FetchLayerRawPost {
  id?: string | number;
  text?: string;
  body?: string;
  title?: string;
  selftext?: string;
  createdAt?: string;
  created_at?: string;
  time?: string;
  created_utc?: number;
  author?: {
    handle?: string;
    username?: string;
    name?: string;
  } | string;
  user?: {
    handle?: string;
    username?: string;
  } | string;
  platform?: SocialPlatform;
  subreddit?: string;
  subreddit_name_prefixed?: string;
  url?: string;
  permalink?: string;
}

export type FetchLayerRawTweet = FetchLayerRawPost;

export interface FetchLayerSearchResponse {
  items?: FetchLayerRawPost[];
  tweets?: FetchLayerRawPost[];
  results?: FetchLayerRawPost[];
  data?: FetchLayerRawPost[];
  posts?: FetchLayerRawPost[];
  nextCursor?: string | null;
  cursor?: string | null;
  after?: string | null;
}
