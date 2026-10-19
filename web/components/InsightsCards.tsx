"use client";

import React, { useMemo } from "react";
import { Sparkles, Zap, CheckCircle2, AlertCircle, Compass } from "lucide-react";

interface InsightsCardsProps {
  streamedText: string;
  isStreaming: boolean;
}

interface ParsedBullet {
  theme: string;
  text: string;
}

interface ParsedSections {
  verdict: string;
  exciting: ParsedBullet[];
  frustrating: ParsedBullet[];
  bottomLine: string;
  isParsed: boolean;
}

function parseStreamedMarkdown(markdown: string): ParsedSections {
  const result: ParsedSections = {
    verdict: "",
    exciting: [],
    frustrating: [],
    bottomLine: "",
    isParsed: false,
  };

  if (!markdown) return result;

  // Split by ## headings
  const sections = markdown.split(/(?=^##\s+)/m);

  for (const sec of sections) {
    const trimmed = sec.trim();
    if (!trimmed) continue;

    if (trimmed.includes("10-Second Verdict") || trimmed.includes("Verdict")) {
      const content = trimmed.replace(/^##.*?\n/, "").trim();
      // Remove ** wrapping if present
      result.verdict = content.replace(/^\*\*|\*\*$/g, "").trim();
    } else if (trimmed.includes("The Exciting") || trimmed.includes("Exciting")) {
      const lines = trimmed.split("\n").slice(1);
      const bullets: ParsedBullet[] = [];
      for (const line of lines) {
        const bulletMatch = line.match(/^[-*]\s+\*\*\[?([^\]*]+)\]?\*\*\s*(.*)$/);
        if (bulletMatch) {
          bullets.push({
            theme: bulletMatch[1].trim(),
            text: bulletMatch[2].trim(),
          });
        } else if (line.trim().startsWith("-") || line.trim().startsWith("*")) {
          bullets.push({
            theme: "",
            text: line.replace(/^[-*]\s*/, "").trim(),
          });
        }
      }
      if (bullets.length > 0) result.exciting = bullets;
    } else if (trimmed.includes("The Frustrating") || trimmed.includes("Frustrating")) {
      const lines = trimmed.split("\n").slice(1);
      const bullets: ParsedBullet[] = [];
      for (const line of lines) {
        const bulletMatch = line.match(/^[-*]\s+\*\*\[?([^\]*]+)\]?\*\*\s*(.*)$/);
        if (bulletMatch) {
          bullets.push({
            theme: bulletMatch[1].trim(),
            text: bulletMatch[2].trim(),
          });
        } else if (line.trim().startsWith("-") || line.trim().startsWith("*")) {
          bullets.push({
            theme: "",
            text: line.replace(/^[-*]\s*/, "").trim(),
          });
        }
      }
      if (bullets.length > 0) result.frustrating = bullets;
    } else if (trimmed.includes("The Bottom Line") || trimmed.includes("Bottom Line")) {
      const content = trimmed.replace(/^##.*?\n/, "").trim();
      result.bottomLine = content.replace(/^\*\*|\*\*$/g, "").trim();
    }
  }

  result.isParsed = Boolean(
    result.verdict ||
      result.exciting.length > 0 ||
      result.frustrating.length > 0 ||
      result.bottomLine
  );
  return result;
}

export function InsightsCards({ streamedText, isStreaming }: InsightsCardsProps) {
  const parsed = useMemo(() => parseStreamedMarkdown(streamedText), [streamedText]);

  // If streaming just began and no text yet, show skeletons
  if (!streamedText && isStreaming) {
    return (
      <section className="grid gap-4 md:grid-cols-2 animate-pulse">
        <div className="md:col-span-2 h-28 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900" />
        <div className="h-44 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900" />
        <div className="h-44 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900" />
        <div className="md:col-span-2 h-24 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900" />
      </section>
    );
  }

  // Fallback: If text exists but headings weren't parsed, render raw text
  if (streamedText && !parsed.isParsed) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          <Sparkles className="h-4 w-4" />
          <span>Quick Summary</span>
        </div>
        <div className="mt-3 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
          {streamedText}
          {isStreaming && <span className="inline-block animate-pulse text-indigo-600">▍</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4 md:grid-cols-2">
      {/* 1. 10-Second Verdict */}
      <article className="md:col-span-2 rounded-2xl border border-indigo-200/80 bg-indigo-50/60 p-6 shadow-sm dark:border-indigo-500/30 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              10-Second Verdict
            </h3>
          </div>
          {isStreaming && !parsed.verdict && (
            <span className="text-xs text-indigo-500 animate-pulse font-medium">Writing...</span>
          )}
        </div>
        {parsed.verdict ? (
          <p className="mt-3 text-lg sm:text-xl font-bold leading-relaxed text-neutral-900 dark:text-neutral-50">
            {parsed.verdict}
          </p>
        ) : (
          <div className="mt-3 h-10 rounded-lg bg-indigo-100/50 dark:bg-neutral-800 animate-pulse" />
        )}
      </article>

      {/* 2. The Exciting */}
      <article className="rounded-2xl border border-emerald-200/80 bg-emerald-50/60 p-6 shadow-sm dark:border-emerald-500/30 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-300">
            The Exciting
          </h3>
        </div>
        {parsed.exciting.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {parsed.exciting.map((item, idx) => (
              <li key={idx} className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                {item.theme && (
                  <span className="font-bold text-emerald-700 dark:text-emerald-400 mr-1.5">
                    [{item.theme}]
                  </span>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 space-y-2 animate-pulse">
            <div className="h-4 rounded bg-emerald-100/70 dark:bg-neutral-800 w-3/4" />
            <div className="h-4 rounded bg-emerald-100/70 dark:bg-neutral-800 w-5/6" />
          </div>
        )}
      </article>

      {/* 3. The Frustrating */}
      <article className="rounded-2xl border border-rose-200/80 bg-rose-50/60 p-6 shadow-sm dark:border-rose-500/30 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
          <h3 className="text-sm font-bold text-rose-900 dark:text-rose-300">
            The Frustrating
          </h3>
        </div>
        {parsed.frustrating.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {parsed.frustrating.map((item, idx) => (
              <li key={idx} className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">
                {item.theme && (
                  <span className="font-bold text-rose-700 dark:text-rose-400 mr-1.5">
                    [{item.theme}]
                  </span>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 space-y-2 animate-pulse">
            <div className="h-4 rounded bg-rose-100/70 dark:bg-neutral-800 w-3/4" />
            <div className="h-4 rounded bg-rose-100/70 dark:bg-neutral-800 w-5/6" />
          </div>
        )}
      </article>

      {/* 4. The Bottom Line */}
      <article className="md:col-span-2 rounded-2xl border border-amber-300/80 bg-amber-50/60 p-6 shadow-sm dark:border-amber-500/40 dark:bg-neutral-900">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-sm font-bold text-amber-900 dark:text-amber-300">
            The Bottom Line
          </h3>
        </div>
        {parsed.bottomLine ? (
          <p className="mt-3 text-base sm:text-lg font-medium text-neutral-900 dark:text-neutral-100 leading-relaxed">
            {parsed.bottomLine}
          </p>
        ) : (
          <div className="mt-3 h-6 rounded bg-amber-200/50 dark:bg-neutral-800 animate-pulse w-2/3" />
        )}
      </article>
    </section>
  );
}
