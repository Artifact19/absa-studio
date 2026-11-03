"use client";

import React, { useState, useMemo } from "react";
import Image from "next/image";
import { Search, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { ApiKeyField } from "./ApiKeyField";
import { POPULAR_GENRES, normalizeGenre } from "@/lib/genre";

interface SearchBarProps {
  initialTopic?: string;
  onSearch: (topic: string, apiKey?: string) => void;
  isLoading: boolean;
  compact: boolean;
  suggestedTopics?: Array<{ topic_key: string; genre?: string; n: number }>;
}

export function SearchBar({
  initialTopic = "",
  onSearch,
  isLoading,
  compact,
  suggestedTopics = [],
}: SearchBarProps) {
  const [topic, setTopic] = useState(initialTopic);
  const [apiKey, setApiKey] = useState("");
  const [showApiKeyField, setShowApiKeyField] = useState(false);
  const [activeGenreFilter, setActiveGenreFilter] = useState("all");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isLoading) return;
    onSearch(topic.trim(), apiKey.trim() || undefined);
  };

  const handleSelectSuggested = (tKey: string) => {
    setTopic(tKey);
    onSearch(tKey, apiKey.trim() || undefined);
  };

  // Filter suggested topics by selected genre
  const filteredSuggestions = useMemo(() => {
    if (activeGenreFilter === "all") return suggestedTopics;
    return suggestedTopics.filter((s) => {
      const g = normalizeGenre(s.genre || s.topic_key);
      return g.toLowerCase().includes(activeGenreFilter.toLowerCase()) ||
        activeGenreFilter.toLowerCase().includes(g.toLowerCase());
    });
  }, [suggestedTopics, activeGenreFilter]);

  return (
    <div
      className={`w-full transition-all duration-300 ${
        compact ? "py-2" : "py-8 sm:py-14 flex flex-col items-center justify-center text-center"
      }`}
    >
      {!compact && (
        <div className="mb-7 sm:mb-9 max-w-2xl space-y-3 px-2">
          {/* Frosted VisionOS-style Hero Pill */}
          <div className="inline-flex items-center gap-2 rounded-full glass-pill px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-xs">
            <Image
              src="/cat-icon.png"
              alt="Cat Icon"
              width={16}
              height={16}
              className="h-4 w-4 rounded-sm object-contain"
            />
            <span className="text-slate-800">Target-Oriented Sentiment Intelligence</span>
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            See what people <span className="text-[#6c94cc]">really think</span>
          </h1>
          <p className="text-sm sm:text-base text-slate-600 max-w-lg mx-auto leading-relaxed">
            Search any phone, game, brand, or model. We isolate authentic sentiment toward your target, ignoring background noise.
          </p>
        </div>
      )}

      {/* Main Glass Search Capsule Form */}
      <form
        onSubmit={handleSubmit}
        className={`w-full transition-all duration-300 ${
          compact ? "max-w-4xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3" : "max-w-2xl px-2"
        }`}
      >
        <div className="relative flex-1">
          <div className="pointer-events-none absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-slate-400">
            <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Search any product, game, brand, or topic..."
            disabled={isLoading}
            className={`w-full rounded-full glass-input pl-11 sm:pl-12 pr-28 sm:pr-32 text-slate-900 placeholder:text-slate-400 focus:outline-none transition-all ${
              compact ? "py-2.5 text-xs sm:text-sm" : "py-3.5 sm:py-4 text-sm sm:text-base"
            }`}
          />
          <button
            type="submit"
            disabled={isLoading || !topic.trim()}
            className={`absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 rounded-full glass-pill-active font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 sm:gap-2 ${
              compact ? "px-3.5 py-1.5 text-xs" : "px-5 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm"
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin text-white" />
                <span>Analyzing</span>
              </>
            ) : (
              <span>Analyze</span>
            )}
          </button>
        </div>

        {/* Collapsible Api Key field button in compact mode */}
        {compact && (
          <button
            type="button"
            onClick={() => setShowApiKeyField(!showApiKeyField)}
            className={`flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all shrink-0 ${
              showApiKeyField || apiKey
                ? "glass-pill-active"
                : "glass-pill text-slate-700"
            }`}
          >
            <span>FetchLayer Key</span>
            {showApiKeyField ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </form>

      {/* Hero mode API Key toggle */}
      {!compact && (
        <div className="mt-3 w-full max-w-2xl px-2 text-left">
          <button
            type="button"
            onClick={() => setShowApiKeyField(!showApiKeyField)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            <span>{showApiKeyField ? "Hide" : "Use your own"} FetchLayer key (optional)</span>
            {showApiKeyField ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {/* Collapsible FetchLayer API Key Drawer */}
      {showApiKeyField && (
        <div className={`mt-3 w-full px-2 sm:px-0 ${compact ? "max-w-4xl" : "max-w-2xl"}`}>
          <div className="rounded-3xl glass-panel p-4 shadow-sm">
            <ApiKeyField apiKey={apiKey} onChange={setApiKey} />
          </div>
        </div>
      )}

      {/* Genre Filter & Suggested Topics (Hero Mode) */}
      {!compact && suggestedTopics.length > 0 && (
        <div className="mt-8 w-full max-w-3xl px-2 space-y-3">
          {/* Genre Category Pills */}
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {POPULAR_GENRES.map((g) => {
              const isSelected = activeGenreFilter === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setActiveGenreFilter(g.id)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all cursor-pointer ${
                    isSelected
                      ? "glass-pill-active shadow-sm"
                      : "glass-pill text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>

          {/* Filtered Topic Capsules */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {filteredSuggestions.slice(0, 8).map((s) => {
              const genre = s.genre || normalizeGenre(s.topic_key);
              return (
                <button
                  key={s.topic_key}
                  type="button"
                  onClick={() => handleSelectSuggested(s.topic_key)}
                  className="group rounded-full glass-pill px-3.5 py-1.5 text-xs font-medium text-slate-800 transition-all hover:scale-102 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="font-semibold max-w-[140px] sm:max-w-[200px] truncate inline-block align-middle">
                    {s.topic_key}
                  </span>
                  <span className="text-[10px] text-slate-400 group-hover:text-slate-600 font-normal">
                    · {genre} ({s.n})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
