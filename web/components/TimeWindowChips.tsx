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
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Time window selector">
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
            className={`group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
              isSelected
                ? "bg-neutral-900 text-white shadow-sm ring-1 ring-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:ring-neutral-100"
                : "border border-neutral-200 bg-white/80 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-850"
            } ${isLoading ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span>{win.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-semibold ${
                isSelected
                  ? "bg-white/20 text-white dark:bg-neutral-900/30 dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-500 group-hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:group-hover:bg-neutral-750"
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
