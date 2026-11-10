"use client";

import React from "react";
import { AvailableWindow, TimeWindowId } from "@/lib/types";

interface TimeWindowChipsProps {
  availableWindows: AvailableWindow[];
  selectedWindowId: TimeWindowId;
  onSelectWindow: (id: TimeWindowId) => void;
  isLoading?: boolean;
}

export function TimeWindowChips({
  availableWindows,
  selectedWindowId,
  onSelectWindow,
  isLoading = false,
}: TimeWindowChipsProps) {
  if (!availableWindows || availableWindows.length === 0) {
    return null;
  }

  return (
    <div
      className="inline-flex items-center gap-1 p-1 rounded-full glass-track max-w-full overflow-x-auto no-scrollbar sm:flex-wrap shadow-xs"
      role="tablist"
      aria-label="Time window selector"
    >
      {availableWindows.map((win) => {
        const isSelected = win.id === selectedWindowId;

        return (
          <button
            key={win.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            disabled={isLoading}
            onClick={() => onSelectWindow(win.id)}
            className={`group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
              isSelected
                ? "glass-pill-active shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/50 cursor-pointer"
            } ${isLoading ? "opacity-60 cursor-not-allowed" : ""}`}
          >
            <span className="truncate max-w-[280px] sm:max-w-none">{win.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums font-bold ${
                isSelected
                  ? "bg-white/30 text-white"
                  : "bg-white/60 text-slate-500 group-hover:bg-white/80"
              }`}
            >
              {win.n.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
