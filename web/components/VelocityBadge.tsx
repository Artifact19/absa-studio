"use client";

import React from "react";
import { VelocityData } from "@/lib/types";

interface VelocityBadgeProps {
  velocity: VelocityData;
}

export function VelocityBadge({ velocity }: VelocityBadgeProps) {
  if (!velocity || velocity.state === "insufficient") {
    return null;
  }

  const sign = velocity.delta > 0 ? `+${velocity.delta}%` : `${velocity.delta}%`;

  if (velocity.state === "bullish") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300">
        <span>🚀</span>
        <span>Bullish Momentum ({sign} vs. baseline)</span>
      </span>
    );
  }

  if (velocity.state === "declining") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-500/40 dark:text-rose-300">
        <span>🔻</span>
        <span>Declining Sentiment ({sign} vs. baseline)</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      <span>⚖️</span>
      <span>Stable Consensus (±3% consistent over time)</span>
    </span>
  );
}
