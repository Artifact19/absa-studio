"use client";

import React from "react";
import { BadgeCheck } from "lucide-react";
import { PlatformBreakdown } from "@/lib/types";
import { XIcon, RedditIcon } from "./PlatformIcon";

interface ProvenanceBadgeProps {
  count: number;
  platformBreakdown?: PlatformBreakdown;
}

export function ProvenanceBadge({ count, platformBreakdown }: ProvenanceBadgeProps) {
  const hasBreakdown = platformBreakdown && (platformBreakdown.twitter > 0 || platformBreakdown.reddit > 0);

  return (
    <div className="inline-flex flex-wrap items-center gap-2 sm:gap-2.5 rounded-full glass-pill px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-slate-800 shadow-2xs">
      <div className="flex items-center gap-1.5">
        <BadgeCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span>
          Analyzed from <strong className="font-bold text-slate-900">{count.toLocaleString()}</strong> verified posts
        </span>
      </div>

      {hasBreakdown && (
        <div className="flex items-center gap-1.5 border-l border-slate-300/60 pl-2 text-[11px] font-medium text-slate-600">
          {platformBreakdown.twitter > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/5 px-2 py-0.5 text-slate-900">
              <XIcon className="h-3 w-3 text-slate-900" />
              <span className="font-semibold">{platformBreakdown.twitter.toLocaleString()}</span>
            </span>
          )}
          {platformBreakdown.reddit > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[#FF4500]">
              <RedditIcon className="h-3.5 w-3.5" />
              <span className="font-semibold text-slate-900">{platformBreakdown.reddit.toLocaleString()}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
