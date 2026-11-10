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
import { GenreBadge } from "@/components/GenreBadge";
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
  const [suggestedTopics, setSuggestedTopics] = useState<Array<{ topic_key: string; genre?: string; n: number }>>([]);

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
          throw new Error(data.message || data.error || "Failed to analyze topic");
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

      if (data.redirect) {
        window.location.href = data.redirect;
        return;
      }

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
    <div className="min-h-screen text-slate-900 selection:bg-sky-200 selection:text-slate-900">
      {/* Top Floating Glass Navigation Bar */}
      <header
        className={`w-full border-b border-white/60 bg-white/60 backdrop-blur-xl transition-all ${
          isResultsView ? "sticky top-0 z-40 shadow-xs" : ""
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-2.5 sm:px-6 sm:py-3">
          <Link href="/" className="flex items-center gap-2.5 font-extrabold tracking-tight text-slate-900">
            <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full glass-pill p-1 shadow-2xs">
              <Image
                src="/cat-icon.png"
                alt="ABSA Studio Cat Icon"
                width={28}
                height={28}
                className="h-full w-full object-contain"
                priority
              />
            </div>
            <span className="text-base sm:text-lg font-bold">ABSA Studio</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {signedInEmail ? (
              <span className="inline-flex items-center gap-1.5 rounded-full glass-pill px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs max-w-[140px] xs:max-w-[200px] sm:max-w-none">
                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">{signedInEmail}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAuthError("");
                  setIsAuthModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full glass-pill px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:text-slate-900 transition-all cursor-pointer"
              >
                <UserRound className="h-3.5 w-3.5 text-[#6c94cc]" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-6xl px-3 py-3 sm:py-6 sm:px-6">
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
          <div className="mx-auto mt-4 max-w-2xl flex items-center gap-2 rounded-2xl glass-panel p-3 text-xs text-sky-900 border-sky-300/40">
            <RefreshCw className="h-4 w-4 animate-spin text-[#6c94cc] shrink-0" />
            <span>{warmupMessage}</span>
          </div>
        )}

        {/* Friendly Empty State */}
        {notFoundMessage && !analyzedData && (
          <div className="mx-auto mt-8 sm:mt-10 max-w-xl rounded-3xl glass-panel p-6 sm:p-8 text-center shadow-xs">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10 text-[#6c94cc]">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-base font-bold text-slate-900">
              No posts found yet
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              {notFoundMessage}
            </p>
          </div>
        )}

        {/* Error State */}
        {errorMessage && !analyzedData && (
          <div className="mx-auto mt-8 sm:mt-10 max-w-xl rounded-3xl glass-panel border-rose-300/40 p-5 sm:p-6 text-center shadow-xs">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
              <AlertCircle className="h-5 w-5" />
            </div>
            <h2 className="mt-3 text-sm font-bold text-rose-900">
              Notice
            </h2>
            <p className="mt-1 text-xs text-rose-700">
              {errorMessage}
            </p>
          </div>
        )}

        {/* Analyzed Dashboard Results */}
        {analyzedData && (
          <div className="mt-6 sm:mt-8 space-y-6 sm:space-y-8 animate-in fade-in duration-300">
            {/* Header: Aspect title, Genre Pill Badge, Provenance Badge, Velocity */}
            <div className="flex flex-col gap-4 border-b border-white/60 pb-5 sm:pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#6c94cc]">
                    Target Entity
                  </span>
                  <GenreBadge genre={analyzedData.genre} size="sm" />
                </div>
                <h2 className="text-2xl sm:text-4xl font-black text-slate-900 break-words tracking-tight">
                  {analyzedData.aspect}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <ProvenanceBadge
                  count={analyzedData.counts.total}
                  platformBreakdown={analyzedData.platformBreakdown}
                />
                <VelocityBadge velocity={analyzedData.velocity} />
              </div>
            </div>

            {/* Time Window Chips (Segmented Frosted Capsule) */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-500">Observation Window:</div>
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
                <Sparkles className="h-4 w-4 text-[#6c94cc]" />
                <h3 className="text-base font-bold text-slate-900">
                  Executive Brief
                </h3>
                {isStreamingInsights && (
                  <span className="text-xs text-[#6c94cc] animate-pulse font-medium">
                    (Writing summary...)
                  </span>
                )}
              </div>
              <InsightsCards
                streamedText={insightsStreamText}
                isStreaming={isStreamingInsights}
                topic={analyzedData.aspect || analyzedData.topic}
              />
            </div>

            {/* Evidence Cards */}
            <div className="space-y-3">
              <h3 className="text-base font-bold text-slate-900">
                Ground-Truth Evidence on 𝕏 and Reddit
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-md p-4">
          <div className="relative w-full max-w-sm rounded-3xl glass-elevated p-6 sm:p-7 shadow-2xl">
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex h-10 w-10 items-center justify-center rounded-full glass-pill text-[#6c94cc]">
              <UserRound className="h-5 w-5" />
            </div>

            <h3 className="mt-3 text-lg font-bold text-slate-900">
              Sign In
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Enter your email and passkey to access your profile.
            </p>

            {authError && (
              <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700">
                {authError}
              </div>
            )}

            <form onSubmit={handleSignInSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-600">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="mt-1 w-full rounded-full glass-input px-4 py-2 text-xs text-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600">
                  Passkey
                </label>
                <input
                  type="password"
                  required
                  value={authPasskey}
                  onChange={(e) => setAuthPasskey(e.target.value)}
                  placeholder="••••••••••••"
                  className="mt-1 w-full rounded-full glass-input px-4 py-2 text-xs text-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isSigningIn}
                className="w-full flex items-center justify-center gap-1.5 rounded-full glass-pill-active py-2.5 text-xs font-semibold shadow-xs active:scale-95 disabled:opacity-50 transition-all mt-2 cursor-pointer"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
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
      <footer className="mt-16 sm:mt-20 border-t border-white/60 py-8 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 Target-Oriented ABSA Studio.</p>
          <div className="flex items-center gap-4">
            <a
              href="https://fetchlayer.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-800 transition-colors"
            >
              FetchLayer ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
