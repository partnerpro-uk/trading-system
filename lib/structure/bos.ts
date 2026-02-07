/**
 * Break of Structure (BOS) Detection
 *
 * A BOS occurs when price CLOSES ITS BODY beyond a prior swing point.
 * Wicks through a level are NOT breaks — they're sweeps (detected separately).
 *
 * Features:
 * - Body-close only confirmation
 * - Displacement detection (body >= 2x median of recent bodies)
 * - Reclaim detection (price closes back beyond the broken level)
 */

import type { Candle, SwingPoint, BOSEvent, BOSDirection } from "./types";

/**
 * Get pip multiplier for a currency pair.
 * JPY pairs use 2 decimal places, others use 4-5.
 */
function getPipMultiplier(pair: string): number {
  return pair.includes("JPY") ? 100 : 10000;
}

/**
 * Compute median of candle body sizes over a lookback window.
 */
function computeMedianBody(
  candles: Candle[],
  endIndex: number,
  lookback: number
): number {
  const start = Math.max(0, endIndex - lookback + 1);
  const bodies: number[] = [];

  for (let i = start; i <= endIndex; i++) {
    bodies.push(Math.abs(candles[i].close - candles[i].open));
  }

  if (bodies.length === 0) return 0;

  bodies.sort((a, b) => a - b);
  const mid = Math.floor(bodies.length / 2);

  if (bodies.length % 2 === 0) {
    return (bodies[mid - 1] + bodies[mid]) / 2;
  }
  return bodies[mid];
}

/**
 * Detect Break of Structure events.
 *
 * Algorithm:
 * 1. Track reference swing highs and lows (most recent confirmed swings)
 * 2. For each candle after the first swings, check if body closes beyond reference levels
 * 3. On BOS, compute magnitude, displacement, and mark as active
 * 4. Second pass: detect reclaims (body close back beyond broken level)
 */
export function detectBOS(
  candles: Candle[],
  swings: SwingPoint[],
  pair: string
): BOSEvent[] {
  if (swings.length < 2 || candles.length === 0) {
    return [];
  }

  const pipMultiplier = getPipMultiplier(pair);
  const events: BOSEvent[] = [];

  // Build a map of swing timestamps for quick lookup
  const swingHighs = swings.filter((s) => s.type === "high");
  const swingLows = swings.filter((s) => s.type === "low");

  if (swingHighs.length === 0 || swingLows.length === 0) {
    return [];
  }

  // Track which swing levels are "active" reference points
  // Start from the first swing of each type
  let refHighIdx = 0;
  let refLowIdx = 0;
  let lastBullishBOS: BOSEvent | null = null;
  let lastBearishBOS: BOSEvent | null = null;

  // Find the candle index where we can start checking
  const firstSwingCandleIdx = Math.min(
    swingHighs[0].candleIndex,
    swingLows[0].candleIndex
  );

  for (let i = firstSwingCandleIdx + 1; i < candles.length; i++) {
    const candle = candles[i];

    // Advance reference swings: use the most recent swing that formed BEFORE this candle
    while (
      refHighIdx < swingHighs.length - 1 &&
      swingHighs[refHighIdx + 1].candleIndex < i
    ) {
      refHighIdx++;
    }
    while (
      refLowIdx < swingLows.length - 1 &&
      swingLows[refLowIdx + 1].candleIndex < i
    ) {
      refLowIdx++;
    }

    const refHigh = swingHighs[refHighIdx];
    const refLow = swingLows[refLowIdx];

    // Only check swings that formed before this candle
    if (refHigh.candleIndex >= i && refLow.candleIndex >= i) continue;

    // Check bullish BOS: body close above reference swing high
    if (
      refHigh.candleIndex < i &&
      candle.close > refHigh.price &&
      (!lastBullishBOS || refHigh.timestamp > lastBullishBOS.brokenSwingTimestamp)
    ) {
      const bodySize = Math.abs(candle.close - candle.open);
      const medianBody = computeMedianBody(candles, i, 20);
      const isDisplacement = medianBody > 0 && bodySize >= medianBody * 2.0;

      const event: BOSEvent = {
        timestamp: candle.timestamp,
        direction: "bullish",
        status: "active",
        brokenLevel: refHigh.price,
        brokenSwingTimestamp: refHigh.timestamp,
        confirmingClose: candle.close,
        magnitudePips:
          Math.round(
            Math.abs(candle.close - refHigh.price) * pipMultiplier * 100
          ) / 100,
        isDisplacement,
        isCounterTrend: false, // Phase 1 default
      };

      events.push(event);
      lastBullishBOS = event;
    }

    // Check bearish BOS: body close below reference swing low
    if (
      refLow.candleIndex < i &&
      candle.close < refLow.price &&
      (!lastBearishBOS || refLow.timestamp > lastBearishBOS.brokenSwingTimestamp)
    ) {
      const bodySize = Math.abs(candle.close - candle.open);
      const medianBody = computeMedianBody(candles, i, 20);
      const isDisplacement = medianBody > 0 && bodySize >= medianBody * 2.0;

      const event: BOSEvent = {
        timestamp: candle.timestamp,
        direction: "bearish",
        status: "active",
        brokenLevel: refLow.price,
        brokenSwingTimestamp: refLow.timestamp,
        confirmingClose: candle.close,
        magnitudePips:
          Math.round(
            Math.abs(candle.close - refLow.price) * pipMultiplier * 100
          ) / 100,
        isDisplacement,
        isCounterTrend: false,
      };

      events.push(event);
      lastBearishBOS = event;
    }
  }

  // Second pass: detect reclaims
  detectReclaims(candles, events);

  return events;
}

/**
 * Second pass: check if any active BOS gets reclaimed.
 *
 * A BOS is reclaimed when price closes its body back beyond the broken level
 * in the opposite direction.
 */
function detectReclaims(candles: Candle[], events: BOSEvent[]): void {
  for (const event of events) {
    if (event.status !== "active") continue;

    // Find the candle index of this BOS event
    const bosCandle = candles.findIndex(
      (c) => c.timestamp >= event.timestamp
    );
    if (bosCandle < 0) continue;

    // Check subsequent candles for a reclaim
    for (let i = bosCandle + 1; i < candles.length; i++) {
      const candle = candles[i];

      const reclaimed =
        (event.direction === "bearish" &&
          candle.close > event.brokenLevel) ||
        (event.direction === "bullish" &&
          candle.close < event.brokenLevel);

      if (reclaimed) {
        event.status = "reclaimed";
        event.reclaimedAt = candle.timestamp;
        event.reclaimedByClose = candle.close;
        event.timeTilReclaim = candle.timestamp - event.timestamp;
        break;
      }
    }
  }
}
