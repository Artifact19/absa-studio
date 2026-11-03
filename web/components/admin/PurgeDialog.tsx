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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-md p-4">
      <div className="relative w-full max-w-md rounded-3xl glass-elevated p-6 sm:p-7 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-rose-600">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="text-base font-bold text-slate-900">
            Purge Topic Records
          </h3>
        </div>

        <p className="mt-2 text-xs text-slate-500 leading-relaxed">
          This operation is irreversible and will permanently delete tweets and their classification data from Supabase.
        </p>

        {errorMsg && (
          <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700">
            {errorMsg}
          </div>
        )}

        {/* Option 1: Purge specific topic */}
        <div className="mt-4 space-y-3 rounded-2xl glass-panel p-4">
          <div className="text-xs font-semibold text-slate-800">
            Option A: Delete by topic key
          </div>
          <div>
            <label className="text-[11px] text-slate-500">Target topic key</label>
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              placeholder="e.g. iphone 17"
              className="mt-1 w-full rounded-full glass-input px-3.5 py-1.5 text-xs text-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500">
              Type <strong className="text-rose-600 font-bold">{topicInput || "topic"}</strong> to confirm:
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="Type topic name exactly..."
              className="mt-1 w-full rounded-full glass-input px-3.5 py-1.5 text-xs text-slate-900 focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={!isMatching || isLoading}
            onClick={handlePurgeTopic}
            className="w-full flex items-center justify-center gap-1.5 rounded-full bg-rose-600 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            <span>Purge Topic Dataset</span>
          </button>
        </div>

        {/* Option 2: Bulk retention purge */}
        <div className="mt-4 space-y-2.5 rounded-2xl glass-panel p-4">
          <div className="text-xs font-semibold text-slate-800">
            Option B: Retention Purge (Older than N days)
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={olderThanDays}
              onChange={(e) => setOlderThanDays(e.target.value)}
              placeholder="e.g. 90"
              className="w-24 rounded-full glass-input px-3 py-1.5 text-xs text-slate-900 focus:outline-none"
            />
            <span className="text-xs text-slate-500">days old</span>
            <button
              type="button"
              disabled={!olderThanDays || isLoading}
              onClick={handleBulkPurgeDays}
              className="ml-auto rounded-full glass-pill px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              Purge Old Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
