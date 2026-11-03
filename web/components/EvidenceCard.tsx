"use client";

import React from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Evidence, SentimentLabel } from "@/lib/types";
import { sanitizeHandle } from "@/lib/clean";

interface EvidenceCardProps {
  evidence: Evidence;
}

export function EvidenceCard({
  evidence,
  sentiment,
}: EvidenceCardProps & { sentiment: SentimentLabel }) {
  const safeHandle = sanitizeHandle(evidence.handle);
  const pct = Math.min(100, Math.max(0, Math.round(evidence.confidence * 100)));

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
      <header className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-bold text-slate-900">
          @{safeHandle}
        </span>
        <time dateTime={evidence.time} title={absTime} className="cursor-help font-medium">
          {relTime}
        </time>
      </header>

      {/* Tweet text rendered as plain React text node */}
      <p className="mt-2.5 line-clamp-4 whitespace-pre-wrap break-words text-xs sm:text-sm text-slate-700 leading-relaxed">
        {evidence.text}
      </p>

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
