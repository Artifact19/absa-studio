"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Search, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { ApiKeyField } from "./ApiKeyField";

interface SearchBarProps {
  initialTopic?: string;
  onSearch: (topic: string, apiKey?: string) => void;
  isLoading: boolean;
  compact: boolean;
  suggestedTopics?: Array<{ topic_key: string; n: number }>;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || isLoading) return;
    onSearch(topic.trim(), apiKey.trim() || undefined);
  };

  const handleSelectSuggested = (tKey: string) => {
    setTopic(tKey);
    onSearch(tKey, apiKey.trim() || undefined);
  };

  return (
    <div
      className={`w-full transition-all duration-300 ${
        compact ? "py-2" : "py-8 sm:py-12 flex flex-col items-center justify-center text-center"
      }`}
    >
      {!compact && (
        <div className="mb-6 sm:mb-8 max-w-2xl space-y-3 px-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/80 px-3.5 py-1 text-xs font-semibold text-amber-800 shadow-2xs">
            <Image
              src="/cat-icon.png"
              alt="Cat Icon"
              width={16}
              height={16}
              className="h-4 w-4 rounded-sm object-contain"
            />
            <span>Real opinions. Zero noise.</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-stone-900 sm:text-5xl">
            See what people <span className="text-amber-600">really think</span>
          </h1>
          <p className="text-sm sm:text-base text-stone-600 max-w-lg mx-auto leading-relaxed">
            Search any phone, game, brand, or celebrity. We scan recent posts, ignore the junk, and tell you if people actually like it or not.
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`w-full transition-all duration-300 ${
          compact ? "max-w-4xl flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3" : "max-w-2xl px-2"
        }`}
      >
        <div className="relative flex-1">
          <div className="pointer-events-none absolute left-3.5 sm:left-4 top-1/2 -translate-y-1/2 text-stone-400">
            <Search className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Search anything (e.g. iPhone 17, GTA 6)..."
            disabled={isLoading}
            className={`w-full rounded-2xl border border-stone-300/90 bg-white/95 pl-10 sm:pl-11 pr-24 sm:pr-28 text-stone-900 shadow-xs placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-4 focus:ring-amber-500/15 ${
              compact ? "py-2.5 text-xs sm:text-sm" : "py-3 sm:py-3.5 text-sm sm:text-base"
            }`}
          />
          <button
            type="submit"
            disabled={isLoading || !topic.trim()}
            className={`absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 rounded-xl bg-amber-600 font-semibold text-white shadow-xs transition-all hover:bg-amber-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 sm:gap-2 ${
              compact ? "px-3 py-1.5 text-xs" : "px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm"
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" />
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
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors shrink-0 ${
              showApiKeyField || apiKey
                ? "border-amber-400 bg-amber-50 text-amber-800"
                : "border-stone-200 bg-white/90 text-stone-600 hover:bg-stone-50 hover:text-stone-900"
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
            className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-500 hover:text-stone-800 transition-colors"
          >
            <span>{showApiKeyField ? "Hide" : "Use your own"} FetchLayer key (optional)</span>
            {showApiKeyField ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {/* Collapsible FetchLayer API Key Drawer */}
      {showApiKeyField && (
        <div className={`mt-3 w-full px-2 sm:px-0 ${compact ? "max-w-4xl" : "max-w-2xl"}`}>
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-3.5 sm:p-4 shadow-2xs">
            <ApiKeyField apiKey={apiKey} onChange={setApiKey} />
          </div>
        </div>
      )}

      {/* Suggested Topics Pills */}
      {!compact && suggestedTopics.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 max-w-2xl px-2">
          <span className="text-xs font-medium text-stone-400">Popular topics:</span>
          {suggestedTopics.slice(0, 5).map((s) => (
            <button
              key={s.topic_key}
              type="button"
              onClick={() => handleSelectSuggested(s.topic_key)}
              className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-xs font-medium text-stone-700 shadow-2xs hover:border-amber-400 hover:text-amber-800 hover:bg-amber-50/40 transition-all active:scale-95"
            >
              <span className="max-w-[140px] sm:max-w-[180px] truncate inline-block align-middle">{s.topic_key}</span>
              <span className="ml-1 text-[10px] text-stone-400">({s.n})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
