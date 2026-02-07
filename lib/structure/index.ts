/**
 * Market Structure Detection — Orchestrator
 *
 * Main entry point for computing market structure.
 * Calls all sub-modules and assembles the StructureResponse.
 *
 * Pure functions only — no database dependencies.
 */

import type {
  Candle,
  StructureResponse,
  CurrentStructure,
  TrendDirection,
  SwingPoint,
  BOSEvent,
  FVGEvent,
  MTFScore,
  StructureLabel,
} from "./types";
import { detectSwings, LOOKBACK_MAP, REQUIRED_DEPTH } from "./swings";
import { enforceZigzag } from "./zigzag";
import { labelSwings } from "./labeling";
import { detectBOS } from "./bos";
import { detectSweeps } from "./sweeps";
import { computeKeyLevels, keyLevelGridToEntries } from "./key-levels";
import { detectFVGs, trackFVGFills, computeFVGNesting } from "./fvg";
import { computePremiumDiscount } from "./premium-discount";
import { markCounterTrend } from "./counter-trend";
import { computeMTFScore } from "./mtf-scoring";
import { enrichBOSEvents } from "./bos-enrichment";

// Re-export sub-modules for direct access
export { detectSwings, LOOKBACK_MAP, REQUIRED_DEPTH } from "./swings";
export { enforceZigzag } from "./zigzag";
export { labelSwings } from "./labeling";
export { detectBOS } from "./bos";
export { detectSweeps } from "./sweeps";
export { computeKeyLevels, keyLevelGridToEntries } from "./key-levels";
export { detectFVGs, trackFVGFills, computeFVGNesting } from "./fvg";
export { computePremiumDiscount } from "./premium-discount";
export { markCounterTrend } from "./counter-trend";
export { computeMTFScore, computeTFDirection } from "./mtf-scoring";
export { enrichBOSEvents } from "./bos-enrichment";

// Re-export types
export type * from "./types";

/** Detect swings with zigzag filtering (convenience wrapper). */
export function detectFilteredSwings(candles: Candle[], timeframe: string): SwingPoint[] {
  return enforceZigzag(detectSwings(candles, timeframe));
}

/**
 * Derive the current structure state from swings and BOS events.
 */
export function deriveCurrentStructure(
  swings: SwingPoint[],
  bosEvents: BOSEvent[]
): CurrentStructure {
  // Get the last active BOS event (not reclaimed)
  const activeBOS = bosEvents.filter((e) => e.status === "active");
  const lastBOS = activeBOS.length > 0 ? activeBOS[activeBOS.length - 1] : null;

  // Get the last 8 labeled swings for sequence display
  const swingSequence: StructureLabel[] = swings
    .filter((s) => s.label !== null)
    .slice(-8)
    .map((s) => s.label!);

  // Determine direction from the last active BOS
  let direction: TrendDirection = "ranging";
  if (lastBOS) {
    direction = lastBOS.direction;
  } else if (swingSequence.length >= 4) {
    // No active BOS — infer from swing sequence
    const recent = swingSequence.slice(-4);
    const bullishCount = recent.filter(
      (l) => l === "HH" || l === "HL"
    ).length;
    const bearishCount = recent.filter(
      (l) => l === "LH" || l === "LL"
    ).length;

    if (bullishCount >= 3) direction = "bullish";
    else if (bearishCount >= 3) direction = "bearish";
  }

  return { direction, lastBOS, swingSequence };
}

export interface ComputeStructureOptions {
  h4Swings?: SwingPoint[];
  d1Swings?: SwingPoint[];
  w1Swings?: SwingPoint[];
  currentPrice?: number;
  macroRange?: { high: number; low: number } | null;
  higherTFFVGs?: FVGEvent[];
  // Phase 3: HTF structures for counter-trend + MTF scoring + enrichment
  htfStructures?: Record<string, CurrentStructure>;
  cotData?: { direction: string; percentile: number } | null;
  upcomingEvents?: { name: string; impact: string; timestamp: number }[];
  enableEnrichment?: boolean;
}

