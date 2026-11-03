"use client";

import React from "react";
import { BadgeCheck } from "lucide-react";

interface ProvenanceBadgeProps {
  count: number;
}

export function ProvenanceBadge({ count }: ProvenanceBadgeProps) {
  return (
    <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full glass-pill px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-800 shadow-2xs">
      <BadgeCheck className="h-4 w-4 text-emerald-600 shrink-0" />
      <span>
        Analyzed from <strong className="font-bold text-slate-900">{count.toLocaleString()}</strong> verified posts
      </span>
    </div>
  );
}
