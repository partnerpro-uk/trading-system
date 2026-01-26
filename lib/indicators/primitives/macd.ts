/**
 * MACD (Moving Average Convergence Divergence) Indicator
 *
 * Trend-following momentum indicator showing relationship between two EMAs.
 *
 * Components:
 *   - MACD Line: Fast EMA - Slow EMA
 *   - Signal Line: EMA of MACD Line
 *   - Histogram: MACD Line - Signal Line
 *
 * Standard settings: 12, 26, 9
 */

import { CandleInput, IndicatorValue } from "../types";
import { computeEMA } from "./ema";

export interface MACDParams {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  source: "close" | "open" | "high" | "low" | "hl2" | "hlc3";
}

export const MACD_DEFAULTS: MACDParams = {
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
  source: "close",
};

/**
 * MACD output structure (multi-output indicator)
 */
export interface MACDOutput {
  macd: IndicatorValue[];       // MACD line (fast EMA - slow EMA)
  signal: IndicatorValue[];     // Signal line (EMA of MACD)
  histogram: IndicatorValue[];  // Histogram (MACD - Signal)
}

/**
 * Compute MACD values for candle data
 *
 * @param candles - Array of candle data (must be sorted by timestamp ascending)
 * @param params - MACD parameters
 * @returns Object containing macd, signal, and histogram arrays
 */
export function computeMACD(
  candles: CandleInput[],
  params: Partial<MACDParams> = {}
): MACDOutput {
  const { fastPeriod, slowPeriod, signalPeriod, source } = { ...MACD_DEFAULTS, ...params };

  if (candles.length === 0) {
    return { macd: [], signal: [], histogram: [] };
  }

  // Compute fast and slow EMAs
  const fastEMA = computeEMA(candles, { period: fastPeriod, source });
  const slowEMA = computeEMA(candles, { period: slowPeriod, source });

  // Calculate MACD line (fast - slow)
  const macdValues: IndicatorValue[] = [];

  for (let i = 0; i < candles.length; i++) {
    const timestamp = candles[i].timestamp;
    const fast = fastEMA[i]?.value;
    const slow = slowEMA[i]?.value;

    if (isNaN(fast) || isNaN(slow)) {
      macdValues.push({
        timestamp,
        value: NaN,
        metadata: { insufficient: true },
      });
    } else {
      macdValues.push({
        timestamp,
        value: fast - slow,
      });
    }
  }

  // Compute signal line (EMA of MACD)
  // We need to convert MACD values to a format computeEMA can use
  const macdAsCandles: CandleInput[] = macdValues
    .filter((v) => !isNaN(v.value))
    .map((v) => ({
      timestamp: v.timestamp,
      open: v.value,
      high: v.value,
      low: v.value,
      close: v.value,
      volume: 0,
    }));

  const signalEMA = computeEMA(macdAsCandles, { period: signalPeriod, source: "close" });

  // Create signal values array aligned with original timestamps
  const signalMap = new Map<number, number>();
  for (const s of signalEMA) {
    if (!isNaN(s.value)) {
      signalMap.set(s.timestamp, s.value);
    }
  }

  const signal: IndicatorValue[] = [];
  const histogram: IndicatorValue[] = [];

  for (let i = 0; i < candles.length; i++) {
    const timestamp = candles[i].timestamp;
    const macdVal = macdValues[i].value;
    const signalVal = signalMap.get(timestamp);

    if (signalVal !== undefined && !isNaN(macdVal)) {
      signal.push({
        timestamp,
        value: signalVal,
      });

      histogram.push({
        timestamp,
        value: macdVal - signalVal,
      });
    } else {
      signal.push({
        timestamp,
        value: NaN,
        metadata: { insufficient: true },
      });

      histogram.push({
        timestamp,
        value: NaN,
        metadata: { insufficient: true },
      });
    }
  }

  return {
    macd: macdValues,
    signal,
    histogram,
  };
}

/**
 * Detect MACD crossover (signal line cross)
 *
 * @param macdOutput - MACD output from computeMACD
 * @param index - Index to check for crossover
 * @returns "bullish" if MACD crosses above signal, "bearish" if below, null otherwise
 */
