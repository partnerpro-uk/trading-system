/**
 * Average True Range (ATR)
 *
 * Measures market volatility by calculating the average of true ranges
 * over a specified period. True Range accounts for gaps between candles.
 *
 * True Range = max(
 *   High - Low,
 *   |High - Previous Close|,
 *   |Low - Previous Close|
 * )
 *
 * ATR is typically smoothed using either SMA or EMA (Wilder's smoothing).
 * This implementation uses Wilder's smoothing (RMA) by default.
 */

import { CandleInput, IndicatorValue } from "../types";

export interface ATRParams {
  /** Number of periods for the ATR calculation */
  period: number;
  /** Smoothing method: "rma" (Wilder's) or "sma" */
  smoothing?: "rma" | "sma";
}

/** Default parameters for ATR */
export const ATR_DEFAULTS: ATRParams = {
  period: 14,
  smoothing: "rma",
};

/**
 * Calculate True Range for a single candle
 */
function calculateTrueRange(
  current: CandleInput,
  previous: CandleInput | null
): number {
  const highLow = current.high - current.low;

  if (!previous) {
    return highLow;
  }

  const highPrevClose = Math.abs(current.high - previous.close);
  const lowPrevClose = Math.abs(current.low - previous.close);

  return Math.max(highLow, highPrevClose, lowPrevClose);
}

/**
 * Compute Average True Range
 *
 * @param candles - Array of candle data
 * @param params - ATR parameters (period, smoothing)
 * @returns Array of ATR values, one per candle
 *
 * @example
 * ```ts
 * const atr14 = computeATR(candles, { period: 14 });
 * // Returns: [{ timestamp: 1234567890, value: 0.0015 }, ...]
 * ```
 */
export function computeATR(
  candles: CandleInput[],
  params: Partial<ATRParams> = {}
): IndicatorValue[] {
  const { period, smoothing } = { ...ATR_DEFAULTS, ...params };

  if (candles.length === 0) return [];
  if (period < 1) throw new Error("ATR period must be at least 1");

  const values: IndicatorValue[] = [];
  const trueRanges: number[] = [];

  let atr: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    const previous = i > 0 ? candles[i - 1] : null;

    // Calculate True Range
    const tr = calculateTrueRange(current, previous);
    trueRanges.push(tr);

    if (i < period - 1) {
      // Not enough data yet, output partial average
      const partialSum = trueRanges.reduce((a, b) => a + b, 0);
      const partialATR = partialSum / trueRanges.length;
      values.push({
        timestamp: current.timestamp,
        value: partialATR,
      });
    } else if (i === period - 1) {
      // Initialize ATR with SMA of first `period` true ranges
      const sum = trueRanges.reduce((a, b) => a + b, 0);
      atr = sum / period;
      values.push({
        timestamp: current.timestamp,
        value: atr,
      });
    } else {
      // Smoothed ATR calculation
      if (smoothing === "sma") {
        // Simple moving average of last `period` TRs
        const recentTRs = trueRanges.slice(-period);
        atr = recentTRs.reduce((a, b) => a + b, 0) / period;
      } else {
        // Wilder's smoothing (RMA): ATR = ((Previous ATR × (period - 1)) + Current TR) / period
        atr = (atr! * (period - 1) + tr) / period;
      }
      values.push({
        timestamp: current.timestamp,
        value: atr,
      });
    }
  }

  return values;
}

/**
 * Get ATR as a multiple (useful for stop loss/take profit calculations)
 *
 * @param atrValue - The ATR value
 * @param multiplier - How many ATRs
 * @returns The ATR distance
 */
export function getATRMultiple(atrValue: number, multiplier: number): number {
  return atrValue * multiplier;
}

/**
 * Get the ATR value at a specific timestamp
 */
export function getATRAtTimestamp(
  values: IndicatorValue[],
  timestamp: number
): number | undefined {
  const value = values.find((v) => v.timestamp === timestamp);
  return value?.value;
}
