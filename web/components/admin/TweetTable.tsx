"use client";

import React, { useState } from "react";
import { AdminTweet, SentimentLabel } from "@/lib/types";
import { ArrowUpDown, Search, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { PlatformIcon } from "@/components/PlatformIcon";

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
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            positive
          </span>
        );
      case "negative":
        return (
          <span className="inline-flex items-center rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
            negative
          </span>
        );
      case "neutral":
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            neutral
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 rounded-3xl glass-panel p-5 shadow-xs">
      {/* Table Controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search post text or handle..."
            className="w-full rounded-full glass-input py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sentiment Filter */}
          <select
            value={sentimentFilter}
            onChange={(e) => onFilterChange({ sentiment: e.target.value })}
            className="rounded-full glass-pill px-3 py-1.5 text-xs text-slate-700 focus:outline-none"
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
            className="flex items-center gap-1.5 rounded-full glass-pill px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            {showCleanedText ? (
              <ToggleRight className="h-4 w-4 text-[#6c94cc]" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-slate-400" />
            )}
            <span>{showCleanedText ? "Cleaned Text" : "Raw Text"}</span>
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-2xl glass-panel">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/60 bg-white/40 text-slate-500">
            <tr>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("time")}
                  className="flex items-center gap-1 hover:text-slate-900"
                >
                  <span>Time</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold">Platform</th>
              <th className="py-3 px-4 font-semibold">Topic / Aspect</th>
              <th className="py-3 px-4 font-semibold">Genre</th>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("user")}
                  className="flex items-center gap-1 hover:text-slate-900"
                >
                  <span>Author</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("sentiment")}
                  className="flex items-center gap-1 hover:text-slate-900"
                >
                  <span>Sentiment</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold">
                <button
                  type="button"
                  onClick={() => handleSortToggle("confidence")}
                  className="flex items-center gap-1 hover:text-slate-900"
                >
                  <span>Confidence</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="py-3 px-4 font-semibold min-w-[280px]">Post Content</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/40 text-slate-800">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  Loading posts...
                </td>
              </tr>
            ) : tweets.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400">
                  No post records found matching current query.
                </td>
              </tr>
            ) : (
              tweets.map((t) => {
                const dateObj = new Date(t.tweeted_at);
                const timeStr = !isNaN(dateObj.getTime())
                  ? format(dateObj, "MMM d, yyyy HH:mm")
                  : t.tweeted_at;
                const displayText = showCleanedText ? t.cleaned_text : t.text;
                const isReddit = t.platform === "reddit";

                return (
                  <tr key={t.id} className="hover:bg-white/40 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap text-slate-500 tabular-nums">
                      {timeStr}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-full glass-pill px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                        <PlatformIcon platform={t.platform || "twitter"} className="h-3.5 w-3.5" />
                        <span>{isReddit ? (t.subreddit ? `r/${t.subreddit}` : "Reddit") : "𝕏"}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-bold text-slate-900">
                      {t.aspect || t.topic_key}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {t.genre ? (
                        <span className="inline-flex rounded-full glass-pill px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {t.genre}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <span>{isReddit ? `u/${t.handle}` : `@${t.handle}`}</span>
                        {t.context_url && (
                          <a
                            href={t.context_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {renderSentimentBadge(t.sentiment)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono tabular-nums text-slate-600 font-semibold">
                      {(t.confidence * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 max-w-md">
                      <p className="line-clamp-2 break-words text-xs leading-relaxed text-slate-700">
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-2 text-xs text-slate-500">
        <div>
          Showing {tweets.length} of {total.toLocaleString()} records (Page {page} of {Math.max(1, totalPages)})
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange(page - 1)}
            className="flex items-center gap-1 rounded-full glass-pill px-3 py-1.5 font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Previous</span>
          </button>
          <button
            type="button"
            disabled={page >= totalPages || isLoading}
            onClick={() => onPageChange(page + 1)}
            className="flex items-center gap-1 rounded-full glass-pill px-3 py-1.5 font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
