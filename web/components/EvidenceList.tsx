"use client";

import React from "react";
import { Evidence } from "@/lib/types";
import { EvidenceCard } from "./EvidenceCard";
import { ThumbsUp, ThumbsDown } from "lucide-react";

interface EvidenceListProps {
  positiveEvidence: Evidence[];
  negativeEvidence: Evidence[];
}

export function EvidenceList({ positiveEvidence, negativeEvidence }: EvidenceListProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Positive Evidence Column */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ThumbsUp className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Top Positive Evidence
            </h3>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {positiveEvidence.length} posts
          </span>
        </div>

        {positiveEvidence.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center text-xs text-neutral-400 dark:border-neutral-800">
            No positive tweets found in this time window.
          </div>
        ) : (
          <div className="space-y-3">
            {positiveEvidence.map((item, idx) => (
              <EvidenceCard key={`pos-${idx}`} evidence={item} sentiment="positive" />
            ))}
          </div>
        )}
      </section>

      {/* Negative Evidence Column */}
      <section className="space-y-3">
        <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <ThumbsDown className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              Top Negative Evidence
            </h3>
          </div>
          <span className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
            {negativeEvidence.length} posts
          </span>
        </div>

        {negativeEvidence.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-200 p-8 text-center text-xs text-neutral-400 dark:border-neutral-800">
            No negative tweets found in this time window.
          </div>
        ) : (
          <div className="space-y-3">
            {negativeEvidence.map((item, idx) => (
              <EvidenceCard key={`neg-${idx}`} evidence={item} sentiment="negative" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
