"use client";

import React from "react";
import { Stat } from "./Stat";

export interface StatBestWorstProps {
  /** Label (e.g., "Best Model", "Worst Session") */
  label: string;
  /** The name/key of the item (e.g., "Momentum", "London") */
  name: string | null | undefined;
  /** The PnL value */
  value: number;
  /** Number of trades */
  tradeCount: number;
  /** True for "best" (green when positive), false for "worst" (red when negative) */
  isBest: boolean;
  /** Format the value as USD */
  formatValue?: (value: number, decimals: number) => string;
  /** Optional: format the name before display */
  formatName?: (name: string) => string;
  /** Show opposite color when value has unexpected sign */
  showOppositeColor?: boolean;
}

function defaultFormatValue(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "0.00";
  return Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function StatBestWorst({
  label,
  name,
  value,
  tradeCount,
  isBest,
  formatValue = defaultFormatValue,
  formatName,
  showOppositeColor = false,
}: StatBestWorstProps) {
  const displayName = name ? (formatName ? formatName(name) : name) : null;

  const getColor = (): string => {
    if (!displayName) return "rgba(255,255,255,0.88)";
    const isPositive = Number.isFinite(value) && value >= 0;
    const isNegative = Number.isFinite(value) && value < 0;

    if (isBest) {
      if (isPositive) return "rgba(60,220,120,0.95)";
      if (isNegative && showOppositeColor) return "rgba(230,80,80,0.95)";
      return "rgba(255,255,255,0.88)";
    } else {
      if (isNegative) return "rgba(230,80,80,0.95)";
      if (isPositive && showOppositeColor) return "rgba(60,220,120,0.95)";
      return "rgba(255,255,255,0.88)";
    }
  };

  const sign = value >= 0 ? "+" : "-";

  return (
    <Stat
      label={label}
      value={
        displayName ? (
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.15,
            }}
          >
            <span>{displayName}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                opacity: 0.95,
              }}
            >
              {sign}${formatValue(value, 2)} · {tradeCount} trade
              {tradeCount !== 1 ? "s" : ""}
            </span>
          </span>
        ) : (
          "—"
        )
      }
      color={getColor()}
    />
  );
}
