"use client";

import React from "react";
import { AdminStats } from "@/lib/types";
import { Database, HardDrive, Layers, Clock, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { format } from "date-fns";

interface StatsGridProps {
  stats: AdminStats | null;
  isLoading: boolean;
}

export function StatsGrid({ stats, isLoading }: StatsGridProps) {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-3xl glass-panel opacity-60" />
        ))}
      </div>
    );
  }

  const storageMb = stats.storageBytes / (1024 * 1024);
  const limitMb = stats.storageLimitBytes / (1024 * 1024);
  const storagePct = Math.min(100, Math.max(0, (stats.storageBytes / stats.storageLimitBytes) * 100));

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Topics */}
        <div className="rounded-3xl glass-panel p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Topics</span>
            <Layers className="h-4 w-4 text-[#6c94cc]" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
            {stats.totalTopics.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Oldest: {formatDate(stats.oldestRecord)}
          </div>
        </div>

        {/* Total Records */}
        <div className="rounded-3xl glass-panel p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Records</span>
            <Database className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
            {stats.totalRecords.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Newest: {formatDate(stats.newestRecord)}
          </div>
        </div>

        {/* Sentiment Distribution */}
        <div className="rounded-3xl glass-panel p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Sentiment Split</span>
            <Clock className="h-4 w-4 text-[#6c94cc]" />
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs font-medium">
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <ThumbsUp className="h-3 w-3" />
              {stats.sentimentCounts.positive.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-slate-600 font-semibold">
              <Minus className="h-3 w-3" />
              {stats.sentimentCounts.neutral.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-rose-600 font-semibold">
              <ThumbsDown className="h-3 w-3" />
              {stats.sentimentCounts.negative.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full glass-track p-0.5">
            <div
              className="bg-emerald-500 rounded-l-full"
              style={{
                width: `${(stats.sentimentCounts.positive / (stats.totalRecords || 1)) * 100}%`,
              }}
            />
            <div
              className="bg-slate-400"
              style={{
                width: `${(stats.sentimentCounts.neutral / (stats.totalRecords || 1)) * 100}%`,
              }}
            />
            <div
              className="bg-rose-500 rounded-r-full"
              style={{
                width: `${(stats.sentimentCounts.negative / (stats.totalRecords || 1)) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Supabase Free Storage Meter */}
        <div className="rounded-3xl glass-panel p-5 shadow-xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">Supabase Storage</span>
            <HardDrive className="h-4 w-4 text-[#6c94cc]" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900 tabular-nums">
            {storageMb.toFixed(1)}{" "}
            <span className="text-xs font-normal text-slate-500">/ {limitMb.toFixed(0)} MB</span>
          </div>
          <div className="mt-2">
            <div className="flex h-2 w-full overflow-hidden rounded-full glass-track p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  storagePct > 80 ? "bg-rose-500" : storagePct > 50 ? "bg-amber-500" : "bg-[#6c94cc]"
                }`}
                style={{ width: `${Math.max(1, storagePct)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              <span>{storagePct.toFixed(1)}% used</span>
              <span>Limit: 500 MB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
