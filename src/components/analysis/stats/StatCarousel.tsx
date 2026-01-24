"use client";

import React from "react";
import { Stat } from "./Stat";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface StatCarouselProps {
  /** Label shown above the carousel */
  label: string;
  /** Main title text (e.g., model name, session name) */
  title: string;
  /** Subtitle text (e.g., "$1,234 · 50 trades · avg $24.68") */
  subtitle: string;
  /** Total number of items to paginate through */
  itemCount: number;
  /** Current selected index */
  index: number;
  /** Callback when user changes index */
  onIndexChange: (newIndex: number) => void;
  /** Color for the value text */
  color?: string;
  /** Optional: wrap index (default true = wraps around, false = clamps) */
  wrap?: boolean;
}

export function StatCarousel({
  label,
  title,
  subtitle,
  itemCount,
  index,
  onIndexChange,
  color = "rgba(255,255,255,0.88)",
  wrap = true,
}: StatCarouselProps) {
  const canNavigate = itemCount > 1;

  const handlePrev = () => {
    if (!canNavigate) return;
    if (wrap) {
      onIndexChange((index - 1 + itemCount) % itemCount);
    } else {
      onIndexChange(Math.max(0, index - 1));
    }
  };

  const handleNext = () => {
    if (!canNavigate) return;
    if (wrap) {
      onIndexChange((index + 1) % itemCount);
    } else {
      onIndexChange(Math.min(itemCount - 1, index + 1));
    }
  };

  return (
    <Stat
      label={label}
      value={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <button
            onClick={handlePrev}
            disabled={!canNavigate}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.88)",
              width: 28,
              height: 26,
              borderRadius: 10,
              cursor: canNavigate ? "pointer" : "default",
              opacity: canNavigate ? 1 : 0.45,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: "center",
              lineHeight: 1.05,
            }}
          >
            <div
              style={{
                fontWeight: 900,
                transform: "translateY(-1px)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={title}
            >
              {title}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                opacity: 0.85,
                lineHeight: 1.1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={subtitle}
            >
              {subtitle}
            </div>
          </div>

          <button
            onClick={handleNext}
            disabled={!canNavigate}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.88)",
              width: 28,
              height: 26,
              borderRadius: 10,
              cursor: canNavigate ? "pointer" : "default",
              opacity: canNavigate ? 1 : 0.45,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      }
      color={color}
    />
  );
}
