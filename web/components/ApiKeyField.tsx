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
        <div className="pointer-events-none absolute left-3 text-stone-400">
          <KeyRound className="h-4 w-4" />
        </div>
        <input
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your FetchLayer API key (e.g. fl_live_...)"
          autoComplete="off"
          spellCheck="false"
          className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-10 text-xs sm:text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-3 text-stone-400 hover:text-stone-600"
          aria-label={showKey ? "Hide API key" : "Show API key"}
        >
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-xs text-stone-500">
        Don&apos;t have a key?{" "}
        <a
          href="https://fetchlayer.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-amber-700 underline hover:text-amber-600"
        >
          Get a free FetchLayer API Key ↗
        </a>
      </p>
    </div>
  );
}
