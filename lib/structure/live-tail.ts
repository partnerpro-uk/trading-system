/**
 * Live Tail — Lightweight Structure Computation
 *
 * Computes structure for the most recent candles that haven't been
 * confirmed in the database yet. Used to fill the gap between the
 * last worker-computed structure and the current moment.
 *
 * Only runs steps 1-6 of the full pipeline:
 *   1. Swing detection + zigzag
 *   2. Swing labeling
 *   3. BOS detection
 *   4. Sweep detection
 *   5. FVG detection + fill tracking
 */

import type { Candle, SwingPoint, BOSEvent, SweepEvent, FVGEvent } from "./types";
import { detectFilteredSwings, labelSwings, detectBOS, detectSweeps, detectFVGs, trackFVGFills } from "./index";
import { LOOKBACK_MAP } from "./swings";

export interface LiveTailResult {
  swings: SwingPoint[];
  bosEvents: BOSEvent[];
  sweepEvents: SweepEvent[];
  fvgEvents: FVGEvent[];
}

/**
 * Compute structure for the trailing edge of candle data.
 *
 * @param candles - Recent candles (at least 3 * LOOKBACK for the timeframe)
 * @param timeframe - Chart timeframe
 * @param pair - Currency pair
 * @returns Structure entities from the live tail
 */
export function computeLiveTail(
  candles: Candle[],
  timeframe: string,
  pair: string
): LiveTailResult {
  if (candles.length < 20) {
    return { swings: [], bosEvents: [], sweepEvents: [], fvgEvents: [] };
  }

  // 1-2. Detect swings with zigzag + label
  const rawSwings = detectFilteredSwings(candles, timeframe);
  const swings = labelSwings(rawSwings, candles);

  // 3. Detect BOS events
  const bosEvents = detectBOS(candles, swings, pair);

  // 4. Detect sweep events
  const sweepEvents = detectSweeps(candles, swings, bosEvents, pair);

  // 5. Detect FVGs + track fills
  let fvgEvents = detectFVGs(candles, bosEvents, pair, timeframe);
  fvgEvents = trackFVGFills(fvgEvents, candles, pair, timeframe);

  return { swings, bosEvents, sweepEvents, fvgEvents };
}

/**
 * How many candles to fetch for the live tail.
 * 3× the lookback ensures we have enough context for swing detection
 * at the trailing edge while overlapping with confirmed DB data.
 */
export function getLiveTailDepth(timeframe: string): number {
  const lookback = LOOKBACK_MAP[timeframe] || 5;
  return lookback * 3;
}
