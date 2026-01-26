/**
 * RSI (Relative Strength Index) Indicator
 *
 * Momentum oscillator measuring speed and magnitude of price movements.
 * Values range from 0 to 100, with overbought >70 and oversold <30.
 *
 * Formula:
 *   RSI = 100 - (100 / (1 + RS))
 *   RS = Average Gain / Average Loss
 *
 * Uses Wilder's smoothing method (exponential moving average).
 */

import { CandleInput, IndicatorValue } from "../types";

export interface RSIParams {
  period: number;
  source: "close" | "open" | "high" | "low" | "hl2" | "hlc3";
  overbought: number;  // Typically 70
  oversold: number;    // Typically 30
}

export const RSI_DEFAULTS: RSIParams = {
  period: 14,
  source: "close",
  overbought: 70,
  oversold: 30,
};

/**
 * Get source price from candle
 */
function getSourcePrice(candle: CandleInput, source: RSIParams["source"]): number {
  switch (source) {
    case "open":
      return candle.open;
    case "high":
      return candle.high;
    case "low":
      return candle.low;
    case "hl2":
      return (candle.high + candle.low) / 2;
    case "hlc3":
      return (candle.high + candle.low + candle.close) / 3;
    default:
      return candle.close;
  }
}

/**
 * Compute RSI values for candle data
 *
 * @param candles - Array of candle data (must be sorted by timestamp ascending)
 * @param params - RSI parameters
 * @returns Array of indicator values
 */
export function computeRSI(
  candles: CandleInput[],
  params: Partial<RSIParams> = {}
): IndicatorValue[] {
  const { period, source } = { ...RSI_DEFAULTS, ...params };

  if (candles.length === 0) {
    return [];
  }

  const values: IndicatorValue[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Calculate initial average gain/loss for first period
  for (let i = 0; i < candles.length; i++) {
    const timestamp = candles[i].timestamp;

    // Need at least period + 1 candles to start
    if (i < period) {
      values.push({
        timestamp,
        value: NaN,
        metadata: { insufficient: true },
      });
      continue;
    }

    // First RSI calculation - use simple averages
    if (i === period) {
      let gains = 0;
      let losses = 0;

      for (let j = 1; j <= period; j++) {
        const current = getSourcePrice(candles[j], source);
        const previous = getSourcePrice(candles[j - 1], source);
        const change = current - previous;

        if (change > 0) {
          gains += change;
        } else {
          losses += Math.abs(change);
        }
      }

      avgGain = gains / period;
      avgLoss = losses / period;
    } else {
      // Subsequent calculations - use Wilder's smoothing
      const current = getSourcePrice(candles[i], source);
      const previous = getSourcePrice(candles[i - 1], source);
      const change = current - previous;

      const currentGain = change > 0 ? change : 0;
      const currentLoss = change < 0 ? Math.abs(change) : 0;

      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    // Calculate RS and RSI
    let rsi: number;
    if (avgLoss === 0) {
      rsi = 100;  // No losses = maximum RSI
    } else if (avgGain === 0) {
      rsi = 0;    // No gains = minimum RSI
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
    }

    values.push({
      timestamp,
      value: rsi,
      metadata: {
        avgGain,
        avgLoss,
        rs: avgLoss > 0 ? avgGain / avgLoss : 0,
      },
    });
  }

  return values;
}

/**
 * Check if RSI is in overbought territory
 */
export function isOverbought(rsi: number, threshold: number = RSI_DEFAULTS.overbought): boolean {
  return rsi >= threshold;
}

/**
 * Check if RSI is in oversold territory
 */
export function isOversold(rsi: number, threshold: number = RSI_DEFAULTS.oversold): boolean {
  return rsi <= threshold;
}

/**
 * Detect RSI divergence (bullish or bearish)
 *
 * @param priceValues - Array of price values (close prices)
 * @param rsiValues - Array of RSI values (aligned with prices)
 * @param lookback - Number of bars to look back for divergence
 * @returns Divergence type or null
 */
export function detectRSIDivergence(
  priceValues: number[],
  rsiValues: number[],
  lookback: number = 5
): "bullish" | "bearish" | null {
  if (priceValues.length < lookback || rsiValues.length < lookback) {
    return null;
  }

  const len = priceValues.length;

  // Get recent highs/lows
  const recentPrices = priceValues.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  const priceHigh = Math.max(...recentPrices);
  const priceLow = Math.min(...recentPrices);
  const rsiHigh = Math.max(...recentRSI);
  const rsiLow = Math.min(...recentRSI);

  const currentPrice = priceValues[len - 1];
  const currentRSI = rsiValues[len - 1];
  const prevPrice = priceValues[len - lookback];
  const prevRSI = rsiValues[len - lookback];

  // Bullish divergence: price makes lower low, RSI makes higher low
  if (currentPrice < prevPrice && currentRSI > prevRSI && currentPrice === priceLow && currentRSI > rsiLow) {
    return "bullish";
  }

  // Bearish divergence: price makes higher high, RSI makes lower high
  if (currentPrice > prevPrice && currentRSI < prevRSI && currentPrice === priceHigh && currentRSI < rsiHigh) {
    return "bearish";
  }

  return null;
}

/**
 * Get RSI zone description
 */
export function getRSIZone(
  rsi: number,
  overbought: number = RSI_DEFAULTS.overbought,
  oversold: number = RSI_DEFAULTS.oversold
): "overbought" | "oversold" | "neutral" | "bullish" | "bearish" {
  if (rsi >= overbought) return "overbought";
  if (rsi <= oversold) return "oversold";
  if (rsi > 50) return "bullish";
  if (rsi < 50) return "bearish";
  return "neutral";
}
