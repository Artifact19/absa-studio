"use client";

import React, { useState } from "react";
import { Trash2, AlertTriangle, X, Loader2 } from "lucide-react";

interface PurgeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPurged: (deletedCount: number, topic: string) => void;
  activeTopic?: string;
}

export function PurgeDialog({ isOpen, onClose, onPurged, activeTopic = "" }: PurgeDialogProps) {
  const [topicInput, setTopicInput] = useState(activeTopic);
  const [confirmInput, setConfirmInput] = useState("");
  const [olderThanDays, setOlderThanDays] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const isMatching = confirmInput.trim() === topicInput.trim() && topicInput.trim().length > 0;

  const handlePurgeTopic = async () => {
    if (!isMatching || isLoading) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/admin/topics/${encodeURIComponent(topicInput.trim())}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete topic records");
      }

      onPurged(data.deleted, topicInput.trim());
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Error deleting topic");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkPurgeDays = async () => {
    const days = parseInt(olderThanDays, 10);
    if (isNaN(days) || days <= 0 || isLoading) return;
    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch(`/api/admin/topics/all?olderThanDays=${days}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to purge old records");
      }

      onPurged(data.deleted, `all records older than ${days} days`);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Error purging records");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            Purge Topic Records
          </h3>
        </div>

        <p className="mt-2 text-xs text-neutral-500 leading-relaxed dark:text-neutral-400">
          This operation is irreversible and will permanently delete tweets and their classification data from Supabase.
        </p>

        {errorMsg && (
          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-600 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        {/* Option 1: Purge specific topic */}
        <div className="mt-4 space-y-3 rounded-xl border border-neutral-100 bg-neutral-50/50 p-3.5 dark:border-neutral-800 dark:bg-neutral-850/50">
          <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            Option A: Delete by topic key
          </div>
          <div>
            <label className="text-[11px] text-neutral-400">Target topic key</label>
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              placeholder="e.g. iphone 17"
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <div>
            <label className="text-[11px] text-neutral-400">
              Type <strong className="text-rose-600 font-semibold">{topicInput || "topic"}</strong> to confirm:
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="Type topic name exactly..."
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <button
            type="button"
            disabled={!isMatching || isLoading}
            onClick={handlePurgeTopic}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-40 disabled:pointer-events-none transition-all"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            <span>Purge Topic Dataset</span>
          </button>
        </div>

        {/* Option 2: Bulk retention purge */}
        <div className="mt-4 space-y-2.5 rounded-xl border border-neutral-100 bg-neutral-50/50 p-3.5 dark:border-neutral-800 dark:bg-neutral-850/50">
          <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            Option B: Retention Purge (Older than N days)
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(e.target.value)}
              placeholder="e.g. 90"
              className="w-24 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span className="text-xs text-neutral-500">days old</span>
            <button
              type="button"
              disabled={!olderThanDays || isLoading}
              onClick={handleBulkPurgeDays}
              className="ml-auto rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
            >
              Purge Old Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
