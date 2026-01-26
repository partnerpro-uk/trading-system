/**
 * Spike Detector - Echo Strategy Custom Indicator
 *
 * Detects significant price movements (spikes) based on ATR threshold.
 * A spike is defined as price moving more than atrMultiplier * ATR
 * over a lookback period of candles.
 *
 * Freshness filter prevents multiple signals within a window.
 */

import { CandleInput, IndicatorValue } from "@/lib/indicators/types";
import { computeATR } from "@/lib/indicators/primitives/atr";

export interface SpikeDetectorParams {
  atrMultiplier: number;      // Default: 2 (2x ATR threshold)
  lookback: number;           // Default: 6 candles
  freshnessWindow: number;    // Default: 10 candles (no repeat signals)
  atrPeriod: number;          // Default: 100 (ATR calculation period)
}

export const SPIKE_DETECTOR_DEFAULTS: SpikeDetectorParams = {
  atrMultiplier: 2,
  lookback: 6,
  freshnessWindow: 10,
  atrPeriod: 100,
};

export interface SpikeDetectorOutput {
  upSpike: IndicatorValue[];       // 1 = bullish spike, 0 = none
  downSpike: IndicatorValue[];     // 1 = bearish spike, 0 = none
  spikeStrength: IndicatorValue[]; // How many ATRs the move was
}

/**
 * Check if there was a recent spike within the freshness window
 */
function wasRecentSpike(
  upSpikes: IndicatorValue[],
  downSpikes: IndicatorValue[],
  currentIndex: number,
  freshnessWindow: number
): boolean {
  const startIdx = Math.max(0, currentIndex - freshnessWindow);

  for (let i = startIdx; i < currentIndex; i++) {
    if (upSpikes[i]?.value === 1 || downSpikes[i]?.value === 1) {
      return true;
    }
  }

  return false;
}

/**
 * Compute spike detection values
 *
 * @param candles - Array of candle data
 * @param params - Detection parameters
 * @returns Object containing upSpike, downSpike, and spikeStrength arrays
 */
export function computeSpikeDetector(
  candles: CandleInput[],
  params: Partial<SpikeDetectorParams> = {}
): SpikeDetectorOutput {
  const {
    atrMultiplier,
    lookback,
    freshnessWindow,
    atrPeriod,
  } = { ...SPIKE_DETECTOR_DEFAULTS, ...params };

  // First, compute ATR values
  const atrValues = computeATR(candles, { period: atrPeriod });

  // Create a map for quick ATR lookup
  const atrMap = new Map<number, number>();
  for (const v of atrValues) {
    atrMap.set(v.timestamp, v.value);
  }

  const upSpike: IndicatorValue[] = [];
  const downSpike: IndicatorValue[] = [];
  const spikeStrength: IndicatorValue[] = [];

  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    const timestamp = current.timestamp;

    // Need lookback candles before current
    if (i < lookback) {
      upSpike.push({ timestamp, value: 0 });
      downSpike.push({ timestamp, value: 0 });
      spikeStrength.push({ timestamp, value: 0 });
      continue;
    }

    const reference = candles[i - lookback];
    const atr = atrMap.get(timestamp);

    // If ATR not available yet, no signal
    if (!atr || atr === 0) {
      upSpike.push({ timestamp, value: 0 });
      downSpike.push({ timestamp, value: 0 });
      spikeStrength.push({ timestamp, value: 0 });
      continue;
    }

    const threshold = atr * atrMultiplier;
    const priceChange = current.close - reference.close;
    const normalizedMove = Math.abs(priceChange) / atr;

    const isUpSpike = priceChange > threshold;
    const isDownSpike = priceChange < -threshold;

    // Freshness check - prevent signals within window of previous signal
    const isFresh = !wasRecentSpike(upSpike, downSpike, upSpike.length, freshnessWindow);

    upSpike.push({
      timestamp,
      value: isUpSpike && isFresh ? 1 : 0,
    });

    downSpike.push({
      timestamp,
      value: isDownSpike && isFresh ? 1 : 0,
    });

    spikeStrength.push({
      timestamp,
      value: normalizedMove,
    });
  }

  return { upSpike, downSpike, spikeStrength };
}

/**
 * Get spike signals at a specific timestamp
 */
export function getSpikeAt(
  output: SpikeDetectorOutput,
  timestamp: number
): { up: boolean; down: boolean; strength: number } | null {
  const idx = output.upSpike.findIndex((v) => v.timestamp === timestamp);
  if (idx === -1) return null;

  return {
    up: output.upSpike[idx].value === 1,
    down: output.downSpike[idx].value === 1,
    strength: output.spikeStrength[idx].value,
  };
}

/**
 * Find all spike timestamps
 */
export function getAllSpikes(
  output: SpikeDetectorOutput
): Array<{ timestamp: number; direction: "up" | "down"; strength: number }> {
  const spikes: Array<{ timestamp: number; direction: "up" | "down"; strength: number }> = [];

  for (let i = 0; i < output.upSpike.length; i++) {
    if (output.upSpike[i].value === 1) {
      spikes.push({
        timestamp: output.upSpike[i].timestamp,
        direction: "up",
        strength: output.spikeStrength[i].value,
      });
    }
    if (output.downSpike[i].value === 1) {
      spikes.push({
        timestamp: output.downSpike[i].timestamp,
        direction: "down",
        strength: output.spikeStrength[i].value,
      });
    }
  }

  return spikes.sort((a, b) => a.timestamp - b.timestamp);
}
