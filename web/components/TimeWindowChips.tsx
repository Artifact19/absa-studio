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
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2" role="tablist" aria-label="Time window selector">
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
            className={`group inline-flex items-center gap-1.5 rounded-full px-3 sm:px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
              isSelected
                ? "bg-stone-900 text-white shadow-xs ring-1 ring-stone-900"
                : "border border-stone-200 bg-white/90 text-stone-700 hover:border-amber-300 hover:bg-stone-50"
            } ${isLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className="truncate max-w-[280px] sm:max-w-none">{win.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold ${
                isSelected
                  ? "bg-white/25 text-white"
                  : "bg-stone-100 text-stone-600 group-hover:bg-amber-100/70 group-hover:text-amber-900"
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
