"use client";

import React from "react";
import { BadgeCheck } from "lucide-react";

interface ProvenanceBadgeProps {
  count: number;
}

export function ProvenanceBadge({ count }: ProvenanceBadgeProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
      <BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      <span>Analyzed from {count.toLocaleString()} verified public posts on X</span>
    </div>
  );
}
