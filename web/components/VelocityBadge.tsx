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
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-50/80 px-2.5 sm:px-3 py-1 text-xs font-semibold text-emerald-800">
        <span>🚀</span>
        <span>Bullish Momentum ({sign} vs. baseline)</span>
      </span>
    );
  }

  if (velocity.state === "declining") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-50/80 px-2.5 sm:px-3 py-1 text-xs font-semibold text-rose-800">
        <span>🔻</span>
        <span>Declining Sentiment ({sign} vs. baseline)</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-stone-100/80 px-2.5 sm:px-3 py-1 text-xs font-semibold text-stone-700">
      <span>⚖️</span>
      <span>Stable Consensus (±3% consistent over time)</span>
    </span>
  );
}
