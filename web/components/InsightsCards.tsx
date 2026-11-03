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

  const sections = markdown.split(/(?=^##\s+)/m);

  for (const sec of sections) {
    const trimmed = sec.trim();
    if (!trimmed) continue;

    if (trimmed.includes("10-Second Verdict") || trimmed.includes("Verdict")) {
      const content = trimmed.replace(/^##.*?\n/, "").trim();
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

  // Skeletons during initial streaming
  if (!streamedText && isStreaming) {
    return (
      <section className="grid gap-3 sm:gap-4 md:grid-cols-2 animate-pulse">
        <div className="md:col-span-2 h-28 rounded-3xl glass-panel opacity-60" />
        <div className="h-44 rounded-3xl glass-panel opacity-60" />
        <div className="h-44 rounded-3xl glass-panel opacity-60" />
        <div className="md:col-span-2 h-24 rounded-3xl glass-panel opacity-60" />
      </section>
    );
  }

  // Fallback raw text
  if (streamedText && !parsed.isParsed) {
    return (
      <section className="rounded-3xl glass-panel p-5 sm:p-7 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#6c94cc]">
          <Sparkles className="h-4 w-4" />
          <span>Quick Summary</span>
        </div>
        <div className="mt-3 whitespace-pre-wrap text-sm text-slate-800 leading-relaxed font-medium">
          {streamedText}
          {isStreaming && <span className="inline-block animate-pulse text-[#6c94cc]">▍</span>}
        </div>
      </section>
    );
  }

  return (
    <section className="grid gap-3 sm:gap-4 md:grid-cols-2">
      {/* 1. 10-Second Verdict */}
      <article className="md:col-span-2 rounded-3xl glass-panel p-5 sm:p-7 border-sky-300/40 shadow-xs relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/10 text-sky-600">
              <Zap className="h-4 w-4" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-sky-800">
              10-Second Verdict
            </h3>
          </div>
          {isStreaming && !parsed.verdict && (
            <span className="text-xs text-sky-600 animate-pulse font-semibold">Generating...</span>
          )}
        </div>
        {parsed.verdict ? (
          <p className="mt-3 text-lg sm:text-2xl font-extrabold leading-snug text-slate-900 tracking-tight">
            {parsed.verdict}
          </p>
        ) : (
          <div className="mt-3 h-8 sm:h-10 rounded-xl bg-white/40 animate-pulse" />
        )}
      </article>

      {/* 2. The Exciting */}
      <article className="rounded-3xl glass-panel p-5 sm:p-6 border-emerald-400/30 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-emerald-900">
            The Exciting
          </h3>
        </div>
        {parsed.exciting.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {parsed.exciting.map((item, idx) => (
              <li key={idx} className="text-xs sm:text-sm text-slate-800 leading-relaxed">
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
          <div className="mt-4 space-y-2.5 animate-pulse">
            <div className="h-4 rounded bg-white/50 w-3/4" />
            <div className="h-4 rounded bg-white/50 w-5/6" />
          </div>
        )}
      </article>

      {/* 3. The Frustrating */}
      <article className="rounded-3xl glass-panel p-5 sm:p-6 border-rose-400/30 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
            <AlertCircle className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-rose-900">
            The Frustrating
          </h3>
        </div>
        {parsed.frustrating.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {parsed.frustrating.map((item, idx) => (
              <li key={idx} className="text-xs sm:text-sm text-slate-800 leading-relaxed">
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
          <div className="mt-4 space-y-2.5 animate-pulse">
            <div className="h-4 rounded bg-white/50 w-3/4" />
            <div className="h-4 rounded bg-white/50 w-5/6" />
          </div>
        )}
      </article>

      {/* 4. The Bottom Line */}
      <article className="md:col-span-2 rounded-3xl glass-panel p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-500/10 text-slate-700">
            <Compass className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-bold text-slate-900">
            The Bottom Line
          </h3>
        </div>
        {parsed.bottomLine ? (
          <p className="mt-3 text-sm sm:text-base font-semibold text-slate-800 leading-relaxed">
            {parsed.bottomLine}
          </p>
        ) : (
          <div className="mt-3 h-6 rounded bg-white/50 animate-pulse w-2/3" />
        )}
      </article>
    </section>
  );
}
