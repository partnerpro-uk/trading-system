/**
 * Counter-Trend Marker — Pure Computation
 *
 * Marks BOS events that oppose the higher-timeframe trend direction.
 * Mutates bosEvents in-place (sets isCounterTrend = true).
 *
 * TF hierarchy: H1→H4, H4→D, D→W, W→M
 * Pure functions only — no database dependencies.
 */

import type { BOSEvent, CurrentStructure } from "./types";

/**
 * Map from a timeframe to its parent (higher) timeframe.
 * Supports common aliases (D1→W, W1→M, etc.)
 */
const PARENT_TF: Record<string, string> = {
  M15: "H1",
  M30: "H1",
  H1: "H4",
  H4: "D",
  D: "W",
  D1: "W",
  W: "M",
  W1: "M",
  M: "MN",
  MN: "MN", // Monthly has no parent — never counter-trend
};

/**
 * Normalize timeframe keys for lookup in htfStructures.
 * Tries the canonical form and common aliases.
 */
function findHTFStructure(
  htfStructures: Record<string, CurrentStructure>,
  parentTF: string
): CurrentStructure | null {
  // Direct lookup
  if (htfStructures[parentTF]) return htfStructures[parentTF];

  // Alias mapping for lookup
  const aliases: Record<string, string[]> = {
    D: ["D", "D1"],
    W: ["W", "W1"],
    M: ["M", "MN"],
    MN: ["MN", "M"],
    H4: ["H4"],
    H1: ["H1"],
  };

  const candidates = aliases[parentTF] || [parentTF];
  for (const alias of candidates) {
    if (htfStructures[alias]) return htfStructures[alias];
  }

  return null;
}

/**
 * Mark BOS events that oppose the higher-TF trend direction.
 *
 * Mutates bosEvents in-place. For each BOS:
 * - Look up the parent TF's CurrentStructure
 * - If parent direction is bullish and BOS is bearish → isCounterTrend = true
 * - If parent direction is bearish and BOS is bullish → isCounterTrend = true
 *
 * @param bosEvents - BOS events to mark (mutated in-place)
 * @param htfStructures - Map of timeframe → CurrentStructure
 * @param timeframe - The timeframe of the BOS events
 */
export function markCounterTrend(
  bosEvents: BOSEvent[],
  htfStructures: Record<string, CurrentStructure>,
  timeframe: string
): void {
  const parentTF = PARENT_TF[timeframe];
  if (!parentTF || parentTF === timeframe) return; // No parent or self-referencing

  const parentStructure = findHTFStructure(htfStructures, parentTF);
  if (!parentStructure || parentStructure.direction === "ranging") return;

  for (const bos of bosEvents) {
    if (bos.direction !== parentStructure.direction) {
      bos.isCounterTrend = true;
    }
  }
}
