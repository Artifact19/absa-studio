"use client";

import React, { useState } from "react";
import { Play, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

interface ScrapeFormProps {
  onJobComplete: () => void;
}

interface ScrapeProgress {
  stage: string;
  message?: string;
  done: number;
  total: number;
  inserted?: number;
  duplicates?: number;
}

export function ScrapeForm({ onJobComplete }: ScrapeFormProps) {
  const [query, setQuery] = useState("");
  const [tweetCount, setTweetCount] = useState(100);
  const [topicOverride, setTopicOverride] = useState("");
  const [fetchlayerKey, setFetchlayerKey] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);
  const [logMessages, setLogMessages] = useState<string[]>([]);

  const handleStartScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isRunning) return;

    setIsRunning(true);
    setProgress({ stage: "initializing", done: 0, total: tweetCount });
    setLogMessages([`Initiating scrape pipeline for "${query}"...`]);

    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query.trim(),
          tweetCount,
          topicOverride: topicOverride.trim() || undefined,
          fetchlayerKey: fetchlayerKey.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(`Scrape failed (${res.status}): ${errorText || res.statusText}`);
      }

      if (!res.body) {
        throw new Error("No readable response body from server.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const data = JSON.parse(trimmed);
            setProgress(data);

            if (data.message) {
              setLogMessages((prev) => [...prev.slice(-30), data.message]);
            }

            if (data.stage === "completed") {
              onJobComplete();
            }
          } catch {
            // Ignore malformed json stream frames
          }
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Scraper execution failed";
      setProgress({ stage: "error", done: 0, total: tweetCount, message: errorMsg });
      setLogMessages((prev) => [...prev, `[ERROR] ${errorMsg}`]);
    } finally {
      setIsRunning(false);
    }
  };

  const progressPct = progress
    ? Math.min(100, Math.round((progress.done / (progress.total || 1)) * 100))
    : 0;

  return (
    <div className="rounded-3xl glass-panel p-6 shadow-xs">
      <form onSubmit={handleStartScrape} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          {/* Query */}
          <div className="lg:col-span-2">
            <label className="text-xs font-semibold text-slate-600">
              Search Query *
            </label>
            <input
              type="text"
              required
              disabled={isRunning}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. iPhone 17 or #Nvidia"
              className="mt-1 w-full rounded-full glass-input px-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>

          {/* Tweet Count */}
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Tweet Count (1-500)
            </label>
            <input
              type="number"
              min="1"
              max="500"
              disabled={isRunning}
              value={tweetCount}
              onChange={(e) => setTweetCount(parseInt(e.target.value, 10) || 100)}
              className="mt-1 w-full rounded-full glass-input px-4 py-2 text-xs text-slate-900 focus:outline-none"
            />
          </div>

          {/* Topic Override */}
          <div>
            <label className="text-xs font-semibold text-slate-600">
              Topic Key Override (Optional)
            </label>
            <input
              type="text"
              disabled={isRunning}
              value={topicOverride}
              onChange={(e) => setTopicOverride(e.target.value)}
              placeholder="Leave blank for auto-detect"
              className="mt-1 w-full rounded-full glass-input px-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
        </div>

        {/* Optional Custom FetchLayer Key */}
        <div>
          <label className="text-xs font-semibold text-slate-600">
            FetchLayer API Key (Optional override; uses server env if omitted)
          </label>
          <input
            type="password"
            disabled={isRunning}
            value={fetchlayerKey}
            onChange={(e) => setFetchlayerKey(e.target.value)}
            placeholder="fl_live_..."
            className="mt-1 w-full rounded-full glass-input px-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="submit"
            disabled={isRunning || !query.trim()}
            className="flex items-center gap-2 rounded-full glass-pill-active px-6 py-2.5 text-xs font-semibold shadow-xs disabled:opacity-50 disabled:pointer-events-none transition-all cursor-pointer"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-white" />
                <span>Processing Pipeline...</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                <span>Start Ingestion Job</span>
              </>
            )}
          </button>

          {isRunning && (
            <span className="text-xs font-semibold text-[#6c94cc] animate-pulse">
              Stage: {progress?.stage || "processing"}
            </span>
          )}
        </div>
      </form>

      {/* Live Stream Progress Bar & Activity Log */}
      {progress && (
        <div className="mt-5 space-y-3 rounded-2xl glass-panel p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 capitalize flex items-center gap-1.5">
              {progress.stage === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : progress.stage === "error" ? (
                <AlertCircle className="h-4 w-4 text-rose-500" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#6c94cc]" />
              )}
              Status: {progress.stage}
            </span>
            <span className="font-mono tabular-nums text-slate-500 font-semibold">
              {progress.done} / {progress.total} ({progressPct}%)
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full glass-track p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                progress.stage === "error"
                  ? "bg-rose-500"
                  : progress.stage === "completed"
                  ? "bg-emerald-500"
                  : "bg-[#6c94cc]"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Activity terminal log */}
          <div className="rounded-xl bg-slate-900 p-3 font-mono text-[11px] text-slate-300 space-y-1 max-h-32 overflow-y-auto">
            {logMessages.map((msg, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-slate-500 select-none">&gt;</span>
                <span>{msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
