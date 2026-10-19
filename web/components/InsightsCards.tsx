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
      <section className="grid gap-3 sm:gap-4 md:grid-cols-2 animate-pulse">
        <div className="md:col-span-2 h-28 rounded-2xl border border-stone-200 bg-stone-100" />
        <div className="h-44 rounded-2xl border border-stone-200 bg-stone-100" />
        <div className="h-44 rounded-2xl border border-stone-200 bg-stone-100" />
        <div className="md:col-span-2 h-24 rounded-2xl border border-stone-200 bg-stone-100" />
      </section>
    );
  }

  // Fallback: If text exists but headings weren't parsed, render raw text
  if (streamedText && !parsed.isParsed) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white/90 p-4 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700">
          <Sparkles className="h-4 w-4" />
          <span>Quick Summary</span>
        </div>
        <div className="mt-3 whitespace-pre-wrap text-sm text-stone-800 leading-relaxed">
          {streamedText}
          {isStreaming && <span className="inline-block animate-pulse text-amber-600">▍</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-3 sm:gap-4 md:grid-cols-2">
      {/* 1. 10-Second Verdict */}
      <article className="md:col-span-2 rounded-2xl border border-amber-300/80 bg-amber-50/70 p-4 sm:p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">
              10-Second Verdict
            </h3>
          </div>
          {isStreaming && !parsed.verdict && (
            <span className="text-xs text-amber-600 animate-pulse font-medium">Writing...</span>
          )}
        </div>
        {parsed.verdict ? (
          <p className="mt-2.5 sm:mt-3 text-base sm:text-xl font-bold leading-relaxed text-stone-900">
            {parsed.verdict}
          </p>
        ) : (
          <div className="mt-3 h-8 sm:h-10 rounded-lg bg-amber-100/60 animate-pulse" />
        )}
      </article>

      {/* 2. The Exciting */}
      <article className="rounded-2xl border border-emerald-200/80 bg-emerald-50/50 p-4 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-emerald-900">
            The Exciting
          </h3>
        </div>
        {parsed.exciting.length > 0 ? (
          <ul className="mt-3 sm:mt-4 space-y-2.5 sm:space-y-3">
            {parsed.exciting.map((item, idx) => (
              <li key={idx} className="text-xs sm:text-sm text-stone-800 leading-relaxed">
                {item.theme && (
                  <span className="font-bold text-emerald-800 mr-1.5">
                    [{item.theme}]
                  </span>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 space-y-2 animate-pulse">
            <div className="h-4 rounded bg-emerald-100/70 w-3/4" />
            <div className="h-4 rounded bg-emerald-100/70 w-5/6" />
          </div>
        )}
      </article>

      {/* 3. The Frustrating */}
      <article className="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-4 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600" />
          <h3 className="text-sm font-bold text-rose-900">
            The Frustrating
          </h3>
        </div>
        {parsed.frustrating.length > 0 ? (
          <ul className="mt-3 sm:mt-4 space-y-2.5 sm:space-y-3">
            {parsed.frustrating.map((item, idx) => (
              <li key={idx} className="text-xs sm:text-sm text-stone-800 leading-relaxed">
                {item.theme && (
                  <span className="font-bold text-rose-800 mr-1.5">
                    [{item.theme}]
                  </span>
                )}
                {item.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 space-y-2 animate-pulse">
            <div className="h-4 rounded bg-rose-100/70 w-3/4" />
            <div className="h-4 rounded bg-rose-100/70 w-5/6" />
          </div>
        )}
      </article>

      {/* 4. The Bottom Line */}
      <article className="md:col-span-2 rounded-2xl border border-stone-200 bg-white/95 p-4 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-bold text-stone-900">
            The Bottom Line
          </h3>
        </div>
        {parsed.bottomLine ? (
          <p className="mt-2.5 sm:mt-3 text-sm sm:text-base font-medium text-stone-800 leading-relaxed">
            {parsed.bottomLine}
          </p>
        ) : (
          <div className="mt-3 h-6 rounded bg-stone-200/50 animate-pulse w-2/3" />
        )}
      </article>
    </section>
  );
}
