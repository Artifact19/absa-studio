"use client";

import React, { useMemo } from "react";
import { Sparkles, Zap, CheckCircle2, AlertCircle, Compass } from "lucide-react";

interface InsightsCardsProps {
  streamedText: string;
  isStreaming: boolean;
  topic?: string;
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

function parseStreamedMarkdown(markdown: string, topic?: string): ParsedSections {
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
      let cleaned = content
        .replace(/^\*\*|\*\*$/g, "")
        .replace(/[<>]/g, "")
        .trim();

      if (topic) {
        cleaned = cleaned.replace(/\b(NAME|TARGET|Target)\b/g, topic);
      }
      result.verdict = cleaned.trim();
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
      let cleaned = content
        .replace(/^\*\*|\*\*$/g, "")
        .replace(/[<>]/g, "")
        .trim();

      if (topic) {
        cleaned = cleaned.replace(/\b(NAME|TARGET|Target)\b/g, topic);
      }
      result.bottomLine = cleaned.trim();
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

export function InsightsCards({ streamedText, isStreaming, topic }: InsightsCardsProps) {
  const parsed = useMemo(() => parseStreamedMarkdown(streamedText, topic), [streamedText, topic]);

  // Skeletons during initial streaming
  if (!streamedText && isStreaming) {
    return (
      <section className="grid gap-3 sm:gap-4 md:grid-cols-2 animate-pulse">
        <div className="md:col-span-2 h-28 rounded-3xl glass-panel opacity-60" />
        <div className="h-44 rounded-3xl glass-panel opacity-60" />
        <div className="h-44 rounded-3xl glass-panel opacity-60" />
        <div className="md:col-span-2 h-20 rounded-3xl glass-panel opacity-60" />
      </section>
    );
  }

  if (!parsed.isParsed) {
    return null;
  }

  return (
    <section className="grid gap-3 sm:gap-4 md:grid-cols-2">
      {/* 10-Second Verdict - Hero VisionOS Glass Capsule */}
      {parsed.verdict && (
        <div className="md:col-span-2 rounded-3xl glass-elevated p-5 sm:p-6 shadow-xs border border-white/60">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#6c94cc]">
            <Zap className="h-4 w-4 text-[#6c94cc]" />
            <span>10-Second Verdict</span>
          </div>
          <p className="mt-2 text-base sm:text-lg font-extrabold text-slate-900 leading-snug">
            {parsed.verdict}
          </p>
        </div>
      )}

      {/* The Exciting */}
      {parsed.exciting.length > 0 && (
        <div className="rounded-3xl glass-panel p-5 sm:p-6 shadow-2xs border border-emerald-500/10">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>The Exciting</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {parsed.exciting.map((item, i) => (
              <li key={i} className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                {item.theme && (
                  <strong className="font-bold text-emerald-900">[{item.theme}] </strong>
                )}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The Frustrating */}
      {parsed.frustrating.length > 0 && (
        <div className="rounded-3xl glass-panel p-5 sm:p-6 shadow-2xs border border-rose-500/10">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-700">
            <AlertCircle className="h-4 w-4 text-rose-600" />
            <span>The Frustrating</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {parsed.frustrating.map((item, i) => (
              <li key={i} className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                {item.theme && (
                  <strong className="font-bold text-rose-900">[{item.theme}] </strong>
                )}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The Bottom Line */}
      {parsed.bottomLine && (
        <div className="md:col-span-2 rounded-3xl glass-panel p-5 sm:p-6 shadow-2xs">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600">
            <Compass className="h-4 w-4 text-[#6c94cc]" />
            <span>The Bottom Line</span>
          </div>
          <p className="mt-2 text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">
            {parsed.bottomLine}
          </p>
        </div>
      )}
    </section>
  );
}
