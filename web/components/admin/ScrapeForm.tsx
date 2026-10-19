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
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as ScrapeProgress;
            setProgress(event);
            if (event.message) {
              setLogMessages((prev) => [...prev.slice(-10), event.message!]);
            }
          } catch {
            // Ignore non-json chunk
          }
        }
      }

      onJobComplete();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Scrape job failed";
      setLogMessages((prev) => [...prev, `Error: ${msg}`]);
      setProgress((prev) => ({
        stage: "error",
        done: prev?.done || 0,
        total: tweetCount,
        message: msg,
      }));
    } finally {
      setIsRunning(false);
    }
  };

  const progressPct = progress
    ? Math.min(100, Math.max(0, Math.round((progress.done / (progress.total || 1)) * 100)))
    : 0;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white/70 p-5 shadow-xs backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/70">
      <div className="flex items-center justify-between border-b border-neutral-200/80 pb-3 dark:border-neutral-800">
        <div>
          <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
            Manual Scrape & Ingestion Pipeline
          </h3>
          <p className="text-xs text-neutral-500">
            Fetch fresh tweets via FetchLayer, deduplicate against Supabase, and classify with Qwen2.5-3B.
          </p>
        </div>
      </div>

      <form onSubmit={handleStartScrape} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Query */}
          <div className="lg:col-span-2">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Search Query *
            </label>
            <input
              type="text"
              required
              disabled={isRunning}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. iPhone 17 or #Nvidia"
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>

          {/* Tweet Count */}
          <div>
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Tweet Count (1-500)
            </label>
            <input
              type="number"
              min="1"
              max="500"
              disabled={isRunning}
              value={tweetCount}
              onChange={(e) => setTweetCount(parseInt(e.target.value, 10) || 100)}
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs text-neutral-900 focus:border-indigo-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>

          {/* Topic Override */}
          <div>
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Topic Key Override (Optional)
            </label>
            <input
              type="text"
              disabled={isRunning}
              value={topicOverride}
              onChange={(e) => setTopicOverride(e.target.value)}
              placeholder="Leave blank for auto-detect"
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </div>
        </div>

        {/* Optional Custom FetchLayer Key */}
        <div>
          <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            FetchLayer API Key (Optional override; uses server env if omitted)
          </label>
          <input
            type="password"
            disabled={isRunning}
            value={fetchlayerKey}
            onChange={(e) => setFetchlayerKey(e.target.value)}
            placeholder="fl_live_..."
            className="mt-1 w-full rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="submit"
            disabled={isRunning || !query.trim()}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-all"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
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
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 animate-pulse">
              Stage: {progress?.stage || "processing"}
            </span>
          )}
        </div>
      </form>

      {/* Live Stream Progress Bar & Activity Log */}
      {progress && (
        <div className="mt-5 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300 capitalize flex items-center gap-1.5">
              {progress.stage === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : progress.stage === "error" ? (
                <AlertCircle className="h-4 w-4 text-rose-500" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-500" />
              )}
              Status: {progress.stage}
            </span>
            <span className="font-mono tabular-nums text-neutral-500">
              {progress.done} / {progress.total} ({progressPct}%)
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div
              className={`h-full transition-all duration-300 ${
                progress.stage === "error"
                  ? "bg-rose-500"
                  : progress.stage === "completed"
                  ? "bg-emerald-500"
                  : "bg-indigo-600"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Activity terminal log */}
          <div className="rounded-lg bg-neutral-900 p-3 font-mono text-[11px] text-neutral-300 dark:bg-black space-y-1 max-h-32 overflow-y-auto">
            {logMessages.map((msg, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-neutral-500 select-none">&gt;</span>
                <span>{msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
