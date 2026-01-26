/**
 * Simple Moving Average (SMA)
 *
 * The arithmetic mean of prices over a specified period.
 * All data points are weighted equally.
 *
 * Formula: SMA = (P1 + P2 + ... + Pn) / n
 */

import { CandleInput, IndicatorValue, PriceSource } from "../types";

export interface SMAParams {
  /** Number of periods for the SMA calculation */
  period: number;
  /** Price source to use for calculation */
  source?: PriceSource;
}

/** Default parameters for SMA */
export const SMA_DEFAULTS: SMAParams = {
  period: 20,
  source: "close",
};

/**
 * Get the price value from a candle based on the source type
 */
function getSourcePrice(candle: CandleInput, source: PriceSource): number {
  switch (source) {
    case "open":
      return candle.open;
    case "high":
      return candle.high;
    case "low":
      return candle.low;
    case "close":
      return candle.close;
    case "hl2":
      return (candle.high + candle.low) / 2;
    case "hlc3":
      return (candle.high + candle.low + candle.close) / 3;
    case "ohlc4":
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    default:
      return candle.close;
  }
}

/**
 * Compute Simple Moving Average
 *
 * @param candles - Array of candle data
 * @param params - SMA parameters (period, source)
 * @returns Array of SMA values, one per candle
 *
 * @example
 * ```ts
 * const sma50 = computeSMA(candles, { period: 50, source: "close" });
 * // Returns: [{ timestamp: 1234567890, value: 1.0842 }, ...]
 * ```
 */
export function computeSMA(
  candles: CandleInput[],
  params: Partial<SMAParams> = {}
): IndicatorValue[] {
  const { period, source } = { ...SMA_DEFAULTS, ...params };

  if (candles.length === 0) return [];
  if (period < 1) throw new Error("SMA period must be at least 1");

  const values: IndicatorValue[] = [];

  // Use a rolling sum for efficiency
  let rollingSum = 0;
  const priceBuffer: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const price = getSourcePrice(candle, source!);

    // Add current price to buffer and sum
    priceBuffer.push(price);
    rollingSum += price;

    if (priceBuffer.length > period) {
      // Remove oldest price from sum
      rollingSum -= priceBuffer.shift()!;
    }

    // Calculate SMA
    const sma = rollingSum / priceBuffer.length;

    values.push({
      timestamp: candle.timestamp,
      value: sma,
    });
  }

  return values;
}

/**
 * Get the SMA value at a specific timestamp
 */
export function getSMAAtTimestamp(
  values: IndicatorValue[],
  timestamp: number
): number | undefined {
  const value = values.find((v) => v.timestamp === timestamp);
  return value?.value;
}
