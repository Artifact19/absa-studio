"use client";

import React from "react";
import { BadgeCheck } from "lucide-react";

interface ProvenanceBadgeProps {
  count: number;
}

export function ProvenanceBadge({ count }: ProvenanceBadgeProps) {
  return (
    <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-emerald-500/25 bg-emerald-50/80 px-2.5 sm:px-3 py-1 text-xs sm:text-sm font-medium text-emerald-800">
      <BadgeCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600 shrink-0" />
      <span>Analyzed from {count.toLocaleString()} verified public posts on X</span>
    </div>
  );
}
