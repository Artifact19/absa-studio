"use client";

import React, { useState, useMemo } from "react";
import { Evidence, SocialPlatform } from "@/lib/types";
import { EvidenceCard } from "./EvidenceCard";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { XIcon, RedditIcon } from "./PlatformIcon";

interface EvidenceListProps {
  positiveEvidence: Evidence[];
  negativeEvidence: Evidence[];
}

export function EvidenceList({ positiveEvidence, negativeEvidence }: EvidenceListProps) {
  const [platformFilter, setPlatformFilter] = useState<"all" | SocialPlatform>("all");

  const filterItems = (items: Evidence[]) => {
    if (platformFilter === "all") return items;
    return items.filter((item) => (item.platform || "twitter") === platformFilter);
  };

  const filteredPos = useMemo(() => filterItems(positiveEvidence), [positiveEvidence, platformFilter]);
  const filteredNeg = useMemo(() => filterItems(negativeEvidence), [negativeEvidence, platformFilter]);

  const allItems = useMemo(() => [...positiveEvidence, ...negativeEvidence], [positiveEvidence, negativeEvidence]);
  const twitterCount = useMemo(() => allItems.filter((i) => (i.platform || "twitter") === "twitter").length, [allItems]);
  const redditCount = useMemo(() => allItems.filter((i) => i.platform === "reddit").length, [allItems]);

  return (
    <div className="space-y-4">
      {/* Platform Filter Segmented Tabs */}
      <div className="flex items-center gap-1.5 p-1 rounded-full glass-track max-w-fit">
        <button
          type="button"
          onClick={() => setPlatformFilter("all")}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
            platformFilter === "all"
              ? "glass-pill-active shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>All Platforms</span>
          <span className="text-[10px] opacity-75">({allItems.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setPlatformFilter("twitter")}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
            platformFilter === "twitter"
              ? "glass-pill-active shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <XIcon className="h-3 w-3" />
          <span>𝕏</span>
          <span className="text-[10px] opacity-75">({twitterCount})</span>
        </button>

        <button
          type="button"
          onClick={() => setPlatformFilter("reddit")}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
            platformFilter === "reddit"
              ? "glass-pill-active shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <RedditIcon className="h-3.5 w-3.5" />
          <span>Reddit</span>
          <span className="text-[10px] opacity-75">({redditCount})</span>
        </button>
      </div>

      {/* Two Column Grid */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Positive Evidence Column */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <ThumbsUp className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                Top Positive Evidence
              </h3>
            </div>
            <span className="rounded-full glass-pill px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              {filteredPos.length} posts
            </span>
          </div>

          {filteredPos.length === 0 ? (
            <div className="rounded-2xl glass-panel p-6 sm:p-8 text-center text-xs text-slate-400">
              No positive posts found for {platformFilter === "all" ? "this window" : platformFilter}.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPos.map((item, idx) => (
                <EvidenceCard key={`pos-${idx}-${item.handle}`} evidence={item} sentiment="positive" />
              ))}
            </div>
          )}
        </section>

        {/* Negative Evidence Column */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
                <ThumbsDown className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                Top Negative Evidence
              </h3>
            </div>
            <span className="rounded-full glass-pill px-2.5 py-0.5 text-xs font-semibold text-rose-800">
              {filteredNeg.length} posts
            </span>
          </div>

          {filteredNeg.length === 0 ? (
            <div className="rounded-2xl glass-panel p-6 sm:p-8 text-center text-xs text-slate-400">
              No negative posts found for {platformFilter === "all" ? "this window" : platformFilter}.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredNeg.map((item, idx) => (
                <EvidenceCard key={`neg-${idx}-${item.handle}`} evidence={item} sentiment="negative" />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
