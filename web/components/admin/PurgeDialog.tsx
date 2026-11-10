"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Trash2,
  AlertTriangle,
  X,
  Loader2,
  ShieldAlert,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
  Clock,
  Database,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";

interface PurgeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPurged: (deletedCount: number, topic: string) => void;
  activeTopic?: string;
  availableTopics?: string[];
}

interface PreviewStats {
  total: number;
  labeled: number;
  unlabeled: number;
  targetRecords: number;
  preservedRecords: number;
  requiresSevereWarning: boolean;
}

export function PurgeDialog({
  isOpen,
  onClose,
  onPurged,
  activeTopic = "",
  availableTopics = [],
}: PurgeDialogProps) {
  // Wizard Stage: 1 = Scope & Impact, 2 = Risk Confirmation, 3 = Password & Execute
  const [stage, setStage] = useState<1 | 2 | 3>(1);

  // Available topics loaded from API
  const [topicOptions, setTopicOptions] = useState<string[]>(
    availableTopics.length ? availableTopics : ["gta 6"]
  );

  useEffect(() => {
    fetch("/api/topics")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.topics && Array.isArray(data.topics)) {
          const list: string[] = data.topics
            .map((t: { aspect?: string; topic?: string; topic_key?: string }) => t.topic_key || t.topic || t.aspect || "")
            .filter((x: string) => Boolean(x && x.trim()));
          if (list.length) {
            const unique = Array.from(new Set(list));
            setTopicOptions(unique);
            setSelectedTopic((prev) => (prev && unique.includes(prev) ? prev : activeTopic || unique[0]));
          }
        }
      })
      .catch(() => {});
  }, [activeTopic]);

  // Stage 1: Scope Inputs
  const [scope, setScope] = useState<"topic" | "unlabeled" | "retention" | "all">("topic");
  const [selectedTopic, setSelectedTopic] = useState(activeTopic || "gta 6");
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [olderThanDays, setOlderThanDays] = useState("90");
  const [preserveHumanTruth, setPreserveHumanTruth] = useState(true);

  // Live Dry-Run Preview
  const [preview, setPreview] = useState<PreviewStats | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");

  // Stage 2: Risk Checkboxes & Phrase Confirmation
  const [ackIrreversible, setAckIrreversible] = useState(false);
  const [ackMetricsLost, setAckMetricsLost] = useState(false);
  const [ackDestroyLabels, setAckDestroyLabels] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");

  // Stage 3: Master Key & Safety Countdown
  const [passkey, setPasskey] = useState("");
  const [showPasskey, setShowPasskey] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionError, setExecutionError] = useState("");
  const [safetyCountdown, setSafetyCountdown] = useState(3);
  const [isSafetyUnlocked, setIsSafetyUnlocked] = useState(false);

  // Compute effective topic
  const effectiveTopic =
    selectedTopic === "__custom__" ? customTopicInput.trim() : selectedTopic.trim();

  // Compute expected phrase
  const expectedPhrase =
    scope === "all"
      ? "PERMANENTLY PURGE ALL DATA"
      : scope === "unlabeled"
      ? `PURGE UNLABELED ${effectiveTopic ? effectiveTopic.toUpperCase() : "ALL"}`
      : scope === "retention"
      ? `PURGE OLDER THAN ${olderThanDays} DAYS`
      : `DELETE ${effectiveTopic.toUpperCase()}`;

  const isPhraseMatching =
    confirmationInput.trim().toUpperCase() === expectedPhrase.trim().toUpperCase();

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setStage(1);
      setSelectedTopic(activeTopic || (topicOptions[0] || availableTopics[0] || "gta 6"));
      setCustomTopicInput("");
      setPreserveHumanTruth(true);
      setAckIrreversible(false);
      setAckMetricsLost(false);
      setAckDestroyLabels(false);
      setConfirmationInput("");
      setPasskey("");
      setExecutionError("");
      setSafetyCountdown(3);
      setIsSafetyUnlocked(false);
    }
  }, [isOpen, activeTopic, availableTopics]);

  // Fetch dry-run preview from server whenever scope/target changes
  const fetchPreview = useCallback(async () => {
    if (!isOpen) return;
    setIsLoadingPreview(true);
    setPreviewError("");

    try {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (scope === "topic" || scope === "unlabeled") {
        if (effectiveTopic) params.set("topic", effectiveTopic);
      } else if (scope === "retention") {
        params.set("olderThanDays", olderThanDays);
        if (effectiveTopic && effectiveTopic !== "all") {
          params.set("topic", effectiveTopic);
        }
      }
      params.set("preserveHumanTruth", preserveHumanTruth ? "true" : "false");

      const res = await fetch(`/api/admin/purge?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to calculate purge impact");
      }

      const data = await res.json();
      setPreview({
        total: data.total || 0,
        labeled: data.labeled || 0,
        unlabeled: data.unlabeled || 0,
        targetRecords: data.targetRecords || 0,
        preservedRecords: data.preservedRecords || 0,
        requiresSevereWarning: data.requiresSevereWarning || false,
      });
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Error fetching purge preview");
      setPreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [isOpen, scope, effectiveTopic, olderThanDays, preserveHumanTruth]);

  useEffect(() => {
    if (isOpen) {
      fetchPreview();
    }
  }, [fetchPreview, isOpen]);

  // 3-second safety unlock countdown when reaching Stage 3
  useEffect(() => {
    if (stage === 3 && safetyCountdown > 0) {
      const timer = setTimeout(() => {
        setSafetyCountdown((prev) => {
          if (prev <= 1) {
            setIsSafetyUnlocked(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [stage, safetyCountdown]);

  // Final Purge Execution
  const handleExecutePurge = async () => {
    if (!passkey.trim() || isExecuting || !isSafetyUnlocked) return;
    setIsExecuting(true);
    setExecutionError("");

    try {
      const res = await fetch("/api/admin/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passkey: passkey.trim(),
          scope,
          topic: effectiveTopic,
          olderThanDays: scope === "retention" ? parseInt(olderThanDays, 10) : undefined,
          preserveHumanTruth,
          confirmDestroyGroundTruth: ackDestroyLabels,
          confirmationPhrase: confirmationInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Purge execution failed on server");
      }

      onPurged(data.deleted || 0, effectiveTopic || scope);
      onClose();
    } catch (err: unknown) {
      setExecutionError(err instanceof Error ? err.message : "Error executing purge");
    } finally {
      setIsExecuting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-md p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-[24px] sm:rounded-[32px] liquid-glass-slab p-4 sm:p-8 border border-white/85 shadow-2xl space-y-5 sm:space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isExecuting}
          className="absolute right-4 top-4 sm:right-5 sm:top-5 p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-white/60 transition cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Modal Header */}
        <div className="space-y-1.5 pr-8">
          <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-3 py-1 bg-rose-500/15 border border-rose-500/30 text-rose-700 text-[10px] sm:text-xs font-black tracking-wide">
            <ShieldAlert className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-600" />
            <span>STRICT DATA PURGE PROTOCOL</span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
            Permanent Database Pruning
          </h2>
        </div>

        {/* 3-Stage Progress Stepper */}
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 border-y border-white/60 py-2.5 sm:py-3">
          <div
            className={`flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold transition ${
              stage === 1
                ? "liquid-pill-primary text-white"
                : stage > 1
                ? "bg-emerald-500/15 text-emerald-800 border border-emerald-500/30"
                : "bg-white/50 text-slate-400"
            }`}
          >
            <span className="flex h-3.5 w-3.5 sm:h-4 sm:w-4 items-center justify-center rounded-full bg-black/15 text-[9px] sm:text-[10px] shrink-0">
              1
            </span>
            <span className="truncate hidden xs:inline">Scope & Impact</span>
            <span className="truncate xs:hidden">Scope</span>
          </div>

          <div
            className={`flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold transition ${
              stage === 2
                ? "liquid-pill-primary text-white"
                : stage > 2
                ? "bg-emerald-500/15 text-emerald-800 border border-emerald-500/30"
                : "bg-white/50 text-slate-400"
            }`}
          >
            <span className="flex h-3.5 w-3.5 sm:h-4 sm:w-4 items-center justify-center rounded-full bg-black/15 text-[9px] sm:text-[10px] shrink-0">
              2
            </span>
            <span className="truncate hidden xs:inline">Confirmation</span>
            <span className="truncate xs:hidden">Confirm</span>
          </div>

          <div
            className={`flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold transition ${
              stage === 3
                ? "liquid-pill-rose text-white"
                : "bg-white/50 text-slate-400"
            }`}
          >
            <span className="flex h-3.5 w-3.5 sm:h-4 sm:w-4 items-center justify-center rounded-full bg-black/15 text-[9px] sm:text-[10px] shrink-0">
              3
            </span>
            <span className="truncate hidden xs:inline">Master Key</span>
            <span className="truncate xs:hidden">Key</span>
          </div>
        </div>

        {/* Global Error Banner */}
        {(previewError || executionError) && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-700 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="font-medium">{previewError || executionError}</div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 1: Scope Selection & Dry-Run Impact Assessment                      */}
        {/* ========================================================================= */}
        {stage === 1 && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* Scope Selection Radios */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                1. Select Purge Scope
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => setScope("topic")}
                  className={`p-3 rounded-2xl border text-left text-xs transition cursor-pointer ${
                    scope === "topic"
                      ? "bg-indigo-600/10 border-indigo-500 text-indigo-900 font-bold shadow-xs"
                      : "bg-white/60 border-white/80 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  <div className="font-black">🎯 Topic Key</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Delete by topic</div>
                </button>

                <button
                  type="button"
                  onClick={() => setScope("unlabeled")}
                  className={`p-3 rounded-2xl border text-left text-xs transition cursor-pointer ${
                    scope === "unlabeled"
                      ? "bg-indigo-600/10 border-indigo-500 text-indigo-900 font-bold shadow-xs"
                      : "bg-white/60 border-white/80 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  <div className="font-black">🛡️ Unlabeled</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Safe raw purge</div>
                </button>

                <button
                  type="button"
                  onClick={() => setScope("retention")}
                  className={`p-3 rounded-2xl border text-left text-xs transition cursor-pointer ${
                    scope === "retention"
                      ? "bg-indigo-600/10 border-indigo-500 text-indigo-900 font-bold shadow-xs"
                      : "bg-white/60 border-white/80 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  <div className="font-black">⏳ Retention</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Older than N days</div>
                </button>

                <button
                  type="button"
                  onClick={() => setScope("all")}
                  className={`p-3 rounded-2xl border text-left text-xs transition cursor-pointer ${
                    scope === "all"
                      ? "bg-rose-500/15 border-rose-500 text-rose-900 font-black shadow-xs"
                      : "bg-white/60 border-white/80 text-slate-600 hover:bg-white/80"
                  }`}
                >
                  <div className="font-black text-rose-600">💥 Wipe All</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Nuclear reset</div>
                </button>
              </div>
            </div>

            {/* Scope Parameter Inputs */}
            {(scope === "topic" || scope === "unlabeled") && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Target Topic Key</label>
                <div className="flex gap-2">
                  <select
                    value={selectedTopic}
                    onChange={(e) => setSelectedTopic(e.target.value)}
                    className="w-1/2 rounded-full glass-input px-4 py-2 text-xs text-slate-900 focus:outline-none font-semibold cursor-pointer"
                  >
                    {topicOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                    <option value="__custom__">+ Enter Custom Topic...</option>
                  </select>

                  {selectedTopic === "__custom__" && (
                    <input
                      type="text"
                      value={customTopicInput}
                      onChange={(e) => setCustomTopicInput(e.target.value)}
                      placeholder="e.g. gta 6"
                      className="w-1/2 rounded-full glass-input px-4 py-2 text-xs text-slate-900 focus:outline-none"
                    />
                  )}
                </div>
              </div>
            )}

            {scope === "retention" && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Retention Cutoff</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    value={olderThanDays}
                    onChange={(e) => setOlderThanDays(e.target.value)}
                    className="w-24 rounded-full glass-input px-4 py-2 text-xs text-slate-900 focus:outline-none font-bold"
                  />
                  <span className="text-xs text-slate-600 font-medium">days old</span>
                  <div className="flex gap-1.5 ml-auto">
                    {["30", "60", "90"].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setOlderThanDays(d)}
                        className={`px-3 py-1 text-[11px] rounded-full border transition cursor-pointer ${
                          olderThanDays === d
                            ? "bg-indigo-600 text-white border-indigo-600 font-bold"
                            : "bg-white/70 border-white text-slate-600 hover:bg-white"
                        }`}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Ground Truth Protection Toggle */}
            {scope !== "unlabeled" && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <span>Preserve Ground-Truth Human Annotations</span>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Keeps all labeled ground truth safe; deletes unannotated scraped posts only.
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={preserveHumanTruth}
                    onChange={(e) => setPreserveHumanTruth(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>
            )}

            {/* Dry-Run Impact Box */}
            <div className="rounded-2xl liquid-glass-inner p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Dry-Run Impact Calculation</span>
                </span>
                {isLoadingPreview && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-400 font-normal">
                    <Loader2 className="h-3 w-3 animate-spin" /> Calculating...
                  </span>
                )}
              </div>

              {preview ? (
                <div className="grid grid-cols-3 gap-2 text-center pt-1">
                  <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-2.5">
                    <div className="text-[10px] font-bold text-rose-700 uppercase">Target Deletion</div>
                    <div className="text-lg font-black text-rose-900 tabular-nums">
                      {preview.targetRecords.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-rose-600">records</div>
                  </div>

                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-2.5">
                    <div className="text-[10px] font-bold text-emerald-700 uppercase">Protected</div>
                    <div className="text-lg font-black text-emerald-900 tabular-nums">
                      {preview.preservedRecords.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-emerald-600">human labels</div>
                  </div>

                  <div className="rounded-xl bg-slate-100 border border-slate-200 p-2.5">
                    <div className="text-[10px] font-bold text-slate-500 uppercase">Total in Scope</div>
                    <div className="text-lg font-black text-slate-800 tabular-nums">
                      {preview.total.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500">records</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 text-center py-2">
                  No preview available
                </div>
              )}

              {preview && preview.requiresSevereWarning && (
                <div className="rounded-xl bg-amber-500/15 border border-amber-500/30 p-2.5 text-xs text-amber-900 font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    Warning: You chose NOT to preserve human labels. {preview.labeled} ground-truth annotations will be permanently deleted!
                  </span>
                </div>
              )}
            </div>

            {/* Next Button */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onClose}
                className="liquid-pill-neutral px-5 py-2.5 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={!preview || preview.targetRecords === 0 || isLoadingPreview}
                onClick={() => setStage(2)}
                className="liquid-btn-ingest px-6 py-2.5 text-xs font-extrabold flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
              >
                <span>Proceed to Confirmation</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 2: Explicit Risk Confirmation & Confirmation Phrase Lock            */}
        {/* ========================================================================= */}
        {stage === 2 && (
          <div className="space-y-5 animate-in fade-in duration-150">
            {/* Severe Notice */}
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/15 p-4 space-y-1.5 text-rose-900">
              <div className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5 text-rose-700">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <span>Action Confirmation Required</span>
              </div>
              <p className="text-xs font-medium leading-relaxed">
                You are about to permanently delete <strong>{preview?.targetRecords.toLocaleString()}</strong> posts
                for scope <strong>&ldquo;{effectiveTopic || scope}&rdquo;</strong>.
                This operation directly modifies Supabase and cannot be rolled back.
              </p>
            </div>

            {/* Required Safety Checkboxes */}
            <div className="space-y-3 rounded-2xl liquid-glass-inner p-4 text-xs text-slate-800">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ackIrreversible}
                  onChange={(e) => setAckIrreversible(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span className="font-medium">
                  I acknowledge that this deletion is irreversible and records cannot be recovered.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ackMetricsLost}
                  onChange={(e) => setAckMetricsLost(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                />
                <span className="font-medium">
                  I understand model inference scores and evaluation kappa for these items will be wiped.
                </span>
              </label>

              {preview?.requiresSevereWarning && (
                <label className="flex items-start gap-2.5 cursor-pointer text-rose-700">
                  <input
                    type="checkbox"
                    checked={ackDestroyLabels}
                    onChange={(e) => setAckDestroyLabels(e.target.checked)}
                    className="mt-0.5 rounded border-rose-400 text-rose-600 focus:ring-rose-500"
                  />
                  <span className="font-bold">
                    I explicitly authorize destroying {preview.labeled} ground-truth human annotations.
                  </span>
                </label>
              )}
            </div>

            {/* Phrase Typing Lock */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">
                Type the phrase <strong className="text-rose-600 font-mono font-black">{expectedPhrase}</strong> to proceed:
              </label>
              <input
                type="text"
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder={expectedPhrase}
                className="w-full rounded-full glass-input px-4 py-2.5 text-xs font-mono font-semibold text-slate-900 focus:outline-none"
              />
              <div className="text-[11px] flex items-center justify-between">
                <span className={isPhraseMatching ? "text-emerald-600 font-bold" : "text-slate-400"}>
                  {isPhraseMatching ? "✓ Confirmation phrase matches" : "Type phrase exactly to unlock"}
                </span>
              </div>
            </div>

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStage(1)}
                className="liquid-pill-neutral px-4 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                disabled={
                  !ackIrreversible ||
                  !ackMetricsLost ||
                  (preview?.requiresSevereWarning && !ackDestroyLabels) ||
                  !isPhraseMatching
                }
                onClick={() => {
                  setSafetyCountdown(3);
                  setIsSafetyUnlocked(false);
                  setStage(3);
                }}
                className="liquid-pill-rose px-6 py-2.5 text-xs font-extrabold flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
              >
                <span>Proceed to Master Key Authorization</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STAGE 3: Strict Password Verification & Final Execution                   */}
        {/* ========================================================================= */}
        {stage === 3 && (
          <div className="space-y-5 animate-in fade-in duration-150">
            <div className="rounded-2xl liquid-glass-inner p-4 space-y-2 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15 border border-rose-500/30">
                <KeyRound className="h-5 w-5 text-rose-600" />
              </div>
              <h3 className="text-sm font-black text-slate-900">
                Admin Master Passkey Verification
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Enter your system <code>ADMIN_PASSKEY</code> to cryptographically authorize deleting{" "}
                <strong>{preview?.targetRecords}</strong> records.
              </p>
            </div>

            {/* Passkey Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                Admin Master Passkey *
              </label>
              <div className="relative">
                <input
                  type={showPasskey ? "text" : "password"}
                  disabled={isExecuting}
                  value={passkey}
                  onChange={(e) => setPasskey(e.target.value)}
                  placeholder="Enter master admin passkey..."
                  className="w-full rounded-full glass-input pl-4 pr-10 py-2.5 text-xs font-mono text-slate-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPasskey(!showPasskey)}
                  className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPasskey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Safety Delay Indicator */}
            <div className="rounded-xl bg-slate-100/80 border border-slate-200/80 p-3 text-center text-xs">
              {!isSafetyUnlocked ? (
                <div className="text-slate-600 font-semibold flex items-center justify-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600 animate-spin" />
                  <span>Safety lock active. Unlocking in {safetyCountdown}s...</span>
                </div>
              ) : (
                <div className="text-emerald-700 font-bold flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>Safety lock cleared. Ready to execute.</span>
                </div>
              )}
            </div>

            {/* Final Execution Buttons */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                disabled={isExecuting}
                onClick={() => setStage(2)}
                className="liquid-pill-neutral px-4 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                disabled={!passkey.trim() || isExecuting || !isSafetyUnlocked}
                onClick={handleExecutePurge}
                className="liquid-pill-rose px-7 py-3 text-xs sm:text-sm font-black tracking-wide flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-xl"
              >
                {isExecuting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Executing Permanent Purge...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    <span>Execute Permanent Purge</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
