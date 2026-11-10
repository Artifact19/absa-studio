"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { SentimentLabel } from "@/lib/types";
import { EvaluationResults } from "@/lib/evaluation";
import {
  Sparkles,
  ArrowLeft,
  RefreshCw,
  Award,
  Layers,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  TrendingUp,
  BrainCircuit,
  Filter,
  BarChart3,
  ShieldCheck,
  ChevronRight,
  Loader2,
  KeyRound,
  ShieldAlert,
} from "lucide-react";

interface TopicStat {
  topic: string;
  count: number;
  accuracy: number;
  qwk: number;
  macroF1: number;
  polarFlips: number;
}

interface SourceStat {
  source: string;
  count: number;
  accuracy: number;
  qwk: number;
  macroF1: number;
}

export default function EvaluationPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [passkeyInput, setPasskeyInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [metrics, setMetrics] = useState<EvaluationResults | null>(null);
  const [topicBreakdown, setTopicBreakdown] = useState<TopicStat[]>([]);
  const [sourceBreakdown, setSourceBreakdown] = useState<SourceStat[]>([]);
  const [totalEvaluated, setTotalEvaluated] = useState(0);

  const [selectedTopic, setSelectedTopic] = useState("");
  const [selectedSource, setSelectedSource] = useState("");
  const [topicsList, setTopicsList] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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

  // Login handler
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

  // Fetch topics list
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

  // Load Evaluation Data
  const loadEvaluation = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedTopic) params.set("topic", selectedTopic.toLowerCase());
      if (selectedSource) params.set("source", selectedSource);

      const res = await fetch(`/api/admin/evaluation?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics);
        setTopicBreakdown(data.topicBreakdown || []);
        setSourceBreakdown(data.sourceBreakdown || []);
        setTotalEvaluated(data.totalEvaluated || 0);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.error("Failed to load evaluation metrics:", e);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedTopic, selectedSource]);

  useEffect(() => {
    loadEvaluation();
  }, [loadEvaluation]);

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#edf1f7]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-xs font-medium text-slate-500">Loading Evaluation Suite...</p>
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
              <h1 className="text-lg font-bold text-slate-900">Evaluation Metrics</h1>
              <p className="text-xs text-slate-500">Enter master passkey to view architecture evaluation</p>
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
              {isLoggingIn ? "Unlocking..." : "Enter Evaluation Suite"}
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

  const getKappaBadgeColor = (kappa: number) => {
    if (kappa >= 0.8) return "bg-emerald-500/15 border-emerald-500/30 text-emerald-800";
    if (kappa >= 0.6) return "bg-teal-500/15 border-teal-500/30 text-teal-800";
    if (kappa >= 0.4) return "bg-amber-500/15 border-amber-500/30 text-amber-800";
    if (kappa >= 0.2) return "bg-orange-500/15 border-orange-500/30 text-orange-800";
    return "bg-rose-500/15 border-rose-500/30 text-rose-800";
  };

  return (
    <div className="min-h-screen bg-[#edf1f7] liquid-glass-canvas py-8 px-4 sm:px-8 space-y-8">
      {/* 1. Top Glass Header */}
      <header className="max-w-6xl w-full mx-auto relative z-10 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="liquid-pill-neutral px-4 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Admin Console</span>
            </Link>

            <Link
              href="/admin/annotate"
              className="liquid-pill-primary px-4 py-2 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <Sparkles className="h-3.5 w-3.5 text-white" />
              <span>Annotation Studio</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-slate-400 text-xs font-mono">
                Updated {lastUpdated}
              </span>
            )}

            <button
              type="button"
              onClick={loadEvaluation}
              disabled={isLoading}
              className="liquid-pill-neutral px-4 py-2 text-xs font-semibold flex items-center gap-2 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-indigo-600 ${isLoading ? "animate-spin" : ""}`} />
              <span>Refresh Metrics</span>
            </button>
          </div>
        </div>

        {/* Title & Filter Bar */}
        <div className="liquid-glass-inner rounded-3xl p-6 border border-white/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Architecture Evaluation & Agreement Metrics
              </h1>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl">
              Live validation of Qwen 2.5-3B calibrated sentiment predictions against human ground-truth annotations. Automatically updates in real time as you annotate tweets.
            </p>
          </div>

          {/* Slicing Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Topic Filter */}
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="liquid-pill-neutral px-3.5 py-2 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="">All Topics</option>
              {topicsList.map((top) => (
                <option key={top} value={top}>
                  {top}
                </option>
              ))}
            </select>

            {/* Source Filter */}
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="liquid-pill-neutral px-3.5 py-2 text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="">All Sample Sources</option>
              <option value="random">Random Sampling</option>
              <option value="uncertain">Uncertain Active Learning</option>
              <option value="import">Imported Dataset</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl w-full mx-auto relative z-10 space-y-8">
        {!metrics || totalEvaluated === 0 ? (
          /* Empty State */
          <div className="liquid-glass-slab rounded-[36px] p-16 text-center space-y-4 border border-white/85">
            <HelpCircle className="h-10 w-10 text-indigo-400 mx-auto" />
            <h2 className="text-lg font-bold text-slate-800">No Human Ground Truth Found</h2>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              You haven&apos;t annotated any tweets matching the current filter. Go to the Annotation Studio and label candidates to generate live evaluation metrics!
            </p>
            <div className="pt-2">
              <Link
                href="/admin/annotate"
                className="liquid-pill-primary px-6 py-2.5 text-xs font-bold inline-flex items-center gap-2 cursor-pointer shadow-md"
              >
                <Sparkles className="h-4 w-4 text-white" />
                <span>Open Annotation Studio</span>
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 2. Hero Cohen's Kappa Cards */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Award className="h-4 w-4 text-indigo-600" />
                  <span>Cohen&apos;s Kappa Inter-Rater Reliability Suite</span>
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Sample Size: <strong>{metrics.total} tweets</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* 1. Quadratically Weighted Kappa */}
                <div className="liquid-glass-slab rounded-[32px] p-6 border border-white/85 space-y-4 shadow-xl relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                      Quadratic Weighted Kappa (QWK)
                    </span>
                    <span className="text-[10px] font-mono text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                      Standard
                    </span>
                  </div>

                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight tabular-nums">
                      {metrics.kappaQuadratic}
                    </span>
                    <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${getKappaBadgeColor(metrics.kappaQuadratic)}`}>
                      {metrics.interpretation.quadratic}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Quadratic penalty: <code className="text-slate-700 font-mono">w = 1 - (i-j)²/4</code>. Heavily penalizes extreme polar flips (positive vs negative) while granting 75% agreement credit to adjacent confusion.
                  </p>
                </div>

                {/* 2. Linearly Weighted Kappa */}
                <div className="liquid-glass-slab rounded-[32px] p-6 border border-white/85 space-y-4 shadow-xl relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Linearly Weighted Kappa
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      Linear Distance
                    </span>
                  </div>

                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight tabular-nums">
                      {metrics.kappaLinear}
                    </span>
                    <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${getKappaBadgeColor(metrics.kappaLinear)}`}>
                      {metrics.interpretation.linear}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Linear penalty: <code className="text-slate-700 font-mono">w = 1 - |i-j|/2</code>. Penalizes misclassifications proportionally to their ordinal distance on the 3-point sentiment scale.
                  </p>
                </div>

                {/* 3. Unweighted Cohen's Kappa */}
                <div className="liquid-glass-slab rounded-[32px] p-6 border border-white/85 space-y-4 shadow-xl relative overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Unweighted Cohen&apos;s Kappa
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                      Exact Match
                    </span>
                  </div>

                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight tabular-nums">
                      {metrics.kappaUnweighted}
                    </span>
                    <span className={`text-xs font-extrabold px-3 py-1 rounded-full border ${getKappaBadgeColor(metrics.kappaUnweighted)}`}>
                      {metrics.interpretation.unweighted}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Exact agreement corrected for chance: <code className="text-slate-700 font-mono">(p_o - p_e) / (1 - p_e)</code>. Observed agreement: <strong>{(metrics.observedAgreement * 100).toFixed(1)}%</strong> vs chance: <strong>{(metrics.expectedAgreement * 100).toFixed(1)}%</strong>.
                  </p>
                </div>
              </div>
            </section>

            {/* 3. Core Architecture Metrics Grid */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4 text-[#6c94cc]" />
                <span>Classification & Risk Metrics</span>
              </h2>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {/* Accuracy */}
                <div className="liquid-glass-inner rounded-2xl p-5 border border-white/80 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Overall Accuracy
                  </span>
                  <div className="text-2xl font-black text-slate-900 tabular-nums">
                    {(metrics.accuracy * 100).toFixed(1)}%
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Exact match across all 3 classes
                  </p>
                </div>

                {/* Macro-F1 */}
                <div className="liquid-glass-inner rounded-2xl p-5 border border-white/80 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Macro-Averaged F1
                  </span>
                  <div className="text-2xl font-black text-slate-900 tabular-nums">
                    {(metrics.macroF1 * 100).toFixed(1)}%
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Weighted F1: {(metrics.weightedF1 * 100).toFixed(1)}%
                  </p>
                </div>

                {/* Polar Flip Rate (Catastrophic Error Risk) */}
                <div className="liquid-glass-inner rounded-2xl p-5 border border-white/80 space-y-1">
                  <span className="text-[11px] font-semibold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span>Polar Flip Rate</span>
                  </span>
                  <div className="text-2xl font-black text-rose-700 tabular-nums">
                    {(metrics.polarFlipRate * 100).toFixed(1)}%
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {metrics.polarFlipCount} extreme errors (pos ↔ neg)
                  </p>
                </div>

                {/* Adjacent Error Rate */}
                <div className="liquid-glass-inner rounded-2xl p-5 border border-white/80 space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Adjacent Error Rate
                  </span>
                  <div className="text-2xl font-black text-slate-900 tabular-nums">
                    {(metrics.offByOneRate * 100).toFixed(1)}%
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {metrics.offByOneCount} off-by-one errors (neu ↔ pos/neg)
                  </p>
                </div>
              </div>
            </section>

            {/* 4. Confusion Matrix Heatmap & Calibration */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Confusion Matrix (7 cols) */}
              <div className="lg:col-span-7 liquid-glass-slab rounded-[32px] p-6 border border-white/85 space-y-5 shadow-lg">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <span>3×3 Confusion Matrix</span>
                  </h3>
                  <span className="text-xs text-slate-400">
                    Rows: Human Ground Truth • Cols: Qwen 2.5
                  </span>
                </div>

                {/* Heatmap Grid */}
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="border-b border-white/60 text-slate-500">
                        <th className="py-2.5 px-3 text-left font-bold text-[11px] uppercase tracking-wider">
                          Human \ Model
                        </th>
                        <th className="py-2.5 px-3 font-bold text-rose-800 bg-rose-50/50 rounded-t-xl">
                          Pred Negative
                        </th>
                        <th className="py-2.5 px-3 font-bold text-amber-800 bg-amber-50/50 rounded-t-xl">
                          Pred Neutral
                        </th>
                        <th className="py-2.5 px-3 font-bold text-emerald-800 bg-emerald-50/50 rounded-t-xl">
                          Pred Positive
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/50 text-slate-800 font-mono text-sm">
                      {metrics.confusionMatrix.labels.map((humanLabel, hIdx) => {
                        const rowTotal = metrics.confusionMatrix.matrix[hIdx].reduce((a, b) => a + b, 0);

                        return (
                          <tr key={humanLabel}>
                            {/* Row Header */}
                            <td className="py-3 px-3 text-left font-sans font-bold text-slate-700 capitalize">
                              Actual {humanLabel}
                              <span className="block font-mono text-[10px] text-slate-400 font-normal">
                                N = {rowTotal}
                              </span>
                            </td>

                            {/* Cells */}
                            {metrics.confusionMatrix.labels.map((modelLabel, mIdx) => {
                              const count = metrics.confusionMatrix.matrix[hIdx][mIdx];
                              const cellPct = rowTotal > 0 ? ((count / rowTotal) * 100).toFixed(0) : "0";
                              const isDiagonal = hIdx === mIdx;
                              const isPolar = (hIdx === 0 && mIdx === 2) || (hIdx === 2 && mIdx === 0);

                              let cellBg = "bg-white/40 hover:bg-white/60";
                              let textColor = "text-slate-800";

                              if (isDiagonal) {
                                cellBg = "bg-emerald-500/15 border border-emerald-500/30";
                                textColor = "text-emerald-900 font-extrabold";
                              } else if (isPolar) {
                                cellBg = count > 0 ? "bg-rose-500/20 border border-rose-500/40" : "bg-white/20";
                                textColor = count > 0 ? "text-rose-900 font-bold" : "text-slate-300";
                              } else if (count > 0) {
                                cellBg = "bg-amber-500/10 border border-amber-500/20";
                                textColor = "text-amber-900 font-semibold";
                              }

                              return (
                                <td key={modelLabel} className="p-1.5">
                                  <div className={`p-3 rounded-2xl transition-all ${cellBg}`}>
                                    <div className={`text-base ${textColor} tabular-nums`}>
                                      {count}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-sans">
                                      {cellPct}%
                                    </div>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-200/50 pt-2">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" /> Diagonal = Agreement
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500" /> Extreme Corners = Polar Flips
                  </span>
                </div>
              </div>

              {/* Confidence Calibration & Error Analysis (5 cols) */}
              <div className="lg:col-span-5 liquid-glass-slab rounded-[32px] p-6 border border-white/85 space-y-5 shadow-lg flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-indigo-600" />
                      <span>Confidence Calibration</span>
                    </h3>
                  </div>

                  <p className="text-xs text-slate-500">
                    A well-calibrated architecture is confident when it is right, and uncertain when it is wrong.
                  </p>

                  <div className="space-y-3 pt-2">
                    {/* Mean Conf on Agreements */}
                    <div className="liquid-glass-inner rounded-2xl p-4 border border-white/80 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-slate-800">Confidence on Agreements</span>
                        <p className="text-[11px] text-slate-400">When model agrees with human</p>
                      </div>
                      <span className="text-lg font-black text-emerald-700 font-mono tabular-nums">
                        {(metrics.confidenceOnAgreements * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Mean Conf on Disagreements */}
                    <div className="liquid-glass-inner rounded-2xl p-4 border border-white/80 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-slate-800">Confidence on Disagreements</span>
                        <p className="text-[11px] text-slate-400">When model disagrees with human</p>
                      </div>
                      <span className="text-lg font-black text-amber-700 font-mono tabular-nums">
                        {(metrics.confidenceOnDisagreements * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Overconfident Errors */}
                    <div className="liquid-glass-inner rounded-2xl p-4 border border-white/80 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-rose-700">Overconfident Errors</span>
                        <p className="text-[11px] text-slate-400">Errors with &gt;80% model confidence</p>
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-black text-rose-700 font-mono tabular-nums">
                          {metrics.overconfidentDisagreementCount}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          ({(metrics.overconfidentDisagreementRate * 100).toFixed(0)}% of errors)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl p-3 bg-indigo-50/60 border border-indigo-100 text-[11px] text-indigo-900 leading-relaxed">
                  <strong>Insight:</strong> If confidence on agreements is significantly higher than disagreements, the architecture&apos;s probability calibration is functioning soundly.
                </div>
              </div>
            </div>

            {/* 5. Per-Class Precision, Recall, F1 Table */}
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Per-Class Detailed Evaluation Report
              </h2>

              <div className="liquid-glass-slab rounded-[32px] p-6 border border-white/85 shadow-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/60 text-slate-500">
                      <th className="py-3 px-4 font-bold uppercase tracking-wider">Class</th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider">Precision</th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider">Recall</th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider">F1-Score</th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider">Support (N)</th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-right">TP / FP / FN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/50 text-slate-800">
                    {(["positive", "neutral", "negative"] as SentimentLabel[]).map((label) => {
                      const c = metrics.perClass[label];
                      if (!c) return null;

                      let badgeClass = "liquid-pill-emerald";
                      if (label === "negative") badgeClass = "liquid-pill-rose";
                      if (label === "neutral") badgeClass = "liquid-pill-amber";

                      return (
                        <tr key={label} className="hover:bg-white/40 transition">
                          <td className="py-3.5 px-4 font-bold">
                            <span className={`${badgeClass} px-3 py-1 text-xs uppercase font-extrabold shadow-2xs`}>
                              {label}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-semibold tabular-nums text-slate-700">
                            {(c.precision * 100).toFixed(1)}%
                          </td>
                          <td className="py-3.5 px-4 font-mono font-semibold tabular-nums text-slate-700">
                            {(c.recall * 100).toFixed(1)}%
                          </td>
                          <td className="py-3.5 px-4 font-mono font-black tabular-nums text-indigo-900">
                            {(c.f1 * 100).toFixed(1)}%
                          </td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-slate-600 font-semibold">
                            {c.support}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px] tabular-nums text-slate-400 text-right">
                            {c.tp} / {c.fp} / {c.fn}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 6. Topic Breakdown Table */}
            {topicBreakdown.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Domain / Topic Breakdown
                  </h2>
                  <span className="text-xs text-slate-400">
                    {topicBreakdown.length} topics evaluated
                  </span>
                </div>

                <div className="liquid-glass-slab rounded-[32px] p-6 border border-white/85 shadow-lg overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/60 text-slate-500">
                        <th className="py-3 px-4 font-bold uppercase tracking-wider">Topic / Aspect</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider">Evaluated</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider">Accuracy</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider">Quadratic Kappa (QWK)</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider">Macro-F1</th>
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-right">Polar Flips</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/50 text-slate-800">
                      {topicBreakdown.map((t) => (
                        <tr key={t.topic} className="hover:bg-white/40 transition">
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {t.topic}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold tabular-nums text-slate-600">
                            {t.count}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold tabular-nums text-slate-700">
                            {(t.accuracy * 100).toFixed(1)}%
                          </td>
                          <td className="py-3 px-4 font-mono font-black tabular-nums text-indigo-900">
                            {t.qwk.toFixed(3)}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold tabular-nums text-slate-700">
                            {(t.macroF1 * 100).toFixed(1)}%
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right">
                            {t.polarFlips > 0 ? (
                              <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-800 font-bold text-[11px]">
                                {t.polarFlips}
                              </span>
                            ) : (
                              <span className="text-slate-300">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* 7. Active Learning Insight Banner */}
            {sourceBreakdown.length > 1 && (
              <section className="liquid-glass-inner rounded-3xl p-6 border border-white/85 shadow-sm space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-800 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-600" />
                  <span>Active Learning vs Random Sampling Comparison</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                  {sourceBreakdown.map((s) => (
                    <div key={s.source} className="bg-white/60 p-4 rounded-2xl border border-white/80 space-y-1">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider capitalize">
                        {s.source} ({s.count} tweets)
                      </span>
                      <div className="text-lg font-black text-slate-900 tabular-nums">
                        QWK: {s.qwk.toFixed(3)}
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Accuracy: {(s.accuracy * 100).toFixed(1)}% • Macro-F1: {(s.macroF1 * 100).toFixed(1)}%
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-6xl w-full mx-auto relative z-10 pt-4 text-center">
        <p className="text-[11px] text-slate-400">
          ABSA Studio Architecture Evaluation Engine • Landis &amp; Koch (1977) Ordinal Agreement Standards
        </p>
      </footer>
    </div>
  );
}
