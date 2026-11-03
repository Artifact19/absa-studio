"use client";

import React from "react";
import {
  Cpu,
  Sparkles,
  Gamepad2,
  Car,
  Coins,
  Film,
  ShoppingBag,
  Globe,
  Tag,
} from "lucide-react";
import { GENRE_DEFINITIONS, normalizeGenre, TopicGenre } from "@/lib/genre";

interface GenreBadgeProps {
  genre?: string | null;
  size?: "sm" | "md";
  interactive?: boolean;
  onClick?: () => void;
}

export function GenreBadge({
  genre,
  size = "md",
  interactive = false,
  onClick,
}: GenreBadgeProps) {
  const normalized: TopicGenre = normalizeGenre(genre);
  const def = GENRE_DEFINITIONS[normalized] || GENRE_DEFINITIONS["General & News"];

  const renderIcon = () => {
    const iconClass = size === "sm" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0";
    switch (def.iconName) {
      case "Cpu":
        return <Cpu className={iconClass} />;
      case "Sparkles":
        return <Sparkles className={iconClass} />;
      case "Gamepad2":
        return <Gamepad2 className={iconClass} />;
      case "Car":
        return <Car className={iconClass} />;
      case "Coins":
        return <Coins className={iconClass} />;
      case "Film":
        return <Film className={iconClass} />;
      case "ShoppingBag":
        return <ShoppingBag className={iconClass} />;
      case "Globe":
        return <Globe className={iconClass} />;
      default:
        return <Tag className={iconClass} />;
    }
  };

  const Component = interactive ? "button" : "span";

  return (
    <Component
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold transition-all ${
        size === "sm"
          ? "px-2.5 py-0.5 text-[11px]"
          : "px-3 py-1 text-xs"
      } ${
        interactive
          ? "cursor-pointer glass-pill hover:scale-102 active:scale-95 text-slate-700"
          : "glass-pill text-slate-700"
      }`}
      title={`Genre: ${def.label}`}
    >
      <span className="text-slate-500">{renderIcon()}</span>
      <span>{def.label}</span>
    </Component>
  );
}

