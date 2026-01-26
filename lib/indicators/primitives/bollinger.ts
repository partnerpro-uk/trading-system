/**
 * Bollinger Bands Indicator
 *
 * Volatility bands placed above and below a moving average.
 *
 * Components:
 *   - Middle Band: SMA of price
 *   - Upper Band: Middle + (stdDev * multiplier)
 *   - Lower Band: Middle - (stdDev * multiplier)
 *
 * Standard settings: 20 period, 2 standard deviations
 */

import { CandleInput, IndicatorValue } from "../types";
import { computeSMA } from "./sma";

export interface BollingerParams {
  period: number;
  multiplier: number;  // Standard deviation multiplier (typically 2)
  source: "close" | "open" | "high" | "low" | "hl2" | "hlc3";
}

export const BOLLINGER_DEFAULTS: BollingerParams = {
  period: 20,
  multiplier: 2,
  source: "close",
};

/**
 * Bollinger Bands output structure (multi-output indicator)
 */
export interface BollingerOutput {
  upper: IndicatorValue[];     // Upper band
  middle: IndicatorValue[];    // Middle band (SMA)
  lower: IndicatorValue[];     // Lower band
  bandwidth: IndicatorValue[]; // Bandwidth: (upper - lower) / middle * 100
  percentB: IndicatorValue[];  // %B: (price - lower) / (upper - lower)
}

/**
 * Get source price from candle
 */
