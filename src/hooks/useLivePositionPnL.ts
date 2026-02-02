"use client";

import { useMemo } from "react";
import { PositionDrawing } from "@/lib/drawings/types";

export interface LivePnLResult {
  pnlPoints: number;
  pnlPips: number;
  pnlPercent: number;
  isProfit: boolean;
  distanceToTP: number;
  distanceToSL: number;
  tpProgress: number; // 0-100% progress towards TP
  slProgress: number; // 0-100% progress towards SL (negative = safer)
}

/**
 * Calculate pip multiplier based on price level
 * - Forex (< 10): 10000
 * - Indices/Metals (>= 10): 100
 */
function getPipMultiplier(price: number): number {
  return price < 10 ? 10000 : 100;
}

/**
 * Hook to calculate real-time P&L for a live position
 */
export function useLivePositionPnL(
  position: PositionDrawing | null,
  currentPrice: number | null
): LivePnLResult | null {
  return useMemo(() => {
    if (!position || currentPrice === null || currentPrice === undefined) {
      return null;
    }

    const isLong = position.type === "longPosition";
    const entryPrice = position.entry.price;
    const stopLoss = position.stopLoss;
    const takeProfit = position.takeProfit;

    // Calculate raw P&L
    const pnlPoints = isLong
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;

    // Convert to pips
    const pipMultiplier = getPipMultiplier(entryPrice);
    const pnlPips = pnlPoints * pipMultiplier;

    // Calculate percentage
    const pnlPercent = (pnlPoints / entryPrice) * 100;

    // Is in profit?
    const isProfit = pnlPoints > 0;

    // Distance to TP and SL
    const distanceToTP = isLong
      ? takeProfit - currentPrice
      : currentPrice - takeProfit;

    const distanceToSL = isLong
      ? currentPrice - stopLoss
      : stopLoss - currentPrice;

    // Progress calculations
    const totalTPDistance = Math.abs(takeProfit - entryPrice);
    const totalSLDistance = Math.abs(stopLoss - entryPrice);

    // TP progress: 0% at entry, 100% at TP
    const tpProgress = totalTPDistance > 0
      ? Math.min(100, Math.max(0, (pnlPoints / totalTPDistance) * 100))
      : 0;

    // SL progress: 0% at entry, 100% at SL (inverted, so positive when moving towards SL)
    const slProgress = totalSLDistance > 0
      ? Math.min(100, Math.max(0, (-pnlPoints / totalSLDistance) * 100))
      : 0;

    return {
      pnlPoints,
      pnlPips,
      pnlPercent,
      isProfit,
      distanceToTP,
      distanceToSL,
      tpProgress,
      slProgress,
    };
  }, [position, currentPrice]);
}

/**
 * Format P&L for display
 */
export function formatPnL(pnl: number, decimals: number = 1): string {
  const sign = pnl >= 0 ? "+" : "";
  return `${sign}${pnl.toFixed(decimals)}`;
}

/**
 * Get color class based on P&L
 */
export function getPnLColorClass(isProfit: boolean): string {
  return isProfit ? "text-green-400" : "text-red-400";
}

/**
 * Hook to get all live positions from drawings
 */
export function useLivePositions(
  drawings: PositionDrawing[]
): PositionDrawing[] {
  return useMemo(() => {
    return drawings.filter(
      (d) => d.status === "open" || d.status === "pending"
    );
  }, [drawings]);
}
