/**
 * Exponential Moving Average (EMA)
 *
 * A weighted moving average that gives more weight to recent prices.
 * The weighting decreases exponentially for older data points.
 *
 * Formula: EMA = (Price × Multiplier) + (Previous EMA × (1 - Multiplier))
 * Where Multiplier = 2 / (Period + 1)
 *
 * Initialization: First EMA value uses SMA of first `period` candles
 */

import { CandleInput, IndicatorValue, PriceSource } from "../types";

export interface EMAParams {
  /** Number of periods for the EMA calculation */
  period: number;
  /** Price source to use for calculation */
  source?: PriceSource;
}

/** Default parameters for EMA */
export const EMA_DEFAULTS: EMAParams = {
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
 * Compute Simple Moving Average for initialization
 */
function computeSMAForPeriod(prices: number[]): number {
  if (prices.length === 0) return 0;
  const sum = prices.reduce((acc, price) => acc + price, 0);
  return sum / prices.length;
}

/**
 * Compute Exponential Moving Average
 *
 * @param candles - Array of candle data
 * @param params - EMA parameters (period, source)
 * @returns Array of EMA values, one per candle
 *
 * @example
 * ```ts
 * const ema30 = computeEMA(candles, { period: 30, source: "close" });
 * // Returns: [{ timestamp: 1234567890, value: 1.0842 }, ...]
 * ```
 */
export function computeEMA(
  candles: CandleInput[],
  params: Partial<EMAParams> = {}
): IndicatorValue[] {
  const { period, source } = { ...EMA_DEFAULTS, ...params };

  if (candles.length === 0) return [];
  if (period < 1) throw new Error("EMA period must be at least 1");

  const multiplier = 2 / (period + 1);
  const values: IndicatorValue[] = [];

  // Collect prices for SMA initialization
  const initPrices: number[] = [];
  let ema: number | null = null;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const price = getSourcePrice(candle, source!);

    if (i < period - 1) {
      // Collecting prices for initial SMA
      initPrices.push(price);
      // Output NaN or the partial SMA for early values
      // We use the running average to avoid gaps in the chart
      const partialSMA = computeSMAForPeriod([...initPrices]);
      values.push({
        timestamp: candle.timestamp,
        value: partialSMA,
      });
    } else if (i === period - 1) {
      // Initialize EMA with SMA of first `period` prices
      initPrices.push(price);
      ema = computeSMAForPeriod(initPrices);
      values.push({
        timestamp: candle.timestamp,
        value: ema,
      });
    } else {
      // Standard EMA calculation
      ema = (price - ema!) * multiplier + ema!;
      values.push({
        timestamp: candle.timestamp,
        value: ema,
      });
    }
  }

  return values;
}

/**
 * Get the EMA value at a specific timestamp
 */
export function getEMAAtTimestamp(
  values: IndicatorValue[],
  timestamp: number
): number | undefined {
  const value = values.find((v) => v.timestamp === timestamp);
  return value?.value;
}
