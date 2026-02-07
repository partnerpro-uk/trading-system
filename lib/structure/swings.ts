/**
 * Swing Point Detection
 *
 * Detects local highs and lows using timeframe-scaled lookback windows.
 * A swing high is a candle whose high is higher than N candles on both sides.
 * A swing low is a candle whose low is lower than N candles on both sides.
 */

import type { Candle, SwingPoint } from "./types";

/** Timeframe-scaled lookback: how many candles on each side to confirm a swing */
export const LOOKBACK_MAP: Record<string, number> = {
  M15: 7,
  M30: 7,
  H1: 5,
  H4: 5,
  D: 3,
  D1: 3,
  W: 3,
  W1: 3,
  M: 2,
  MN: 2,
};

/** Minimum candle depth for reliable swing detection */
export const REQUIRED_DEPTH: Record<string, number> = {
  M15: 500,
  M30: 500,
  H1: 500,
  H4: 300,
  D: 200,
  D1: 200,
  W: 104,
  W1: 104,
  M: 60,
  MN: 60,
};

/**
 * Detect swing points in a candle array.
 *
 * Returns SwingPoint[] with label = null (labeling happens in labeling.ts).
 * The last N candles cannot form confirmed swings (need right-side candles).
 */
export function detectSwings(
  candles: Candle[],
  timeframe: string
): SwingPoint[] {
  const N = LOOKBACK_MAP[timeframe] ?? 5;
  const swings: SwingPoint[] = [];

  if (candles.length < N * 2 + 1) {
    return swings; // not enough data
  }

  for (let i = N; i < candles.length - N; i++) {
    const candle = candles[i];

    // Check swing high: candle[i].high > all highs within N on both sides
    let isSwingHigh = true;
    for (let j = i - N; j < i; j++) {
      if (candles[j].high >= candle.high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) {
      for (let j = i + 1; j <= i + N; j++) {
        if (candles[j].high >= candle.high) {
          isSwingHigh = false;
          break;
        }
      }
    }

    // Check swing low: candle[i].low < all lows within N on both sides
    let isSwingLow = true;
    for (let j = i - N; j < i; j++) {
      if (candles[j].low <= candle.low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) {
      for (let j = i + 1; j <= i + N; j++) {
        if (candles[j].low <= candle.low) {
          isSwingLow = false;
          break;
        }
      }
    }

    const trueRange = candle.high - candle.low;

    if (isSwingHigh) {
      swings.push({
        timestamp: candle.timestamp,
        price: candle.high,
        type: "high",
        label: null,
        candleIndex: i,
        lookbackUsed: N,
        trueRange,
      });
    }

    if (isSwingLow) {
      swings.push({
        timestamp: candle.timestamp,
        price: candle.low,
        type: "low",
        label: null,
        candleIndex: i,
        lookbackUsed: N,
        trueRange,
      });
    }
  }

  // Sort by timestamp (should already be ordered, but ensure it)
  swings.sort((a, b) => a.timestamp - b.timestamp);

  return swings;
}
