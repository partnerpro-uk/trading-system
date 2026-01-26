/**
 * Indicator Compute Orchestrator
 *
 * Takes candle data and indicator configurations, returns computed series.
 * This is the main entry point for computing indicators.
 */

import {
  CandleInput,
  IndicatorConfig,
  IndicatorSeries,
  IndicatorSnapshot,
  IndicatorRegistryEntry,
  IndicatorComputeFn,
} from "./types";
import { computeEMA, EMA_DEFAULTS } from "./primitives/ema";
import { computeSMA, SMA_DEFAULTS } from "./primitives/sma";
import { computeATR, ATR_DEFAULTS } from "./primitives/atr";
import { computeRSI, RSI_DEFAULTS } from "./primitives/rsi";
import { computeMACD, MACD_DEFAULTS } from "./primitives/macd";
import { computeBollinger, BOLLINGER_DEFAULTS } from "./primitives/bollinger";

/**
 * Registry of all available indicator types
 */
export const INDICATOR_REGISTRY: Record<string, IndicatorRegistryEntry> = {
  ema: {
    compute: computeEMA as IndicatorComputeFn,
    defaultParams: EMA_DEFAULTS as unknown as Record<string, number | string>,
    description: "Exponential Moving Average",
  },
  sma: {
    compute: computeSMA as IndicatorComputeFn,
    defaultParams: SMA_DEFAULTS as unknown as Record<string, number | string>,
    description: "Simple Moving Average",
  },
  atr: {
    compute: computeATR as IndicatorComputeFn,
    defaultParams: ATR_DEFAULTS as unknown as Record<string, number | string>,
    description: "Average True Range",
  },
  rsi: {
    compute: computeRSI as IndicatorComputeFn,
    defaultParams: RSI_DEFAULTS as unknown as Record<string, number | string>,
    description: "Relative Strength Index",
  },
  // Multi-output indicators (require special handling for chart rendering)
  // The compute functions return objects with multiple arrays
  macd: {
    compute: ((candles, params) => computeMACD(candles, params).macd) as IndicatorComputeFn,
    defaultParams: MACD_DEFAULTS as unknown as Record<string, number | string>,
    description: "MACD Line",
  },
  macd_signal: {
    compute: ((candles, params) => computeMACD(candles, params).signal) as IndicatorComputeFn,
    defaultParams: MACD_DEFAULTS as unknown as Record<string, number | string>,
    description: "MACD Signal Line",
  },
  macd_histogram: {
    compute: ((candles, params) => computeMACD(candles, params).histogram) as IndicatorComputeFn,
    defaultParams: MACD_DEFAULTS as unknown as Record<string, number | string>,
    description: "MACD Histogram",
  },
  bollinger_upper: {
    compute: ((candles, params) => computeBollinger(candles, params).upper) as IndicatorComputeFn,
    defaultParams: BOLLINGER_DEFAULTS as unknown as Record<string, number | string>,
    description: "Bollinger Upper Band",
  },
  bollinger_middle: {
    compute: ((candles, params) => computeBollinger(candles, params).middle) as IndicatorComputeFn,
    defaultParams: BOLLINGER_DEFAULTS as unknown as Record<string, number | string>,
    description: "Bollinger Middle Band (SMA)",
  },
  bollinger_lower: {
    compute: ((candles, params) => computeBollinger(candles, params).lower) as IndicatorComputeFn,
    defaultParams: BOLLINGER_DEFAULTS as unknown as Record<string, number | string>,
    description: "Bollinger Lower Band",
  },
};

/**
 * Get list of available indicator types
 */
export function getAvailableIndicators(): string[] {
  return Object.keys(INDICATOR_REGISTRY);
}

/**
 * Get indicator description
 */
export function getIndicatorDescription(type: string): string | undefined {
  return INDICATOR_REGISTRY[type]?.description;
}

/**
 * Compute a single indicator series
 */
export function computeIndicator(
  candles: CandleInput[],
  config: IndicatorConfig
): IndicatorSeries {
  const registry = INDICATOR_REGISTRY[config.type];

  if (!registry) {
    throw new Error(`Unknown indicator type: ${config.type}. Available: ${getAvailableIndicators().join(", ")}`);
  }

  // Merge default params with provided params
  const params = { ...registry.defaultParams, ...config.params };

  // Compute the indicator values (cast to IndicatorValue[] for single-output indicators)
  const values = registry.compute(candles, params) as import("./types").IndicatorValue[];

  return {
    id: config.id,
    type: config.type,
    params,
    values,
  };
}

