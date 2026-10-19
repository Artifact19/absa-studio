"use client";

import React, { useState } from "react";
import { AdminTweet, SentimentLabel } from "@/lib/types";
import { ArrowUpDown, Search, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight } from "lucide-react";
import { format } from "date-fns";

interface TweetTableProps {
  tweets: AdminTweet[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  topicFilter: string;
  sentimentFilter: string;
  searchQuery: string;
  sortBy: string;
  onPageChange: (newPage: number) => void;
  onFilterChange: (filters: { topic?: string; sentiment?: string; q?: string; sort?: string }) => void;
}

export function TweetTable({
  tweets,
  total,
  page,
  pageSize,
  totalPages,
  isLoading,
  topicFilter,
  sentimentFilter,
  searchQuery,
  sortBy,
  onPageChange,
  onFilterChange,
}: TweetTableProps) {
  const [showCleanedText, setShowCleanedText] = useState(false);
  const [searchInput, setSearchInput] = useState(searchQuery);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onFilterChange({ q: searchInput });
  };

  const handleSortToggle = (field: "time" | "user" | "sentiment" | "confidence") => {
    const [currentField, currentDir] = sortBy.split(".");
    let nextDir = "desc";
    if (currentField === field && currentDir === "desc") {
      nextDir = "asc";
    }
    onFilterChange({ sort: `${field}.${nextDir}` });
  };

  const renderSentimentBadge = (sentiment: SentimentLabel) => {
    switch (sentiment) {
      case "positive":
        return (
          <span className="inline-flex items-center rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            positive
          </span>
        );
      case "negative":
        return (
          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
            negative
          </span>
        );
      case "neutral":
      default:
        return (
          <span className="inline-flex items-center rounded-md bg-slate-500/10 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
            neutral
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white/70 p-5 shadow-xs backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/70">
      {/* Table Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search tweet text or handle..."
            className="w-full rounded-xl border border-neutral-200 bg-white/80 py-2 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sentiment Filter */}
          <select
            value={sentimentFilter}
            onChange={(e) => onFilterChange({ sentiment: e.target.value })}
            className="rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs text-neutral-700 focus:border-indigo-500 focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          >
            <option value="">All Sentiments</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
            <option value="neutral">Neutral</option>
          </select>

          {/* Toggle raw vs cleaned text */}
          <button
            type="button"
            onClick={() => setShowCleanedText(!showCleanedText)}
            className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white/80 px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {showCleanedText ? (
              <ToggleRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-neutral-400" />
            )}
            <span>{showCleanedText ? "Cleaned Text" : "Raw Text"}</span>
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-400">
            <tr>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("time")}
                  className="flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  <span>Time</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold">Topic / Aspect</th>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("user")}
                  className="flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  <span>Handle</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("sentiment")}
                  className="flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  <span>Sentiment</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("confidence")}
                  className="flex items-center gap-1 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  <span>Confidence</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold min-w-[280px]">Tweet Content</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-neutral-800 dark:text-neutral-200">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-neutral-400">
                  Loading tweets...
                </td>
              </tr>
            ) : tweets.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-neutral-400">
                  No tweet records found matching current query.
                </td>
              </tr>
            ) : (
              tweets.map((t) => {
                const dateObj = new Date(t.tweeted_at);
                const timeStr = !isNaN(dateObj.getTime())
                  ? format(dateObj, "MMM d, yyyy HH:mm")
                  : t.tweeted_at;
                const displayText = showCleanedText ? t.cleaned_text : t.text;

                return (
                  <tr key={t.id} className="hover:bg-neutral-50/60 dark:hover:bg-neutral-850/40">
                    <td className="py-3 px-4 whitespace-nowrap text-neutral-500 tabular-nums">
                      {timeStr}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {t.aspect || t.topic_key}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-medium text-neutral-600 dark:text-neutral-300">
                      @{t.handle}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {renderSentimentBadge(t.sentiment)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                      {(t.confidence * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <p className="line-clamp-2 break-words text-xs leading-relaxed">
                        {displayText}
                      </p>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-2 text-xs text-neutral-500">
        <div>
          Showing {tweets.length} of {total.toLocaleString()} records (Page {page} of {Math.max(1, totalPages)})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange(page - 1)}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 font-medium hover:bg-neutral-50 disabled:opacity-40 disabled:pointer-events-none dark:border-neutral-800 dark:hover:bg-neutral-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Previous</span>
          </button>
          <button
            type="button"
            disabled={page >= totalPages || isLoading}
            onClick={() => onPageChange(page + 1)}
            className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1.5 font-medium hover:bg-neutral-50 disabled:opacity-40 disabled:pointer-events-none dark:border-neutral-800 dark:hover:bg-neutral-800"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
