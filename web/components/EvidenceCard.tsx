"use client";

import React, { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Evidence, SentimentLabel } from "@/lib/types";
import { sanitizeHandle } from "@/lib/clean";
import { PlatformIcon } from "./PlatformIcon";
import { ExternalLink, Brain } from "lucide-react";

interface EvidenceCardProps {
  evidence: Evidence;
  sentiment: SentimentLabel;
}

export function EvidenceCard({ evidence, sentiment }: EvidenceCardProps) {
  const [showRationale, setShowRationale] = useState(false);
  const safeHandle = sanitizeHandle(evidence.handle);
  const pct = Math.min(100, Math.max(0, Math.round(evidence.confidence * 100)));
  const isReddit = evidence.platform === "reddit";

  const dateObj = new Date(evidence.time);
  const isValidDate = !isNaN(dateObj.getTime());
  const relTime = isValidDate ? formatDistanceToNow(dateObj, { addSuffix: true }) : "recently";
  const absTime = isValidDate ? format(dateObj, "PPPpp") : "";

  const toneColor =
    sentiment === "positive"
      ? "bg-emerald-500"
      : sentiment === "negative"
      ? "bg-rose-500"
      : "bg-slate-400";

  return (
    <article className="rounded-2xl glass-panel p-4 sm:p-5 shadow-2xs transition-all hover:scale-101 hover:shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          {/* Platform Icon & User Handle */}
          <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
            <PlatformIcon platform={evidence.platform || "twitter"} className="h-3.5 w-3.5 shrink-0" />
            <span>{isReddit ? `u/${safeHandle}` : `@${safeHandle}`}</span>
          </span>

          {/* Subreddit Tag for Reddit posts */}
          {isReddit && evidence.subreddit && (
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-[#FF4500]">
              r/{evidence.subreddit}
            </span>
          )}

          {/* Direct External Link */}
          {evidence.url && (
            <a
              href={evidence.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View original post"
              className="text-slate-400 hover:text-slate-700 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <time dateTime={evidence.time} title={absTime} className="cursor-help font-medium">
          {relTime}
        </time>
      </header>

      {/* Post text rendered as plain React text node */}
      <p className="mt-2.5 line-clamp-4 whitespace-pre-wrap break-words text-xs sm:text-sm text-slate-700 leading-relaxed">
        {evidence.text}
      </p>

      {/* CoT Rationale / Reasoning Tag if available */}
      {evidence.rationale && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowRationale(!showRationale)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <Brain className="h-3 w-3 text-[#6c94cc]" />
            <span>{showRationale ? "Hide reasoning" : "Why was this classified?"}</span>
          </button>
          {showRationale && (
            <div className="mt-1.5 rounded-xl bg-slate-900/5 p-2.5 text-[11px] leading-relaxed text-slate-600 border border-slate-200/50">
              <span className="font-semibold text-slate-800">CoT Analysis: </span>
              {evidence.rationale}
            </div>
          )}
        </div>
      )}

      {/* Confidence meter */}
      <div
        className="mt-3.5 flex items-center gap-2"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Confidence ${pct}%`}
      >
        <div className="h-1.5 flex-1 rounded-full glass-track overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${toneColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs font-bold tabular-nums text-slate-600">
          {pct}%
        </span>
      </div>
    </article>
  );
}
