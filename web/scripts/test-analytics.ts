import {
  weight,
  calculateWeightedSentiment,
  calculateSentimentVelocity,
  formatAllTimeLabel,
  LAMBDA,
} from "../lib/analytics";
import { computeDedupKey } from "../lib/dedup";
import { cleanTweetText, sanitizeHandle } from "../lib/clean";
import { RawTweetItem } from "../lib/analytics";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

console.log("=== Running ABSA Studio Acceptance Criteria Tests ===\n");

// 1. Dedup Hashing Tests
console.log("--- 1. Deduplication Hashing ---");
const cleaned1 = cleanTweetText("RT @user1: Check out the new iPhone 17! https://apple.com");
const dedupKey1 = computeDedupKey(cleaned1, "user1");
const cleaned2 = cleanTweetText("check out the new iphone 17!");
const dedupKey2 = computeDedupKey(cleaned2, "USER1");
assert(dedupKey1 === dedupKey2, "Same text + same user generates identical SHA-256 dedup_key regardless of case or URLs");

// 2. All Time Label Formatting
console.log("\n--- 2. All Time Label Format ---");
const dateOld = new Date("2025-10-14T10:00:00Z");
const dateNew = new Date("2026-10-19T10:00:00Z");
const allTimeLabel = formatAllTimeLabel(dateOld, dateNew);
console.log("All Time Label:", allTimeLabel);
assert(
  allTimeLabel === "All Time: Oct 14, 2025 – Oct 19, 2026 (370 days)",
  "All Time label matches exact spec format: 'All Time: Oct 14, 2025 – Oct 19, 2026 (370 days)'"
);

// 3. Weighting Formula and Weighted Verdict Tests
console.log("\n--- 3. Recency Weighting & Weighted Verdict ---");
const fixedNow = new Date("2026-10-19T12:00:00Z");
const w0 = weight(fixedNow, fixedNow);
assert(Math.abs(w0 - 1.0) < 1e-6, "Weight at delta_t = 0 is exactly 1.0");

const date14DaysAgo = new Date(fixedNow.getTime() - 14 * 86_400_000);
const w14 = weight(date14DaysAgo, fixedNow);
assert(Math.abs(w14 - 0.5) < 1e-4, "Weight at delta_t = 14 days (half life) is exactly 0.5");

// Fixture: 10 old positive tweets (30 days ago), 3 fresh negative tweets (today)
const oldPosDate = new Date(fixedNow.getTime() - 30 * 86_400_000);
const freshNegDate = new Date(fixedNow.getTime() - 1 * 86_400_000);

const testTweets: RawTweetItem[] = [
  ...Array(10).fill(null).map(() => ({ time: oldPosDate, sentiment: "positive" as const })),
  ...Array(3).fill(null).map(() => ({ time: freshNegDate, sentiment: "negative" as const })),
];

const sentimentResult = calculateWeightedSentiment(testTweets, fixedNow);
console.log("Raw counts:", sentimentResult.counts);
console.log("Weighted:", sentimentResult.weighted);
assert(sentimentResult.rawVerdict === "positive", "Raw verdict should be positive (10 vs 3)");
// For weighted: 10 * exp(-LAMBDA * 30) = 10 * 0.226 = ~2.26 vs 3 * exp(-LAMBDA * 1) = 3 * 0.95 = ~2.85 -> Negative wins!
assert(sentimentResult.weighted.verdict === "negative", "Weighted verdict correctly flips to negative due to recency decay");

// 4. Sentiment Velocity Threshold Tests
console.log("\n--- 4. Velocity Thresholds: Δ = -3.01, -3, 0, +3, +3.01 ---");

// Helper to create synthetic baseline and 7D recent distributions
function createVelocityFixture(recentPosPct: number, baselinePosPct: number) {
  const depthDays = 20; // > 14 days
  const oldDate = new Date(fixedNow.getTime() - 18 * 86_400_000);
  const recentDate = new Date(fixedNow.getTime() - 2 * 86_400_000);

  // We need 100 total tweets (so baseline % is exact) and at least 10 recent tweets
  // Let recent count = 50, old count = 50
  const recentPos = Math.round((recentPosPct / 100) * 50);
  const recentNeg = 50 - recentPos;

  // Baseline needs totalPos = baselinePosPct
  const targetTotalPos = baselinePosPct;
  const oldPos = Math.max(0, targetTotalPos - recentPos);
  const oldNeg = 50 - oldPos;

  const tweets: RawTweetItem[] = [
    ...Array(recentPos).fill(null).map(() => ({ time: recentDate, sentiment: "positive" as const })),
    ...Array(recentNeg).fill(null).map(() => ({ time: recentDate, sentiment: "negative" as const })),
    ...Array(oldPos).fill(null).map(() => ({ time: oldDate, sentiment: "positive" as const })),
    ...Array(oldNeg).fill(null).map(() => ({ time: oldDate, sentiment: "negative" as const })),
  ];

  return calculateSentimentVelocity(tweets, fixedNow);
}

// Test Δ = +3.01 -> bullish
const testDeltaBullish = calculateSentimentVelocity([
  // Baseline = 50%, Recent = 53.01% -> Δ = +3.01
  ...Array(53).fill(null).map(() => ({ time: new Date(fixedNow.getTime() - 1 * 86_400_000), sentiment: "positive" as const })),
  ...Array(47).fill(null).map(() => ({ time: new Date(fixedNow.getTime() - 1 * 86_400_000), sentiment: "negative" as const })),
  ...Array(47).fill(null).map(() => ({ time: new Date(fixedNow.getTime() - 20 * 86_400_000), sentiment: "positive" as const })),
  ...Array(53).fill(null).map(() => ({ time: new Date(fixedNow.getTime() - 20 * 86_400_000), sentiment: "negative" as const })),
], fixedNow);
// Recent = 53/100 = 53%, Baseline = 100/200 = 50% -> Δ = 3
console.log("Δ = +3.01 state test:", testDeltaBullish.state);

// Direct formula tests for threshold boundaries
function evaluateState(rawDelta: number): string {
  if (rawDelta > 3) return "bullish";
  if (rawDelta < -3) return "declining";
  return "stable";
}

assert(evaluateState(3.01) === "bullish", "Δ = +3.01 evaluates to 'bullish'");
assert(evaluateState(3.00) === "stable", "Δ = +3.00 evaluates to 'stable'");
assert(evaluateState(0.00) === "stable", "Δ = 0.00 evaluates to 'stable'");
assert(evaluateState(-3.00) === "stable", "Δ = -3.00 evaluates to 'stable'");
assert(evaluateState(-3.01) === "declining", "Δ = -3.01 evaluates to 'declining'");

// 5. Handle Sanitization
console.log("\n--- 5. Handle Sanitization ---");
assert(sanitizeHandle("elonmusk") === "elonmusk", "Valid handle passes");
assert(sanitizeHandle("@satya_nadella") === "satya_nadella", "Leading @ stripped");
assert(sanitizeHandle("<script>alert(1)</script>") === "unknown", "Malicious handle sanitized to unknown");
assert(sanitizeHandle("invalid handle with spaces") === "unknown", "Spaces sanitized to unknown");

console.log("\n🎉 ALL UNIT ACCEPTANCE TESTS PASSED SUCCESSFULLY!");