/**
 * Compute full market structure for a pair/timeframe.
 *
 * @param pair        - Currency pair (e.g., "EUR_USD")
 * @param timeframe   - Chart timeframe (e.g., "H4")
 * @param candles     - Candle data for the requested timeframe
 * @param dailyCandles  - Daily candles for key level computation
 * @param weeklyCandles - Weekly candles for key level computation
 * @param monthlyCandles - Monthly candles for key level computation
 * @param options     - Optional: swing data for P/D, macro range, higher TF FVGs
 */
export function computeStructure(
  pair: string,
  timeframe: string,
  candles: Candle[],
  dailyCandles: Candle[],
  weeklyCandles: Candle[],
  monthlyCandles: Candle[],
  options?: ComputeStructureOptions
): StructureResponse {
  // 1. Detect raw swing points + zigzag filter (alternating H-L-H-L)
  const rawSwings = enforceZigzag(detectSwings(candles, timeframe));

  // 2. Label swings (HH/HL/LH/LL/EQH/EQL)
  const swings = labelSwings(rawSwings, candles);

  // 3. Detect BOS events (body-close confirmation)
  const bosEvents = detectBOS(candles, swings, pair);

  // 4. Detect sweep events (wick-through without body close)
  const sweepEvents = detectSweeps(candles, swings, bosEvents, pair);

  // 5. Compute key level grid
  const keyLevels = computeKeyLevels(pair, dailyCandles, weeklyCandles, monthlyCandles);
  const keyLevelEntries = keyLevelGridToEntries(keyLevels);

  // 6. Detect FVGs + track fills
  let fvgEvents = detectFVGs(candles, bosEvents, pair, timeframe);
  fvgEvents = trackFVGFills(fvgEvents, candles, pair, timeframe);

  // 7. Multi-TF FVG nesting (if higher TF FVGs provided)
  if (options?.higherTFFVGs) {
    computeFVGNesting(fvgEvents, options.higherTFFVGs);
  }

  // 8. Premium/Discount computation
  const currentPrice = options?.currentPrice ?? candles[candles.length - 1]?.close;
  const h4Swings = options?.h4Swings ?? (timeframe === "H4" ? swings : []);
  const d1Swings = options?.d1Swings ?? [];
  const w1Swings = options?.w1Swings ?? [];

  let premiumDiscount = null;
  if (currentPrice && h4Swings.length > 0) {
    premiumDiscount = computePremiumDiscount(
      currentPrice,
      h4Swings,
      d1Swings,
      w1Swings,
      keyLevels,
      options?.macroRange
    );
  }

  // 9. Derive current structure state
  const currentStructure = deriveCurrentStructure(swings, bosEvents);

  // 10. Mark counter-trend BOS events (if HTF structures provided)
  if (options?.htfStructures) {
    markCounterTrend(bosEvents, options.htfStructures, timeframe);
  }

  // 11. Compute MTF score (if HTF structures provided)
  let mtfScore: MTFScore | undefined;
  if (options?.htfStructures) {
    // Merge current TF's structure into the HTF map for scoring
    const allStructures = {
      ...options.htfStructures,
      [timeframe]: currentStructure,
    };
    mtfScore = computeMTFScore(allStructures);
  }

  // 12. BOS enrichment (if enabled)
  if (options?.enableEnrichment) {
    enrichBOSEvents(
      bosEvents,
      keyLevelEntries,
      timeframe,
      options.cotData,
      options.upcomingEvents,
      mtfScore
    );
  }

  return {
    pair,
    timeframe,
    computedAt: Date.now(),
    swings,
    bosEvents,
    sweepEvents,
    keyLevels,
    keyLevelEntries,
    currentStructure,
    fvgEvents,
    premiumDiscount,
    mtfScore,
  };
}
