"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { StatsGrid } from "@/components/admin/StatsGrid";
import { TweetTable } from "@/components/admin/TweetTable";
import { ScrapeForm } from "@/components/admin/ScrapeForm";
import { PurgeDialog } from "@/components/admin/PurgeDialog";
import { AdminStats, AdminTweet } from "@/lib/types";
import { Lock, KeyRound, ShieldAlert, Trash2, ArrowLeft, RefreshCw, LogOut, Loader2 } from "lucide-react";

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [passkeyInput, setPasskeyInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Stats State
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Tweets Table State
  const [tweets, setTweets] = useState<AdminTweet[]>([]);
  const [totalTweets, setTotalTweets] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoadingTweets, setIsLoadingTweets] = useState(false);

  // Filters & Sorting
  const [topicFilter, setTopicFilter] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("time.desc");

  // Purge Dialog
  const [isPurgeOpen, setIsPurgeOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  // Load Admin Stats
  const loadStats = useCallback(async () => {
    setIsLoadingStats(true);
    try {
      const res = await fetch("/api/admin/stats");
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setIsAuthenticated(true);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  // Load Tweets
  const loadTweets = useCallback(
    async (page = 1) => {
      setIsLoadingTweets(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "50",
          sort: sortBy,
        });
        if (topicFilter) params.set("topic", topicFilter);
        if (sentimentFilter) params.set("sentiment", sentimentFilter);
        if (searchQuery) params.set("q", searchQuery);

        const res = await fetch(`/api/admin/tweets?${params.toString()}`);
        if (res.status === 401) {
          setIsAuthenticated(false);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setTweets(data.tweets || []);
          setTotalTweets(data.total || 0);
          setCurrentPage(data.page || 1);
          setTotalPages(data.totalPages || 1);
          setIsAuthenticated(true);
        }
      } catch {
        // Ignore
      } finally {
        setIsLoadingTweets(false);
      }
    },
    [sortBy, topicFilter, sentimentFilter, searchQuery]
  );

  // Check auth on initial mount
  useEffect(() => {
    loadStats();
    loadTweets(1);
  }, [loadStats, loadTweets]);

  // Handle Login Submit
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkeyInput.trim() || isLoggingIn) return;

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.trim(),
          passkey: passkeyInput.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setIsAuthenticated(true);
      setPasskeyInput("");
      loadStats();
      loadTweets(1);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Invalid passkey");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handlePurged = (deletedCount: number, topic: string) => {
    setToastMessage(`Successfully deleted ${deletedCount} records for ${topic}.`);
    loadStats();
    loadTweets(1);
    setTimeout(() => setToastMessage(""), 5000);
  };

  // 1. Initial Checking Loading State
  if (isAuthenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  // 2. Unauthenticated: Passkey Gate View
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl border border-neutral-800 bg-neutral-900/90 p-8 shadow-2xl backdrop-blur-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400">
            <Lock className="h-6 w-6" />
          </div>

          <h1 className="mt-4 text-xl font-black text-neutral-100">
            Admin Passkey Gate
          </h1>
          <p className="mt-1 text-xs text-neutral-400">
            Enter your configured master passkey to unlock the ABSA Studio management console.
          </p>

          {loginError && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="mt-6 space-y-3.5">
            <div>
              <label className="text-[11px] font-semibold text-neutral-400">Admin Email</label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="arnavraut4567@gmail.com"
                className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-800/80 py-2 px-3 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-neutral-400">Master Passkey</label>
              <div className="relative mt-1">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
                <input
                  type="password"
                  required
                  autoFocus
                  value={passkeyInput}
                  onChange={(e) => setPasskeyInput(e.target.value)}
                  placeholder="absa_admin_..."
                  className="w-full rounded-xl border border-neutral-700 bg-neutral-800/80 py-2 pl-9 pr-3 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn || !passkeyInput.trim()}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-md hover:bg-indigo-500 disabled:opacity-50 transition-all"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Unlock Admin Portal</span>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Public Search</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 3. Authenticated Admin Dashboard
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Admin Header */}
        <header className="flex flex-col gap-4 border-b border-neutral-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-400 hover:text-neutral-200"
              >
                <ArrowLeft className="h-3 w-3" />
                <span>Search UI</span>
              </Link>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                Session Active
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black sm:text-3xl">Admin Management Console</h1>
            <p className="text-xs text-neutral-400">
              Database metrics, manual scrapers, dataset pruning, and full tweet inspection.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                loadStats();
                loadTweets(currentPage);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-850"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingStats || isLoadingTweets ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPurgeOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Purge Data</span>
            </button>

            <button
              type="button"
              onClick={() => {
                document.cookie = "absa_admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;";
                setIsAuthenticated(false);
              }}
              className="flex items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-medium text-neutral-400 hover:text-neutral-200"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Lock</span>
            </button>
          </div>
        </header>

        {/* Toast Alert */}
        {toastMessage && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-300">
            {toastMessage}
          </div>
        )}

        {/* 1. Stats Grid */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">
            Platform & Database Metrics
          </h2>
          <StatsGrid stats={stats} isLoading={isLoadingStats} />
        </section>

        {/* 2. Manual Scrape Pipeline */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">
            Data Scraper Pipeline
          </h2>
          <ScrapeForm
            onJobComplete={() => {
              loadStats();
              loadTweets(1);
            }}
          />
        </section>

        {/* 3. Tweets Table */}
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">
            Tweet Records & Classifications
          </h2>
          <TweetTable
            tweets={tweets}
            total={totalTweets}
            page={currentPage}
            pageSize={50}
            totalPages={totalPages}
            isLoading={isLoadingTweets}
            topicFilter={topicFilter}
            sentimentFilter={sentimentFilter}
            searchQuery={searchQuery}
            sortBy={sortBy}
            onPageChange={(p) => loadTweets(p)}
            onFilterChange={(newFilters) => {
              if (newFilters.topic !== undefined) setTopicFilter(newFilters.topic);
              if (newFilters.sentiment !== undefined) setSentimentFilter(newFilters.sentiment);
              if (newFilters.q !== undefined) setSearchQuery(newFilters.q);
              if (newFilters.sort !== undefined) setSortBy(newFilters.sort);
            }}
          />
        </section>
      </div>

      {/* Pruning Dialog */}
      <PurgeDialog
        isOpen={isPurgeOpen}
        onClose={() => setIsPurgeOpen(false)}
        onPurged={handlePurged}
        activeTopic={topicFilter}
      />
    </div>
  );
}