export function detectMACDCrossover(
  macdOutput: MACDOutput,
  index: number
): "bullish" | "bearish" | null {
  if (index < 1 || index >= macdOutput.macd.length) {
    return null;
  }

  const currentMACD = macdOutput.macd[index].value;
  const prevMACD = macdOutput.macd[index - 1].value;
  const currentSignal = macdOutput.signal[index].value;
  const prevSignal = macdOutput.signal[index - 1].value;

  if (isNaN(currentMACD) || isNaN(prevMACD) || isNaN(currentSignal) || isNaN(prevSignal)) {
    return null;
  }

  // Bullish crossover: MACD crosses above Signal
  if (prevMACD <= prevSignal && currentMACD > currentSignal) {
    return "bullish";
  }

  // Bearish crossover: MACD crosses below Signal
  if (prevMACD >= prevSignal && currentMACD < currentSignal) {
    return "bearish";
  }

  return null;
}

/**
 * Detect MACD zero line crossover
 *
 * @param macdOutput - MACD output from computeMACD
 * @param index - Index to check for crossover
 * @returns "bullish" if MACD crosses above zero, "bearish" if below, null otherwise
 */
export function detectMACDZeroCrossover(
  macdOutput: MACDOutput,
  index: number
): "bullish" | "bearish" | null {
  if (index < 1 || index >= macdOutput.macd.length) {
    return null;
  }

  const currentMACD = macdOutput.macd[index].value;
  const prevMACD = macdOutput.macd[index - 1].value;

  if (isNaN(currentMACD) || isNaN(prevMACD)) {
    return null;
  }

  // Bullish: MACD crosses above zero
  if (prevMACD <= 0 && currentMACD > 0) {
    return "bullish";
  }

  // Bearish: MACD crosses below zero
  if (prevMACD >= 0 && currentMACD < 0) {
    return "bearish";
  }

  return null;
}

/**
 * Check histogram direction (momentum)
 *
 * @param macdOutput - MACD output from computeMACD
 * @param index - Index to check
 * @returns "increasing" if histogram growing, "decreasing" if shrinking, null otherwise
 */
export function getHistogramDirection(
  macdOutput: MACDOutput,
  index: number
): "increasing" | "decreasing" | null {
  if (index < 1 || index >= macdOutput.histogram.length) {
    return null;
  }

  const current = macdOutput.histogram[index].value;
  const prev = macdOutput.histogram[index - 1].value;

  if (isNaN(current) || isNaN(prev)) {
    return null;
  }

  // Absolute value increasing = momentum strengthening
  if (Math.abs(current) > Math.abs(prev)) {
    return "increasing";
  }

  // Absolute value decreasing = momentum weakening
  if (Math.abs(current) < Math.abs(prev)) {
    return "decreasing";
  }

  return null;
}

/**
 * Get MACD trend state
 */
export function getMACDState(
  macdOutput: MACDOutput,
  index: number
): {
  macdAboveSignal: boolean;
  macdAboveZero: boolean;
  histogramPositive: boolean;
  trend: "bullish" | "bearish" | "neutral";
} | null {
  if (index < 0 || index >= macdOutput.macd.length) {
    return null;
  }

  const macd = macdOutput.macd[index].value;
  const signal = macdOutput.signal[index].value;
  const histogram = macdOutput.histogram[index].value;

  if (isNaN(macd) || isNaN(signal) || isNaN(histogram)) {
    return null;
  }

  const macdAboveSignal = macd > signal;
  const macdAboveZero = macd > 0;
  const histogramPositive = histogram > 0;

  // Determine trend
  let trend: "bullish" | "bearish" | "neutral";
  if (macdAboveSignal && macdAboveZero) {
    trend = "bullish";
  } else if (!macdAboveSignal && !macdAboveZero) {
    trend = "bearish";
  } else {
    trend = "neutral";
  }

  return {
    macdAboveSignal,
    macdAboveZero,
    histogramPositive,
    trend,
  };
}
