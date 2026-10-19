export type SentimentLabel = "positive" | "negative" | "neutral";

export type TimeWindowId = "today" | "7d" | "30d" | "1y" | "all";

export type VelocityState = "bullish" | "declining" | "stable" | "insufficient";

export interface Evidence {
  handle: string;
  time: string;
  text: string;
  confidence: number;
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

export interface AnalyzeResponse {
  topic: string;
  aspect: string;
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

export interface AdminTweet {
  id: string;
  topic_key: string;
  aspect: string | null;
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
}

export interface HFClassifyResp {
  results: HFClassifyItem[];
}

export interface HFSynthEvidence {
  user: string;
  text: string;
  confidence: number;
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

export interface FetchLayerRawTweet {
  id?: string | number;
  text?: string;
  createdAt?: string;
  created_at?: string;
  time?: string;
  author?: {
    handle?: string;
    username?: string;
    name?: string;
  };
  user?: {
    handle?: string;
    username?: string;
  };
}

export interface FetchLayerSearchResponse {
  tweets?: FetchLayerRawTweet[];
  results?: FetchLayerRawTweet[];
  data?: FetchLayerRawTweet[];
  nextCursor?: string | null;
  cursor?: string | null;
}
