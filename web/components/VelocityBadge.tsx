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
      <span className="inline-flex items-center gap-1.5 rounded-full glass-pill px-3.5 py-1.5 text-xs font-semibold text-emerald-800 shadow-2xs">
        <span>🚀</span>
        <span>Bullish Momentum ({sign} vs. baseline)</span>
      </span>
    );
  }

  if (velocity.state === "declining") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full glass-pill px-3.5 py-1.5 text-xs font-semibold text-rose-800 shadow-2xs">
        <span>🔻</span>
        <span>Declining Sentiment ({sign} vs. baseline)</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full glass-pill px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs">
      <span>⚖️</span>
      <span>Stable Consensus (±3% consistent)</span>
    </span>
  );
}
