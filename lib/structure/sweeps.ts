/**
 * Sweep Detection
 *
 * A sweep occurs when price wicks through a level but the body does NOT
 * close beyond it. This is the opposite of a BOS — the level was tested
 * but not broken. Sweeps are often liquidity grabs (institutional stop hunts).
 */

import type { Candle, SwingPoint, BOSEvent, SweepEvent, SweptLevelType } from "./types";

/**
 * Determine the swept level type from a swing point's label.
 */
function getSweptLevelType(swing: SwingPoint): SweptLevelType {
  if (swing.label === "EQH") return "eqh";
  if (swing.label === "EQL") return "eql";
  return swing.type === "high" ? "swing_high" : "swing_low";
}

/**
 * Check if a BOS event occurs within `windowSize` candles after a given candle index.
 */
function hasBOSWithinWindow(
  bosEvents: BOSEvent[],
  afterTimestamp: number,
  candles: Candle[],
  windowSize: number
): boolean {
  // Find the candle index for the sweep
  const sweepIdx = candles.findIndex((c) => c.timestamp >= afterTimestamp);
  if (sweepIdx < 0) return false;

  const windowEnd =
    sweepIdx + windowSize < candles.length
      ? candles[sweepIdx + windowSize].timestamp
      : Infinity;

  return bosEvents.some(
    (bos) => bos.timestamp > afterTimestamp && bos.timestamp <= windowEnd
  );
}

/**
 * Detect sweep events.
 *
 * For each swing point, check subsequent candles for:
 * - Bearish sweep of a swing low: candle.low < swingLow BUT candle.close > swingLow
 * - Bullish sweep of a swing high: candle.high > swingHigh BUT candle.close < swingHigh
 *
 * Each swing can only be swept once (first sweep wins).
 */
export function detectSweeps(
  candles: Candle[],
  swings: SwingPoint[],
  bosEvents: BOSEvent[],
  pair: string
): SweepEvent[] {
  const events: SweepEvent[] = [];
  const sweptSwings = new Set<number>(); // track by swing timestamp

  for (const swing of swings) {
    if (sweptSwings.has(swing.timestamp)) continue;

    // Check candles after this swing formed
    for (let i = swing.candleIndex + 1; i < candles.length; i++) {
      const candle = candles[i];

      if (swing.type === "low") {
        // Bearish sweep: wick goes below the swing low but body closes above
        if (candle.low < swing.price && candle.close > swing.price) {
          events.push({
            timestamp: candle.timestamp,
            direction: "bearish",
            sweptLevel: swing.price,
            wickExtreme: candle.low,
            sweptLevelType: getSweptLevelType(swing),
            followedByBOS: hasBOSWithinWindow(
              bosEvents,
              candle.timestamp,
              candles,
              10
            ),
          });
          sweptSwings.add(swing.timestamp);
          break; // only count first sweep of this level
        }

        // If body closes below, it's a BOS not a sweep — stop checking this swing
        if (candle.close < swing.price) {
          break;
        }
      } else {
        // Bullish sweep: wick goes above the swing high but body closes below
        if (candle.high > swing.price && candle.close < swing.price) {
          events.push({
            timestamp: candle.timestamp,
            direction: "bullish",
            sweptLevel: swing.price,
            wickExtreme: candle.high,
            sweptLevelType: getSweptLevelType(swing),
            followedByBOS: hasBOSWithinWindow(
              bosEvents,
              candle.timestamp,
              candles,
              10
            ),
          });
          sweptSwings.add(swing.timestamp);
          break;
        }

        // If body closes above, it's a BOS — stop checking
        if (candle.close > swing.price) {
          break;
        }
      }
    }
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  return events;
}
