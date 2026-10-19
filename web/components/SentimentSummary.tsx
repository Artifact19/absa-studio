"use client";

import React from "react";
import { AnalyzeResponse } from "@/lib/types";

interface SentimentSummaryProps {
  data: AnalyzeResponse;
}

export function SentimentSummary({ data }: SentimentSummaryProps) {
  const { counts, weighted, rawVerdict } = data;
  const total = counts.total || 1;

  const rawPosPct = Math.round((counts.positive / total) * 100);
  const rawNegPct = Math.round((counts.negative / total) * 100);
  const rawNeuPct = Math.round((counts.neutral / total) * 100);

  const verdictStyles = {
    positive: {
      badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
      dot: "bg-emerald-500",
      label: "Positive Stance",
    },
    negative: {
      badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
      dot: "bg-rose-500",
      label: "Negative Stance",
    },
    neutral: {
      badge: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
      dot: "bg-slate-400",
      label: "Neutral / Objective",
    },
  }[weighted.verdict];

  return (
    <div className="rounded-2xl border border-stone-200/90 bg-white/90 p-4 sm:p-6 shadow-xs backdrop-blur-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Overall Public Feeling
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-sm sm:text-base font-bold capitalize ${verdictStyles.badge}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${verdictStyles.dot}`} />
              Mostly {weighted.verdict}
            </span>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Total Posts
          </div>
          <div className="mt-1 text-xl sm:text-2xl font-black text-stone-900 tabular-nums">
            {counts.total.toLocaleString()} <span className="text-xs font-normal text-stone-500">posts</span>
          </div>
        </div>
      </div>

      {/* Segmented Progress Bar */}
      <div className="mt-6">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-stone-100 p-0.5">
          <div
            className="h-full rounded-l-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${weighted.pctPos}%` }}
            title={`Positive: ${weighted.pctPos}% (raw ${rawPosPct}%)`}
          />
          <div
            className="h-full bg-stone-400 transition-all duration-500"
            style={{ width: `${weighted.pctNeu}%` }}
            title={`Neutral: ${weighted.pctNeu}% (raw ${rawNeuPct}%)`}
          />
          <div
            className="h-full rounded-r-full bg-rose-500 transition-all duration-500"
            style={{ width: `${weighted.pctNeg}%` }}
            title={`Negative: ${weighted.pctNeg}% (raw ${rawNegPct}%)`}
          />
        </div>

        {/* Legend with raw vs recency weighted shares */}
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-50/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 font-medium text-emerald-900">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Positive
            </span>
            <span className="text-stone-700">
              <strong className="font-bold text-emerald-800 tabular-nums">{rawPosPct}%</strong>{" "}
              <span className="text-[11px] text-stone-500">(weighted {weighted.pctPos}%)</span>
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-stone-300/80 bg-stone-100/60 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 font-medium text-stone-700">
              <span className="h-2 w-2 rounded-full bg-stone-400" />
              Neutral
            </span>
            <span className="text-stone-700">
              <strong className="font-bold text-stone-800 tabular-nums">{rawNeuPct}%</strong>{" "}
              <span className="text-[11px] text-stone-500">(weighted {weighted.pctNeu}%)</span>
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-50/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 font-medium text-rose-900">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Negative
            </span>
            <span className="text-stone-700">
              <strong className="font-bold text-rose-800 tabular-nums">{rawNegPct}%</strong>{" "}
              <span className="text-[11px] text-stone-500">(weighted {weighted.pctNeg}%)</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