function getSourcePrice(candle: CandleInput, source: BollingerParams["source"]): number {
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
 * Calculate standard deviation for a window of values
 */
function calculateStdDev(values: number[], mean: number): number {
  if (values.length === 0) return 0;

  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;

  return Math.sqrt(avgSquaredDiff);
}

/**
 * Compute Bollinger Bands values for candle data
 *
 * @param candles - Array of candle data (must be sorted by timestamp ascending)
 * @param params - Bollinger parameters
 * @returns Object containing upper, middle, lower, bandwidth, and percentB arrays
 */
export function computeBollinger(
  candles: CandleInput[],
  params: Partial<BollingerParams> = {}
): BollingerOutput {
  const { period, multiplier, source } = { ...BOLLINGER_DEFAULTS, ...params };

  if (candles.length === 0) {
    return { upper: [], middle: [], lower: [], bandwidth: [], percentB: [] };
  }

  // Compute middle band (SMA)
  const middleBand = computeSMA(candles, { period, source });

  const upper: IndicatorValue[] = [];
  const lower: IndicatorValue[] = [];
  const bandwidth: IndicatorValue[] = [];
  const percentB: IndicatorValue[] = [];

  // Calculate standard deviation for each point
  for (let i = 0; i < candles.length; i++) {
    const timestamp = candles[i].timestamp;
    const middleValue = middleBand[i].value;
    const currentPrice = getSourcePrice(candles[i], source);

    if (isNaN(middleValue) || i < period - 1) {
      upper.push({ timestamp, value: NaN, metadata: { insufficient: true } });
      lower.push({ timestamp, value: NaN, metadata: { insufficient: true } });
      bandwidth.push({ timestamp, value: NaN, metadata: { insufficient: true } });
      percentB.push({ timestamp, value: NaN, metadata: { insufficient: true } });
      continue;
    }

    // Get the window of prices for std dev calculation
    const windowPrices: number[] = [];
    for (let j = i - period + 1; j <= i; j++) {
      windowPrices.push(getSourcePrice(candles[j], source));
    }

    const stdDev = calculateStdDev(windowPrices, middleValue);
    const deviation = stdDev * multiplier;

    const upperValue = middleValue + deviation;
    const lowerValue = middleValue - deviation;
    const bandwidthValue = middleValue > 0 ? ((upperValue - lowerValue) / middleValue) * 100 : 0;
    const percentBValue = upperValue !== lowerValue
      ? (currentPrice - lowerValue) / (upperValue - lowerValue)
      : 0.5;

    upper.push({
      timestamp,
      value: upperValue,
      metadata: { stdDev },
    });

    lower.push({
      timestamp,
      value: lowerValue,
      metadata: { stdDev },
    });

    bandwidth.push({
      timestamp,
      value: bandwidthValue,
    });

    percentB.push({
      timestamp,
      value: percentBValue,
    });
  }

  return {
    upper,
    middle: middleBand,
    lower,
    bandwidth,
    percentB,
  };
}

/**
 * Check if price is touching upper band
 */
export function isTouchingUpperBand(
  price: number,
  upperBand: number,
  tolerance: number = 0.001
): boolean {
  if (isNaN(upperBand)) return false;
  const diff = Math.abs(price - upperBand) / upperBand;
  return diff <= tolerance || price >= upperBand;
}

/**
 * Check if price is touching lower band
 */
export function isTouchingLowerBand(
  price: number,
  lowerBand: number,
  tolerance: number = 0.001
): boolean {
  if (isNaN(lowerBand)) return false;
  const diff = Math.abs(price - lowerBand) / lowerBand;
  return diff <= tolerance || price <= lowerBand;
}

/**
 * Check if price is outside bands (potential reversal or breakout)
 */
export function isOutsideBands(
  price: number,
  upperBand: number,
  lowerBand: number
): "above" | "below" | null {
  if (isNaN(upperBand) || isNaN(lowerBand)) return null;

  if (price > upperBand) return "above";
  if (price < lowerBand) return "below";
  return null;
}

/**
 * Detect Bollinger Band squeeze (low volatility)
 *
 * @param bollingerOutput - Bollinger output from computeBollinger
 * @param index - Index to check
 * @param lookback - Number of bars to compare against
 * @param threshold - Percentage threshold (bandwidth must be lower than this percentile)
 * @returns true if in squeeze
 */
export function detectSqueeze(
  bollingerOutput: BollingerOutput,
  index: number,
  lookback: number = 50,
  threshold: number = 0.2  // Bottom 20%
): boolean {
  if (index < lookback || index >= bollingerOutput.bandwidth.length) {
    return false;
  }

  const currentBandwidth = bollingerOutput.bandwidth[index].value;
  if (isNaN(currentBandwidth)) return false;

  // Get recent bandwidth values
  const recentBandwidths: number[] = [];
  for (let i = index - lookback + 1; i <= index; i++) {
    const bw = bollingerOutput.bandwidth[i].value;
    if (!isNaN(bw)) {
      recentBandwidths.push(bw);
    }
  }

  if (recentBandwidths.length < lookback * 0.8) return false;

  // Sort and find threshold value
  const sorted = [...recentBandwidths].sort((a, b) => a - b);
  const thresholdIndex = Math.floor(sorted.length * threshold);
  const thresholdValue = sorted[thresholdIndex];

  return currentBandwidth <= thresholdValue;
}

/**
 * Get Bollinger Band position description
 */
export function getBollingerPosition(
  percentB: number
): "above_upper" | "near_upper" | "middle" | "near_lower" | "below_lower" {
  if (isNaN(percentB)) return "middle";

  if (percentB >= 1) return "above_upper";
  if (percentB >= 0.8) return "near_upper";
  if (percentB <= 0) return "below_lower";
  if (percentB <= 0.2) return "near_lower";
  return "middle";
}

/**
 * Detect band expansion (increasing volatility)
 */
export function detectBandExpansion(
  bollingerOutput: BollingerOutput,
  index: number,
  lookback: number = 5
): boolean {
  if (index < lookback || index >= bollingerOutput.bandwidth.length) {
    return false;
  }

  const currentBandwidth = bollingerOutput.bandwidth[index].value;
  const previousBandwidth = bollingerOutput.bandwidth[index - lookback].value;

  if (isNaN(currentBandwidth) || isNaN(previousBandwidth)) return false;

  // Check if bandwidth has increased significantly
  return currentBandwidth > previousBandwidth * 1.2;  // 20% increase
}
