"use client";

import React from "react";
import { SocialPlatform } from "@/lib/types";

interface PlatformIconProps {
  platform: SocialPlatform | string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Official X (Twitter) Brand Mark SVG
 */
export function XIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/**
 * Official Reddit Snoo Brand Logo SVG (#FF4500 orange circle with white Snoo)
 */
export function RedditIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
    >
      <circle cx="12" cy="12" r="12" fill="#FF4500" />
      <path
        d="M19.5 12c0-.83-.67-1.5-1.5-1.5-.39 0-.74.15-1.01.4-1.27-.85-2.98-1.4-4.88-1.47l.83-3.9 2.72.58a1.25 1.25 0 1 0 1.34-1.11 1.25 1.25 0 0 0-1.25 1.05l-2.97-.63a.25.25 0 0 0-.29.19l-.95 4.47c-1.94.06-3.69.61-4.99 1.48-.27-.26-.63-.41-1.04-.41-.83 0-1.5.67-1.5 1.5 0 .58.33 1.08.81 1.33-.04.22-.06.44-.06.67 0 2.9 3.58 5.25 8 5.25s8-2.35 8-5.25c0-.23-.02-.45-.06-.67.48-.25.81-.75.81-1.33zM9 13.5c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm6 3.88c-.96.65-2.23.65-3 0a.48.48 0 0 1 .05-.72.48.48 0 0 1 .72.05c.51.35 1.45.35 1.96 0a.48.48 0 0 1 .72.05.48.48 0 0 1-.05.72zm.5-1.88c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/**
 * Universal Platform Icon Component
 */
export function PlatformIcon({
  platform,
  className = "h-3.5 w-3.5",
}: PlatformIconProps) {
  const norm = (platform || "twitter").toLowerCase();
  if (norm === "reddit") {
    return <RedditIcon className={className} />;
  }
  return <XIcon className={className} />;
}
