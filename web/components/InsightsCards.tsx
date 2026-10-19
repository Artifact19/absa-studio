"use client";

import React, { useMemo } from "react";
import { Sparkles } from "lucide-react";

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

    if (trimmed.includes("10-Second Verdict")) {
      const content = trimmed.replace(/^##.*?\n/, "").trim();
      // Remove ** wrapping if present
      result.verdict = content.replace(/^\*\*|\*\*$/g, "").trim();
    } else if (trimmed.includes("The Exciting")) {
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
    } else if (trimmed.includes("The Frustrating")) {
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
    } else if (trimmed.includes("The Bottom Line")) {
      const content = trimmed.replace(/^##.*?\n/, "").trim();
      result.bottomLine = content;
    }
  }

  result.isParsed = Boolean(result.verdict || result.exciting.length > 0 || result.frustrating.length > 0 || result.bottomLine);
  return result;
}

export function InsightsCards({ streamedText, isStreaming }: InsightsCardsProps) {
  const parsed = useMemo(() => parseStreamedMarkdown(streamedText), [streamedText]);

  // If streaming just began and no text yet, show shimmer skeletons
  if (!streamedText && isStreaming) {
    return (
      <section className="grid gap-4 md:grid-cols-2 animate-pulse">
        <div className="md:col-span-2 h-28 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-850" />
        <div className="h-44 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-850" />
        <div className="h-44 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-850" />
        <div className="md:col-span-2 h-24 rounded-2xl border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-850" />
      </section>
    );
  }

  // Fallback: If text exists but headings weren't parsed, render raw markdown in single card
  if (streamedText && !parsed.isParsed) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white/70 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          <Sparkles className="h-4 w-4" />
          <span>Executive Synthesis</span>
        </div>
        <div className="mt-3 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">
          {streamedText}
          {isStreaming && <span className="inline-block animate-pulse text-indigo-600">▍</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-4 md:grid-cols-2">
      {/* 1. 10-Second Verdict */}
      <article className="md:col-span-2 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-white p-5 shadow-sm dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-neutral-950">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            ⚡ 10-Second Verdict
          </h3>
          {isStreaming && !parsed.verdict && (
            <span className="text-xs text-indigo-500 animate-pulse">Synthesizing...</span>
          )}
        </div>
        {parsed.verdict ? (
          <p className="mt-2 text-xl font-bold leading-snug text-neutral-900 dark:text-neutral-100">
            {parsed.verdict}
          </p>
        ) : (
          <div className="mt-3 h-10 rounded-lg bg-indigo-100/50 dark:bg-indigo-900/30 animate-pulse" />
        )}
      </article>

      {/* 2. The Exciting */}
      <article className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm dark:border-emerald-900/70 dark:bg-emerald-950/30">
        <h3 className="font-semibold text-emerald-900 dark:text-emerald-300">🟢 The Exciting</h3>
        {parsed.exciting.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {parsed.exciting.map((item, idx) => (
              <li key={idx} className="text-sm text-emerald-950 dark:text-emerald-100/90 leading-relaxed">
                {item.theme && (
                  <strong className="font-bold text-emerald-800 dark:text-emerald-300">
                    [{item.theme}]{" "}
                  </strong>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 space-y-2 animate-pulse">
            <div className="h-4 rounded bg-emerald-100/70 dark:bg-emerald-900/40 w-3/4" />
            <div className="h-4 rounded bg-emerald-100/70 dark:bg-emerald-900/40 w-5/6" />
          </div>
        )}
      </article>

      {/* 3. The Frustrating */}
      <article className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm dark:border-rose-900/70 dark:bg-rose-950/30">
        <h3 className="font-semibold text-rose-900 dark:text-rose-300">🔴 The Frustrating</h3>
        {parsed.frustrating.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {parsed.frustrating.map((item, idx) => (
              <li key={idx} className="text-sm text-rose-950 dark:text-rose-100/90 leading-relaxed">
                {item.theme && (
                  <strong className="font-bold text-rose-800 dark:text-rose-300">
                    [{item.theme}]{" "}
                  </strong>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 space-y-2 animate-pulse">
            <div className="h-4 rounded bg-rose-100/70 dark:bg-rose-900/40 w-3/4" />
            <div className="h-4 rounded bg-rose-100/70 dark:bg-rose-900/40 w-5/6" />
          </div>
        )}
      </article>

      {/* 4. The Bottom Line */}
      <article className="md:col-span-2 rounded-2xl border-2 border-amber-300 bg-amber-50/80 p-5 shadow-sm dark:border-amber-700 dark:bg-amber-950/30">
        <h3 className="font-semibold text-amber-900 dark:text-amber-300">🎯 The Bottom Line</h3>
        {parsed.bottomLine ? (
          <p className="mt-2 text-lg font-medium text-amber-950 dark:text-amber-100 leading-snug">
            {parsed.bottomLine}
          </p>
        ) : (
          <div className="mt-3 h-6 rounded bg-amber-200/50 dark:bg-amber-900/40 animate-pulse w-2/3" />
        )}
      </article>
    </section>
  );
}
