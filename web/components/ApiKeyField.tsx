"use client";

import React, { useState } from "react";
import { KeyRound, Eye, EyeOff } from "lucide-react";

interface ApiKeyFieldProps {
  apiKey: string;
  onChange: (value: string) => void;
}

export function ApiKeyField({ apiKey, onChange }: ApiKeyFieldProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="w-full space-y-2 text-left">
      <div className="relative flex items-center">
        <div className="pointer-events-none absolute left-3 text-neutral-400">
          <KeyRound className="h-4 w-4" />
        </div>
        <input
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your FetchLayer API key (e.g. fl_live_...)"
          autoComplete="off"
          spellCheck="false"
          className="w-full rounded-xl border border-neutral-200 bg-white/70 py-2.5 pl-9 pr-10 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-3 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          aria-label={showKey ? "Hide API key" : "Show API key"}
        >
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Don&apos;t have a key?{" "}
        <a
          href="https://fetchlayer.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400"
        >
          Get a free FetchLayer API Key ↗
        </a>
      </p>
    </div>
  );
}
