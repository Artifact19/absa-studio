"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SentimentLabel } from "@/lib/types";
import { PlatformIcon } from "@/components/PlatformIcon";
import {
  Tag,
  Shuffle,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  SkipForward,
  Sparkles,
  ArrowLeft,
  ToggleLeft,
  ToggleRight,
  KeyRound,
  ShieldAlert,
  Layers,
  Flame,
  Award,
  BarChart3,
} from "lucide-react";

interface QueueItem {
  id: string;
  topic_key: string;
  aspect: string;
  text: string;
  cleaned_text: string;
  user: string;
  time: string;
  platform: string;
  subreddit?: string;
  model_label: SentimentLabel;
  confidence: number;
  p_pos?: number;
  p_neg?: number;
  p_neu?: number;
  rationale?: string;
}

export default function AnnotatePage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [passkeyInput, setPasskeyInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Queue state
  const [items, setItems] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<"random" | "uncertain">("random");
  const [selectedTopic, setSelectedTopic] = useState<string>("");
  const [topicsList, setTopicsList] = useState<string[]>([]);
  const [totalLabeled, setTotalLabeled] = useState(0);
  const [totalUnlabeled, setTotalUnlabeled] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showCleanedText, setShowCleanedText] = useState(true);

  // Revealed model result state
  const [revealedResult, setRevealedResult] = useState<{
    humanLabel: SentimentLabel;
    modelLabel: SentimentLabel;
    matched: boolean;
    confidence: number;
  } | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  // Check auth
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/admin/stats");
        if (res.status === 401) {
          setIsAuthenticated(false);
        } else if (res.ok) {
          setIsAuthenticated(true);
        }
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  // Handle Login if not authenticated
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkeyInput.trim()) return;
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkey: passkeyInput }),
      });

      if (res.ok) {
        setIsAuthenticated(true);
        setPasskeyInput("");
      } else {
        const data = await res.json();
        setLoginError(data.error || "Authentication failed.");
      }
    } catch {
      setLoginError("Network error. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Fetch topics list for filter
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchTopics = async () => {
      try {
        const res = await fetch("/api/topics");
        if (res.ok) {
          const data = await res.json();
          const list = (data.topics || []).map((t: { topic: string; aspect?: string }) => t.aspect || t.topic);
          setTopicsList(Array.from(new Set(list)));
        }
      } catch {
        // Ignore
      }
    };
    fetchTopics();
  }, [isAuthenticated]);

  // Load queue items
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;

    const loadQueue = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          mode,
          limit: "30",
        });
        if (selectedTopic) {
          params.set("topic", selectedTopic.toLowerCase());
        }

        const res = await fetch(`/api/admin/labels?${params.toString()}`);
        if (res.ok && active) {
          const data = await res.json();
          setItems(data.items || []);
          setTotalLabeled(data.totalLabeled || 0);
          setTotalUnlabeled(data.totalUnlabeled || 0);
          setCurrentIndex(0);
          setRevealedResult(null);
        }
      } catch (err) {
        console.error("Failed to load queue items:", err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadQueue();
    return () => {
      active = false;
    };
  }, [isAuthenticated, mode, selectedTopic, refreshKey]);

  const currentItem = items[currentIndex];

  // Submit label
  const handleLabel = async (label: SentimentLabel) => {
    if (!currentItem || isSubmitting || revealedResult) return;
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/admin/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentItem.id,
          label,
          source: mode,
        }),
      });

      if (res.ok) {
        setTotalLabeled((prev) => prev + 1);
        setTotalUnlabeled((prev) => Math.max(0, prev - 1));
        setSessionCount((prev) => prev + 1);

        // Reveal comparison to avoid anchoring bias
        setRevealedResult({
          humanLabel: label,
          modelLabel: currentItem.model_label,
          matched: label === currentItem.model_label,
          confidence: currentItem.confidence,
        });
      }
    } catch (e) {
      console.error("Failed to submit label", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Skip post: re-queues to back of active deck with smooth animation
  const handleSkip = useCallback(() => {
    if (!currentItem || isTransitioning) return;
    setIsTransitioning(true);

    setTimeout(() => {
      setRevealedResult(null);
      setItems((prev) => [...prev, currentItem]);
      setCurrentIndex((prev) => prev + 1);
      setIsTransitioning(false);
    }, 180);
  }, [currentItem, isTransitioning]);

  // Next post after submitting a label
  const handleNext = useCallback(() => {
    if (isTransitioning) return;
    setIsTransitioning(true);

    setTimeout(() => {
      setRevealedResult(null);
      if (currentIndex + 1 < items.length) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        setRefreshKey((k) => k + 1);
      }
      setIsTransitioning(false);
    }, 180);
  }, [currentIndex, items.length, isTransitioning]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      if (revealedResult) {
        if (
          e.key === "Enter" ||
          e.key === " " ||
          e.key === "ArrowRight" ||
          e.key === "n" ||
          e.key === "N"
        ) {
          e.preventDefault();
          handleNext();
        }
        return;
      }

      if (e.key === "1") {
        e.preventDefault();
        handleLabel("negative");
      } else if (e.key === "2") {
        e.preventDefault();
        handleLabel("neutral");
      } else if (e.key === "3") {
        e.preventDefault();
        handleLabel("positive");
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        handleSkip();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [revealedResult, currentItem, handleNext, handleSkip]);

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#edf1f7]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-xs font-medium text-slate-500">Initializing Liquid Studio...</p>
        </div>
      </div>
    );
  }

  // Login view if unauthenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#edf1f7] liquid-glass-canvas">
        <div className="w-full max-w-md liquid-glass-slab rounded-[32px] p-8 border border-white/80 space-y-6 relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-600">
              <KeyRound className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Annotation Studio</h1>
              <p className="text-xs text-slate-500">Enter master passkey to unlock annotation session</p>
            </div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="password"
                value={passkeyInput}
                onChange={(e) => setPasskeyInput(e.target.value)}
                placeholder="Enter admin passkey..."
                className="w-full rounded-2xl glass-input px-4 py-3 text-sm text-slate-900 focus:outline-none placeholder:text-slate-400"
                autoFocus
              />
            </div>

            {loginError && (
              <div className="flex items-center gap-2 text-xs text-rose-600 p-2.5 rounded-xl bg-rose-50/70 border border-rose-200">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full liquid-pill-primary py-3 font-semibold text-sm cursor-pointer disabled:opacity-50"
            >
              {isLoggingIn ? "Unlocking..." : "Enter Studio"}
            </button>
          </form>

          <div className="text-center">
            <Link href="/admin" className="text-xs text-slate-500 hover:text-slate-800 transition">
              ← Return to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const progressPercent =
    totalLabeled + totalUnlabeled > 0
      ? Math.round((totalLabeled / (totalLabeled + totalUnlabeled)) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-[#edf1f7] liquid-glass-canvas flex flex-col justify-between py-6 px-4 sm:px-8">
      {/* 1. Top Glass Header */}
      <header className="max-w-5xl w-full mx-auto relative z-10 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Back & Breadcrumb */}
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="liquid-pill-neutral px-4 py-2 text-xs font-semibold flex items-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Admin Console</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-sm font-bold text-slate-800 tracking-tight">
                Human Annotation Studio
              </h1>
            </div>
          </div>

          {/* Controls: Mode & Filter */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Sampling Mode Pill Segmented Toggle */}
            <div className="glass-track p-1 flex items-center gap-1 rounded-full text-xs">
              <button
                type="button"
                onClick={() => setMode("random")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition cursor-pointer ${
                  mode === "random"
                    ? "liquid-pill-primary text-white shadow-md"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Shuffle className="h-3 w-3" />
                <span>Random</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("uncertain")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition cursor-pointer ${
                  mode === "uncertain"
                    ? "liquid-pill-primary text-white shadow-md"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <AlertCircle className="h-3 w-3" />
                <span>Uncertain Mode</span>
              </button>
            </div>

            {/* Filter by Aspect Dropdown */}
            {topicsList.length > 0 && (
              <select
                value={selectedTopic}
                onChange={(e) => setSelectedTopic(e.target.value)}
                className="liquid-pill-neutral px-3.5 py-1.5 text-xs font-semibold focus:outline-none cursor-pointer"
              >
                <option value="">All Topics</option>
                {topicsList.map((top) => (
                  <option key={top} value={top}>
                    {top}
                  </option>
                ))}
              </select>
            )}

            {/* View Live Evaluation Metrics */}
            <Link
              href="/admin/evaluation"
              className="liquid-pill-cyan px-3.5 py-1.5 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <BarChart3 className="h-3.5 w-3.5 text-white" />
              <span>Metrics & Kappa</span>
            </Link>

            {/* Export CSV */}
            <a
              href="/api/admin/labels?export=csv"
              download="human_labeled_dataset.csv"
              className="liquid-pill-neutral px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-indigo-600" />
              <span>Export CSV</span>
            </a>
          </div>
        </div>

        {/* Liquid Progress Track */}
        <div className="liquid-glass-inner rounded-2xl p-3 border border-white/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Award className="h-4 w-4 text-emerald-600" />
              <span className="text-slate-500 font-medium">Labeled:</span>
              <strong className="text-emerald-700 font-bold tabular-nums">{totalLabeled}</strong>
            </div>

            <span className="text-slate-300">•</span>

            <div className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-indigo-600" />
              <span className="text-slate-500 font-medium">Remaining:</span>
              <strong className="text-slate-800 font-bold tabular-nums">{totalUnlabeled}</strong>
            </div>

            {sessionCount > 0 && (
              <>
                <span className="text-slate-300">•</span>
                <div className="flex items-center gap-1 text-emerald-600 font-semibold">
                  <Flame className="h-3.5 w-3.5 fill-emerald-500/20" />
                  <span>+{sessionCount} this session</span>
                </div>
              </>
            )}
          </div>

          {/* Progress Bar */}
          <div className="flex items-center gap-3 w-full sm:w-64">
            <div className="w-full bg-slate-200/70 h-2 rounded-full overflow-hidden p-0.5 border border-white/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0 font-semibold">
              {progressPercent}%
            </span>
          </div>
        </div>
      </header>

      {/* 2. Main Liquid Glass Card Deck */}
      <main className="max-w-4xl w-full mx-auto relative z-10 my-auto py-4">
        {isLoading ? (
          <div className="liquid-glass-slab rounded-[36px] p-16 text-center space-y-4 border border-white/80 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-800">Fetching Next Candidate...</h3>
            <p className="text-xs text-slate-500">Sampling unlabeled post candidates from Supabase</p>
          </div>
        ) : !currentItem ? (
          /* Empty Queue State */
          <div className="liquid-glass-slab rounded-[36px] p-12 text-center space-y-5 border border-white/80 animate-liquid-enter">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900">Queue is Clear!</h2>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                All posts matching the selected topic have been annotated. Switch to another topic or return to dashboard.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                className="liquid-pill-primary px-5 py-2.5 text-xs font-semibold cursor-pointer"
              >
                Refresh Queue
              </button>
              <Link
                href="/admin"
                className="liquid-pill-neutral px-5 py-2.5 text-xs font-semibold cursor-pointer"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        ) : (
          /* Active Tweet Slab (Liquid Glass UI Kit Style) */
          <div
            className={`liquid-glass-slab rounded-[36px] p-8 sm:p-10 border border-white/85 space-y-8 shadow-2xl transition-all duration-200 ${
              isTransitioning ? "animate-liquid-exit" : "animate-liquid-enter"
            }`}
          >
            {/* Top Specular Pill Row */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/60 pb-6">
              <div className="flex flex-wrap items-center gap-3">
                {/* Target Entity Pill (Enlarged Liquid Cyan Glass Badge) */}
                <span className="liquid-pill-cyan px-5 py-2 text-sm sm:text-base font-extrabold tracking-wide shadow-md flex items-center gap-2">
                  <Tag className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
                  <span>{currentItem.aspect}</span>
                </span>

                {/* Social Platform Pill (Enlarged Liquid Neutral Glass Badge) */}
                <span className="liquid-pill-neutral px-4 py-2 text-sm sm:text-base font-bold flex items-center gap-2 text-slate-800 shadow-sm">
                  <PlatformIcon platform={currentItem.platform || "twitter"} className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
                  <span>
                    {currentItem.platform === "reddit"
                      ? currentItem.subreddit
                        ? `r/${currentItem.subreddit}`
                        : "Reddit"
                      : "𝕏"}
                  </span>
                </span>
              </div>

              {/* Author & Batch Counter */}
              <div className="flex items-center gap-3 text-xs sm:text-sm">
                <span className="text-slate-500 font-medium">
                  {currentItem.platform === "reddit" ? `u/${currentItem.user}` : `@${currentItem.user}`}
                </span>
                <span className="text-slate-300">•</span>
                <span className="font-mono text-slate-500 text-xs font-bold bg-white/60 px-3 py-1 rounded-full border border-white/80 shadow-xs">
                  Card {currentIndex + 1} of {items.length}
                </span>
              </div>
            </div>

            {/* Tweet Body Sub-card (Liquid Inner Frost) */}
            <div className="liquid-glass-inner rounded-[28px] p-6 sm:p-8 space-y-4 relative overflow-hidden">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-mono">
                  {new Date(currentItem.time).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>

                {/* Raw vs Cleaned Toggle */}
                <button
                  type="button"
                  onClick={() => setShowCleanedText((prev) => !prev)}
                  className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 transition cursor-pointer font-medium"
                >
                  {showCleanedText ? (
                    <ToggleRight className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-slate-400" />
                  )}
                  <span>{showCleanedText ? "Cleaned Text" : "Raw Text"}</span>
                </button>
              </div>

              {/* Quote Typography */}
              <blockquote className="text-lg sm:text-2xl font-medium text-slate-900 leading-relaxed tracking-tight select-text">
                &ldquo;{showCleanedText ? currentItem.cleaned_text || currentItem.text : currentItem.text}&rdquo;
              </blockquote>
            </div>

            {/* Bottom Actions: EITHER Classification Gel Pills OR Model Reveal */}
            {revealedResult ? (
              /* Animated Model Comparison Reveal Drawer */
              <div className="liquid-glass-inner rounded-[28px] p-6 space-y-5 animate-liquid-reveal border border-white/90 bg-white/70">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                  {/* Comparison Duel: Human Truth VS Qwen 2.5 */}
                  <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                    {/* Human Truth Capsule */}
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/70 border border-white/90 pl-3.5 pr-1 py-1 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Human Truth
                      </span>
                      <span
                        className={`text-xs font-extrabold px-3 py-1 rounded-full uppercase shadow-xs ${
                          revealedResult.humanLabel === "positive"
                            ? "liquid-pill-emerald"
                            : revealedResult.humanLabel === "negative"
                            ? "liquid-pill-rose"
                            : "liquid-pill-amber"
                        }`}
                      >
                        {revealedResult.humanLabel}
                      </span>
                    </div>

                    {/* Centered VS Badge */}
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-200/90 border border-slate-300/50 text-[10px] font-black text-slate-700 tracking-wider shadow-2xs">
                      VS
                    </span>

                    {/* Qwen 2.5 Capsule with explicit Confidence metric */}
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/70 border border-white/90 pl-3.5 pr-2 py-1 shadow-xs">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                        Qwen 2.5
                      </span>
                      <span
                        className={`text-xs font-extrabold px-3 py-1 rounded-full uppercase shadow-xs ${
                          revealedResult.modelLabel === "positive"
                            ? "liquid-pill-emerald"
                            : revealedResult.modelLabel === "negative"
                            ? "liquid-pill-rose"
                            : "liquid-pill-amber"
                        }`}
                      >
                        {revealedResult.modelLabel}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100/90 border border-slate-200/80 px-2 py-0.5 rounded-full tabular-nums">
                        {(revealedResult.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                  </div>

                  {/* Agreement Indicator & Next Post Button */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full ${
                        revealedResult.matched
                          ? "bg-emerald-500/15 text-emerald-800 border border-emerald-500/30"
                          : "bg-amber-500/15 text-amber-800 border border-amber-500/30"
                      }`}
                    >
                      {revealedResult.matched ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Model Agreement</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                          <span>Disagreement Flagged</span>
                        </>
                      )}
                    </span>

                    {/* Next Post Button */}
                    <button
                      type="button"
                      onClick={handleNext}
                      className="liquid-pill-primary px-5 py-2.5 text-xs sm:text-sm font-bold flex items-center gap-2.5 whitespace-nowrap shrink-0 cursor-pointer shadow-lg active:scale-95"
                      autoFocus
                    >
                      <kbd className="px-2 py-0.5 rounded-full bg-white/25 text-[10px] font-mono text-white font-semibold whitespace-nowrap">
                        Space
                      </kbd>
                      <span className="whitespace-nowrap">Next Post</span>
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    </button>
                  </div>
                </div>

                {/* Model Rationale */}
                {currentItem.rationale && (
                  <div className="border-t border-slate-200/50 pt-3">
                    <p className="text-xs text-slate-600 italic">
                      <strong className="not-italic text-slate-700">Model Rationale:</strong> &ldquo;
                      {currentItem.rationale}&rdquo;
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Classification Liquid Gel Action Buttons */
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
                  {/* Negative Gel Button */}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleLabel("negative")}
                    className="liquid-pill-rose py-4 px-5 flex items-center justify-center gap-3 font-bold text-sm cursor-pointer shadow-md disabled:opacity-50"
                  >
                    <kbd className="px-2 py-0.5 rounded-full bg-white/25 text-[11px] font-mono">1</kbd>
                    <span>Negative</span>
                  </button>

                  {/* Neutral Gel Button */}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleLabel("neutral")}
                    className="liquid-pill-amber py-4 px-5 flex items-center justify-center gap-3 font-bold text-sm cursor-pointer shadow-md disabled:opacity-50"
                  >
                    <kbd className="px-2 py-0.5 rounded-full bg-white/25 text-[11px] font-mono">2</kbd>
                    <span>Neutral</span>
                  </button>

                  {/* Positive Gel Button */}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleLabel("positive")}
                    className="liquid-pill-emerald py-4 px-5 flex items-center justify-center gap-3 font-bold text-sm cursor-pointer shadow-md disabled:opacity-50"
                  >
                    <kbd className="px-2 py-0.5 rounded-full bg-white/25 text-[11px] font-mono">3</kbd>
                    <span>Positive</span>
                  </button>

                  {/* Skip Gel Button (Moves to Back of Deck) */}
                  <button
                    type="button"
                    disabled={isSubmitting || isTransitioning}
                    onClick={handleSkip}
                    className="liquid-pill-neutral py-4 px-5 flex items-center justify-center gap-2 font-semibold text-sm cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    <kbd className="px-2 py-0.5 rounded-full bg-slate-200/80 text-[11px] font-mono text-slate-700">
                      S
                    </kbd>
                    <span>Skip to Back</span>
                    <SkipForward className="h-3.5 w-3.5 text-slate-400" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 3. Floating Bottom Shortcut Bar */}
      <footer className="max-w-2xl w-full mx-auto relative z-10 pt-4">
        <div className="liquid-glass-inner rounded-full py-2 px-5 border border-white/80 flex items-center justify-center gap-4 text-[11px] text-slate-500 shadow-sm">
          <span>Keyboard Shortcuts:</span>
          <span className="flex items-center gap-1 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">1</kbd> Neg
          </span>
          <span className="flex items-center gap-1 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">2</kbd> Neu
          </span>
          <span className="flex items-center gap-1 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">3</kbd> Pos
          </span>
          <span className="flex items-center gap-1 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">S</kbd> Skip
          </span>
          <span className="flex items-center gap-1 font-mono">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">Space</kbd> Next
          </span>
        </div>
      </footer>
    </div>
  );
}