/**
 * Compute multiple indicators from configurations
 *
 * @param candles - Array of candle data
 * @param configs - Array of indicator configurations
 * @returns Array of computed indicator series
 *
 * @example
 * ```ts
 * const series = computeIndicators(candles, [
 *   { id: "ema_30", type: "ema", params: { period: 30 }, style: { color: "#3B82F6" } },
 *   { id: "ema_200", type: "ema", params: { period: 200 }, style: { color: "#EF4444" } },
 * ]);
 * ```
 */
export function computeIndicators(
  candles: CandleInput[],
  configs: IndicatorConfig[]
): IndicatorSeries[] {
  return configs.map((config) => computeIndicator(candles, config));
}

/**
 * Get a snapshot of all indicator values at a specific timestamp
 *
 * @param series - Array of computed indicator series
 * @param timestamp - The timestamp to get values at
 * @returns Object mapping indicator IDs to their values
 *
 * @example
 * ```ts
 * const snapshot = getIndicatorSnapshot(series, 1706140800000);
 * // Returns: { ema_30: 1.0842, ema_200: 1.0821, atr_100: 0.0015 }
 * ```
 */
export function getIndicatorSnapshot(
  series: IndicatorSeries[],
  timestamp: number
): IndicatorSnapshot {
  const indicators: Record<string, number> = {};

  for (const s of series) {
    const value = s.values.find((v) => v.timestamp === timestamp);
    if (value !== undefined) {
      indicators[s.id] = value.value;
    }
  }

  return {
    timestamp,
    indicators,
  };
}

/**
 * Get indicator values within a time range
 *
 * @param series - A single indicator series
 * @param startTimestamp - Start of range (inclusive)
 * @param endTimestamp - End of range (inclusive)
 * @returns Filtered indicator values
 */
export function getIndicatorValuesInRange(
  series: IndicatorSeries,
  startTimestamp: number,
  endTimestamp: number
): IndicatorSeries {
  return {
    ...series,
    values: series.values.filter(
      (v) => v.timestamp >= startTimestamp && v.timestamp <= endTimestamp
    ),
  };
}

/**
 * Find crossover points between two indicator series
 *
 * @param fast - The faster moving indicator
 * @param slow - The slower moving indicator
 * @returns Array of crossover events
 */
export function findCrossovers(
  fast: IndicatorSeries,
  slow: IndicatorSeries
): Array<{
  timestamp: number;
  type: "bullish" | "bearish";
  fastValue: number;
  slowValue: number;
}> {
  const crossovers: Array<{
    timestamp: number;
    type: "bullish" | "bearish";
    fastValue: number;
    slowValue: number;
  }> = [];

  // Create a map for quick lookup
  const slowMap = new Map(slow.values.map((v) => [v.timestamp, v.value]));

  let prevFastAbove: boolean | null = null;

  for (const fastVal of fast.values) {
    const slowVal = slowMap.get(fastVal.timestamp);
    if (slowVal === undefined) continue;

    const fastAbove = fastVal.value > slowVal;

    if (prevFastAbove !== null && fastAbove !== prevFastAbove) {
      crossovers.push({
        timestamp: fastVal.timestamp,
        type: fastAbove ? "bullish" : "bearish",
        fastValue: fastVal.value,
        slowValue: slowVal,
      });
    }

    prevFastAbove = fastAbove;
  }

  return crossovers;
}

/**
 * Check if an indicator is above/below another at a specific timestamp
 */
export function compareIndicatorsAt(
  series1: IndicatorSeries,
  series2: IndicatorSeries,
  timestamp: number
): { above: boolean; diff: number } | null {
  const val1 = series1.values.find((v) => v.timestamp === timestamp);
  const val2 = series2.values.find((v) => v.timestamp === timestamp);

  if (!val1 || !val2) return null;

  return {
    above: val1.value > val2.value,
    diff: val1.value - val2.value,
  };
}
