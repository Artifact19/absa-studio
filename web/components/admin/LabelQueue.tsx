"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { SentimentLabel } from "@/lib/types";
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
  model_label: SentimentLabel;
  confidence: number;
  p_pos?: number;
  p_neg?: number;
  p_neu?: number;
  rationale?: string;
}

interface LabelQueueProps {
  onLabelSubmitted?: () => void;
}

export function LabelQueue({ onLabelSubmitted }: LabelQueueProps = {}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mode, setMode] = useState<"random" | "uncertain">("random");
  const [totalLabeled, setTotalLabeled] = useState(0);
  const [totalUnlabeled, setTotalUnlabeled] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealedResult, setRevealedResult] = useState<{
    humanLabel: SentimentLabel;
    modelLabel: SentimentLabel;
    matched: boolean;
    confidence: number;
  } | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/admin/labels?mode=${mode}&limit=25`);
        if (res.ok && active) {
          const data = await res.json();
          setItems(data.items || []);
          setTotalLabeled(data.totalLabeled || 0);
          setTotalUnlabeled(data.totalUnlabeled || 0);
          setCurrentIndex(0);
          setRevealedResult(null);
        }
      } catch (e) {
        console.error("Failed to load labeling queue", e);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [mode, refreshKey]);

  const currentItem = items[currentIndex];

  // Submit label
  const handleLabel = async (label: SentimentLabel) => {
    if (!currentItem || isSubmitting) return;

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

        // Reveal comparison to avoid anchoring before labeling
        setRevealedResult({
          humanLabel: label,
          modelLabel: currentItem.model_label,
          matched: label === currentItem.model_label,
          confidence: currentItem.confidence,
        });

        onLabelSubmitted?.();
      }
    } catch (e) {
      console.error("Failed to submit label", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Skip post: re-queues it to the end of the active queue so it will reappear later
  const handleSkip = () => {
    setRevealedResult(null);
    if (!currentItem) return;

    // Push skipped candidate to the back of the queue
    setItems((prev) => [...prev, currentItem]);
    setCurrentIndex((prev) => prev + 1);
  };

  // Next post after submitting a label
  const handleNext = () => {
    setRevealedResult(null);
    if (currentIndex + 1 < items.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setRefreshKey((k) => k + 1);
    }
  };

  // Keyboard navigation: 1 = negative, 2 = neutral, 3 = positive, S = skip, Space/Enter = next
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
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
  }, [revealedResult, currentItem, currentIndex, items.length]);

  return (
    <div className="rounded-3xl glass-card p-6 border border-white/50 space-y-6">
      {/* Top Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/40 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-700">
              <Tag className="h-4 w-4" />
            </span>
            <h2 className="text-base font-bold text-slate-900">Active Human Annotation Queue</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Ground-truth labeling loop. Blind evaluation: model labels remain masked until submitted.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode Toggle */}
          <div className="flex rounded-full p-1 bg-slate-200/50 backdrop-blur border border-white/40 text-xs font-medium">
            <button
              onClick={() => setMode("random")}
              className={`flex items-center gap-1 px-3 py-1 rounded-full transition cursor-pointer ${
                mode === "random" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Shuffle className="h-3 w-3" />
              <span>Random</span>
            </button>
            <button
              onClick={() => setMode("uncertain")}
              className={`flex items-center gap-1 px-3 py-1 rounded-full transition cursor-pointer ${
                mode === "uncertain" ? "bg-white text-indigo-900 shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <AlertCircle className="h-3 w-3 text-indigo-600" />
              <span>Uncertain</span>
            </button>
          </div>

          {/* Dedicated Studio Link */}
          <Link
            href="/admin/annotate"
            className="flex items-center gap-1 rounded-full glass-pill px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <span>Dedicated Studio ↗</span>
          </Link>

          {/* Export CSV */}
          <a
            href="/api/admin/labels?export=csv"
            download="human_labeled_dataset.csv"
            className="flex items-center gap-1 rounded-full glass-pill px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-indigo-600" />
            <span>Export CSV</span>
          </a>
        </div>
      </div>

      {/* Progress & Stats */}
      <div className="flex items-center justify-between text-xs text-slate-600 px-1">
        <div className="flex items-center gap-3">
          <span>
            Labeled: <strong className="text-emerald-700">{totalLabeled}</strong>
          </span>
          <span>•</span>
          <span>
            Remaining: <strong className="text-slate-800">{totalUnlabeled}</strong>
          </span>
        </div>
        {items.length > 0 && (
          <span className="font-mono text-slate-400">
            Batch: {currentIndex + 1} / {items.length}
          </span>
        )}
      </div>

      {/* Main Card */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          <p className="text-xs text-slate-500 font-medium">Loading annotation candidates...</p>
        </div>
      ) : !currentItem ? (
        <div className="text-center py-16 space-y-2">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">Queue is Clear!</h3>
          <p className="text-xs text-slate-500">All available posts have been labeled.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Post Presentation */}
          <div className="rounded-2xl glass-panel p-6 border border-white/60 space-y-4 shadow-sm bg-white/40">
            {/* Metadata Badge */}
            <div className="flex items-center justify-between text-xs border-b border-slate-200/50 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 font-medium">Target Entity:</span>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-900 font-bold text-xs">
                  {currentItem.aspect}
                </span>
              </div>
              <div className="text-slate-400 font-mono text-[11px]">
                @{currentItem.user} • {new Date(currentItem.time).toLocaleDateString()}
              </div>
            </div>

            {/* Post Content */}
            <blockquote className="text-base sm:text-lg font-medium text-slate-800 leading-relaxed">
              &ldquo;{currentItem.cleaned_text || currentItem.text}&rdquo;
            </blockquote>
          </div>

          {/* Feedback & Result Reveal */}
          {revealedResult ? (
            <div className="rounded-2xl glass-panel p-4 border border-white/60 space-y-4 bg-slate-50/60 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 font-medium">Your Label:</span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${
                        revealedResult.humanLabel === "positive"
                          ? "bg-emerald-100 text-emerald-800"
                          : revealedResult.humanLabel === "negative"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {revealedResult.humanLabel}
                    </span>
                  </div>

                  <span>vs</span>

                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 font-medium">Qwen Model:</span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${
                        revealedResult.modelLabel === "positive"
                          ? "bg-emerald-100 text-emerald-800"
                          : revealedResult.modelLabel === "negative"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {revealedResult.modelLabel}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      ({(revealedResult.confidence * 100).toFixed(0)}% conf)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
                      revealedResult.matched
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-amber-500/10 text-amber-700"
                    }`}
                  >
                    {revealedResult.matched ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" /> Agreement
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" /> Disagreement
                      </>
                    )}
                  </span>

                  <button
                    onClick={handleNext}
                    className="flex items-center gap-1.5 rounded-full bg-slate-900 text-white px-4 py-1.5 text-xs font-semibold hover:bg-slate-800 transition shadow cursor-pointer active:scale-95"
                  >
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-700 text-[10px] font-mono text-slate-200">
                      Space / ↵
                    </kbd>
                    <span>Next Post</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {currentItem.rationale && (
                <p className="text-xs text-slate-500 italic border-t border-slate-200/40 pt-2">
                  Model Rationale: &ldquo;{currentItem.rationale}&rdquo;
                </p>
              )}
            </div>
          ) : (
            /* Action Buttons with Keyboard Shortcuts */
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="grid grid-cols-3 gap-3 w-full sm:w-auto flex-1">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleLabel("negative")}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-rose-200 bg-rose-50/70 text-rose-800 font-bold text-sm hover:bg-rose-100/90 transition shadow-sm active:scale-95 cursor-pointer"
                >
                  <kbd className="px-1.5 py-0.5 rounded bg-rose-200/80 text-[10px] font-mono">1</kbd>
                  <span>Negative</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleLabel("neutral")}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50/70 text-amber-800 font-bold text-sm hover:bg-amber-100/90 transition shadow-sm active:scale-95 cursor-pointer"
                >
                  <kbd className="px-1.5 py-0.5 rounded bg-amber-200/80 text-[10px] font-mono">2</kbd>
                  <span>Neutral</span>
                </button>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleLabel("positive")}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 text-emerald-800 font-bold text-sm hover:bg-emerald-100/90 transition shadow-sm active:scale-95 cursor-pointer"
                >
                  <kbd className="px-1.5 py-0.5 rounded bg-emerald-200/80 text-[10px] font-mono">3</kbd>
                  <span>Positive</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleSkip}
                className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl border border-slate-200 text-slate-600 hover:text-slate-900 font-medium text-xs hover:bg-slate-100 transition active:scale-95 cursor-pointer sm:w-auto w-full"
              >
                <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-mono">S</kbd>
                <span>Skip</span>
                <SkipForward className="h-3 w-3 ml-0.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
