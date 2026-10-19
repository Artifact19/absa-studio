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
        compact ? "py-2" : "py-10 flex flex-col items-center justify-center text-center"
      }`}
    >
      {!compact && (
        <div className="mb-8 max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-50/60 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-950/40 dark:text-indigo-300">
            <Image
              src="/cat-icon.png"
              alt="Cat Icon"
              width={16}
              height={16}
              className="h-4 w-4 rounded-sm object-contain"
            />
            <span>Real opinions. Zero noise.</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-neutral-900 sm:text-5xl dark:text-neutral-50">
            See what people <span className="text-indigo-600 dark:text-indigo-400">really think</span>
          </h1>
          <p className="text-base text-neutral-600 dark:text-neutral-400 max-w-lg mx-auto">
            Search any phone, game, brand, or celebrity. We scan recent posts, ignore the junk, and tell you if people actually like it or not.
          </p>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`w-full transition-all duration-300 ${
          compact ? "max-w-4xl flex items-center gap-3" : "max-w-2xl"
        }`}
      >
        <div className="relative flex-1">
          <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400">
            <Search className="h-5 w-5" />
          </div>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Search anything (e.g. iPhone 17, Max Verstappen, GTA 6)..."
            disabled={isLoading}
            className={`w-full rounded-2xl border border-neutral-300 bg-white/90 pl-11 pr-28 text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15 dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-100 dark:placeholder:text-neutral-500 ${
              compact ? "py-2.5 text-sm" : "py-4 text-base"
            }`}
          />
          <button
            type="submit"
            disabled={isLoading || !topic.trim()}
            className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-indigo-600 font-medium text-white shadow transition-all hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 ${
              compact ? "px-3.5 py-1.5 text-xs" : "px-5 py-2.5 text-sm"
            }`}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
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
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              showApiKeyField || apiKey
                ? "border-indigo-500/50 bg-indigo-50/50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-950/40 dark:text-indigo-300"
                : "border-neutral-200 bg-white/60 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400"
            }`}
          >
            <span>FetchLayer Key</span>
            {showApiKeyField ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </form>

      {/* Hero mode API Key toggle */}
      {!compact && (
        <div className="mt-3 w-full max-w-2xl text-left">
          <button
            type="button"
            onClick={() => setShowApiKeyField(!showApiKeyField)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
          >
            <span>{showApiKeyField ? "Hide" : "Use your own"} FetchLayer key (optional)</span>
            {showApiKeyField ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {/* Collapsible FetchLayer API Key Drawer */}
      {showApiKeyField && (
        <div className={`mt-3 w-full ${compact ? "max-w-4xl" : "max-w-2xl"}`}>
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-sm dark:border-indigo-950/60 dark:bg-indigo-950/20">
            <ApiKeyField apiKey={apiKey} onChange={setApiKey} />
          </div>
        </div>
      )}

      {/* Suggested Topics Pills */}
      {!compact && suggestedTopics.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 max-w-2xl">
          <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">Popular topics:</span>
          {suggestedTopics.slice(0, 5).map((s) => (
            <button
              key={s.topic_key}
              type="button"
              onClick={() => handleSelectSuggested(s.topic_key)}
              className="rounded-full border border-neutral-200 bg-white/70 px-3 py-1 text-xs font-medium text-neutral-700 shadow-2xs hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300 dark:hover:border-indigo-500 dark:hover:text-indigo-400 transition-all"
            >
              {s.topic_key}
              <span className="ml-1 text-[10px] text-neutral-400">({s.n})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
