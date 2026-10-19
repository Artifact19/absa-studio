"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { SearchBar } from "@/components/SearchBar";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { TimeWindowChips } from "@/components/TimeWindowChips";
import { VelocityBadge } from "@/components/VelocityBadge";
import { SentimentSummary } from "@/components/SentimentSummary";
import { InsightsCards } from "@/components/InsightsCards";
import { EvidenceList } from "@/components/EvidenceList";
import { AnalyzeResponse, TimeWindowId } from "@/lib/types";
import { UserRound, Sparkles, AlertCircle, RefreshCw, X, Loader2, Check } from "lucide-react";

export default function HomePage() {
  const [analyzedData, setAnalyzedData] = useState<AnalyzeResponse | null>(null);
  const [selectedWindowId, setSelectedWindowId] = useState<TimeWindowId>("all");
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [insightsStreamText, setInsightsStreamText] = useState("");
  const [isStreamingInsights, setIsStreamingInsights] = useState(false);
  const [notFoundMessage, setNotFoundMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [warmupMessage, setWarmupMessage] = useState("");
  const [suggestedTopics, setSuggestedTopics] = useState<Array<{ topic_key: string; n: number }>>([]);

  // Sign In / Account modal state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPasskey, setAuthPasskey] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  // Fetch topic suggestions from /api/topics on initial mount
  useEffect(() => {
    fetch("/api/topics")
      .then((res) => (res.ok ? res.json() : { topics: [] }))
      .then((data) => {
        if (data.topics && Array.isArray(data.topics)) {
          setSuggestedTopics(data.topics);
        }
      })
      .catch(() => {});
  }, []);

  // Stream insights for the given topic and window
  const streamInsights = useCallback(async (topic: string, windowId?: TimeWindowId) => {
    setIsStreamingInsights(true);
    setInsightsStreamText("");
    setWarmupMessage("");

    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, window: windowId }),
      });

      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          setWarmupMessage("AI model is currently warming up. Generating quick brief...");
        }
        throw new Error(`Insights stream returned status ${res.status}`);
      }

      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setInsightsStreamText(accumulated);
      }
    } catch (err) {
      console.warn("Insights streaming error:", err);
    } finally {
      setIsStreamingInsights(false);
    }
  }, []);

  // Run full analysis on a topic
  const handleAnalyzeTopic = useCallback(
    async (topic: string, userApiKey?: string, windowOverride?: TimeWindowId) => {
      setIsLoadingAnalysis(true);
      setNotFoundMessage("");
      setErrorMessage("");
      setWarmupMessage("");

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            window: windowOverride,
            fetchlayerKey: userApiKey,
          }),
        });

        const data = await res.json();

        if (res.status === 404 && data.notFound) {
          setNotFoundMessage(
            data.message ||
              "No posts found for this topic yet. Click 'FetchLayer Key' above and enter your FetchLayer API key to fetch and analyze fresh posts!"
          );
          setAnalyzedData(null);
          return;
        }

        if (!res.ok) {
          if (res.status === 429 || res.status === 503) {
            setWarmupMessage("Inference server is spinning up. Retrying...");
          }
          throw new Error(data.error || "Failed to analyze topic");
        }

        setAnalyzedData(data);
        setSelectedWindowId(data.window.id);

        // Immediately trigger streaming insights
        streamInsights(topic, data.window.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setErrorMessage(msg);
      } finally {
        setIsLoadingAnalysis(false);
      }
    },
    [streamInsights]
  );

  // When user clicks a different time window chip
  const handleSelectWindow = (newWindowId: TimeWindowId) => {
    if (!analyzedData || newWindowId === selectedWindowId) return;
    setSelectedWindowId(newWindowId);
    handleAnalyzeTopic(analyzedData.topic, undefined, newWindowId);
  };

  // Sign in handler
  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail.trim() || !authPasskey.trim() || isSigningIn) return;

    setIsSigningIn(true);
    setAuthError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail.trim(),
          passkey: authPasskey.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Invalid email or passkey.");
      }

      // If matching admin credentials -> redirect directly to admin console
      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }

      // Standard user sign-in
      setSignedInEmail(data.email || authEmail.trim());
      setIsAuthModalOpen(false);
      setAuthPasskey("");
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsSigningIn(false);
    }
  };

  const isResultsView = Boolean(analyzedData || notFoundMessage || errorMessage);

  return (
    <div className="min-h-screen bg-neutral-50/50 text-neutral-900 selection:bg-indigo-500 selection:text-white dark:bg-neutral-950 dark:text-neutral-100">
      {/* Top Navigation Bar */}
      <header
        className={`w-full border-b border-neutral-200/80 bg-white/80 backdrop-blur-md transition-all dark:border-neutral-800 dark:bg-neutral-950/80 ${
          isResultsView ? "sticky top-0 z-40 shadow-xs" : ""
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl border border-neutral-200/80 bg-neutral-100 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
              <Image
                src="/cat-icon.png"
                alt="ABSA Studio Cat Icon"
                width={32}
                height={32}
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <span className="text-base sm:text-lg">ABSA Studio</span>
          </Link>

          <div className="flex items-center gap-3">
            {signedInEmail ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                <Check className="h-3.5 w-3.5 text-emerald-500" />
                <span>{signedInEmail}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setIsAuthModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white/80 px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-2xs hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-850 transition-colors"
              >
                <UserRound className="h-3.5 w-3.5 text-indigo-500" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* Search Bar - Centers in hero mode, shrinks in compact results mode */}
        <SearchBar
          initialTopic={analyzedData?.topic || ""}
          onSearch={(t, k) => handleAnalyzeTopic(t, k)}
          isLoading={isLoadingAnalysis}
          compact={isResultsView}
          suggestedTopics={suggestedTopics}
        />

        {/* Cold Start / Warmup Notice */}
        {warmupMessage && (
          <div className="mx-auto mt-4 max-w-2xl flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-300">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
            <span>{warmupMessage}</span>
          </div>
        )}

        {/* Friendly Empty State */}
        {notFoundMessage && !analyzedData && (
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-bold text-neutral-900 dark:text-neutral-100">
              No posts found yet
            </h2>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              {notFoundMessage}
            </p>
          </div>
        )}

        {/* Error State */}
        {errorMessage && !analyzedData && (
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-rose-200 bg-rose-50/50 p-6 text-center shadow-xs dark:border-rose-900/60 dark:bg-rose-950/20">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-400">
              <AlertCircle className="h-5 w-5" />
            </div>
            <h2 className="mt-3 text-sm font-bold text-rose-900 dark:text-rose-200">
              Notice
            </h2>
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
              {errorMessage}
            </p>
          </div>
        )}

        {/* Analyzed Dashboard Results */}
        {analyzedData && (
          <div className="mt-8 space-y-8 animate-in fade-in duration-300">
            {/* Header: Aspect title, Provenance Badge, Velocity */}
            <div className="flex flex-col gap-4 border-b border-neutral-200/80 pb-6 sm:flex-row sm:items-center sm:justify-between dark:border-neutral-800">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Topic
                </div>
                <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-neutral-50">
                  {analyzedData.aspect}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <ProvenanceBadge count={analyzedData.counts.total} />
                <VelocityBadge velocity={analyzedData.velocity} />
              </div>
            </div>

            {/* Time Window Chips */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-neutral-400">Time period:</div>
              <TimeWindowChips
                availableWindows={analyzedData.availableWindows}
                selectedWindowId={selectedWindowId}
                onSelectWindow={handleSelectWindow}
                isLoading={isLoadingAnalysis}
              />
            </div>

            {/* Sentiment Summary */}
            <SentimentSummary data={analyzedData} />

            {/* Executive Brief */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                  Quick Summary
                </h3>
                {isStreamingInsights && (
                  <span className="text-xs text-indigo-500 animate-pulse font-medium">
                    (Writing summary...)
                  </span>
                )}
              </div>
              <InsightsCards
                streamedText={insightsStreamText}
                isStreaming={isStreamingInsights}
              />
            </div>

            {/* Evidence Cards */}
            <div className="space-y-3">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                Real Tweets & Posts
              </h3>
              <EvidenceList
                positiveEvidence={analyzedData.evidence.positive}
                negativeEvidence={analyzedData.evidence.negative}
              />
            </div>
          </div>
        )}
      </main>

      {/* Sign In / Sign Up Modal */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-7 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <UserRound className="h-5 w-5" />
            </div>

            <h3 className="mt-3 text-lg font-bold text-neutral-900 dark:text-neutral-100">
              Sign In
            </h3>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Enter your email and passkey to access your profile.
            </p>

            {authError && (
              <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-300">
                {authError}
              </div>
            )}

            <form onSubmit={handleSignInSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-400">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs text-neutral-900 focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-400">
                  Passkey
                </label>
                <input
                  type="password"
                  required
                  value={authPasskey}
                  onChange={(e) => setAuthPasskey(e.target.value)}
                  placeholder="••••••••••••"
                  className="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50/50 px-3 py-2 text-xs text-neutral-900 focus:border-indigo-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>

              <button
                type="submit"
                disabled={isSigningIn}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition-all mt-2"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-20 border-t border-neutral-200/80 py-8 text-center text-xs text-neutral-400 dark:border-neutral-800">
        <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Target-Oriented ABSA Studio.</p>
          <div className="flex items-center gap-4">
            <a
              href="https://fetchlayer.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              FetchLayer ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
