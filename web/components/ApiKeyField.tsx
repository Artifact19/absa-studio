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
        <div className="pointer-events-none absolute left-3.5 text-slate-400">
          <KeyRound className="h-4 w-4" />
        </div>
        <input
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your FetchLayer API key (e.g. fl_live_...)"
          autoComplete="off"
          spellCheck="false"
          className="w-full rounded-full glass-input py-2.5 pl-10 pr-10 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowKey(!showKey)}
          className="absolute right-3.5 text-slate-400 hover:text-slate-600 cursor-pointer"
          aria-label={showKey ? "Hide API key" : "Show API key"}
        >
          {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Don&apos;t have a key?{" "}
        <a
          href="https://fetchlayer.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[#6c94cc] underline hover:text-[#5880b9]"
        >
          Get a free FetchLayer API Key ↗
        </a>
      </p>
    </div>
  );
}
