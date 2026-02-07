/**
 * MTF (Multi-Timeframe) Scoring — Pure Computation
 *
 * Computes a composite direction score from -100 to +100
 * based on weighted per-TF structure analysis.
 *
 * Weights: Monthly=4, Weekly=3, Daily=2, H4=1, H1=0.5
 * Pure functions only — no database dependencies.
 */

import type { CurrentStructure, MTFScore, MTFDirectionEntry } from "./types";

// TF weights (sum = 10.5)
const TF_WEIGHTS: Record<string, number> = {
  MN: 4,
  M: 4,
  W1: 3,
  W: 3,
  D1: 2,
  D: 2,
  H4: 1,
  H1: 0.5,
};

const MAX_WEIGHT_SUM = 10.5;

/**
 * Compute the direction score for a single timeframe's structure.
 *
 * Returns a value from -1.0 to +1.0:
 *  +1.0 = lastBOS is bullish + swing sequence has HH/HL
 *  +0.5 = swing sequence has HH/HL but no recent bullish BOS
 *   0.0 = ranging / no clear pattern
 *  -0.5 = swing sequence has LH/LL but no recent bearish BOS
 *  -1.0 = lastBOS is bearish + swing sequence has LH/LL
 */
export function computeTFDirection(structure: CurrentStructure): {
  direction: number;
  reasoning: string;
} {
  const { direction, lastBOS, swingSequence } = structure;

  // Analyze swing sequence for bullish/bearish lean
  const recent = swingSequence.slice(-6);
  const bullishLabels = recent.filter((l) => l === "HH" || l === "HL").length;
  const bearishLabels = recent.filter((l) => l === "LH" || l === "LL").length;
  const hasBullishSwings = bullishLabels >= 2;
  const hasBearishSwings = bearishLabels >= 2;

  const bosDirection = lastBOS?.status === "active" ? lastBOS.direction : null;

  // Strong bullish: active bullish BOS + bullish swing pattern
  if (bosDirection === "bullish" && hasBullishSwings) {
    return {
      direction: 1.0,
      reasoning: `Active bullish BOS + HH/HL structure (${bullishLabels}/${recent.length} bullish labels)`,
    };
  }

  // Strong bearish: active bearish BOS + bearish swing pattern
  if (bosDirection === "bearish" && hasBearishSwings) {
    return {
      direction: -1.0,
      reasoning: `Active bearish BOS + LH/LL structure (${bearishLabels}/${recent.length} bearish labels)`,
    };
  }

  // Moderate bullish: swing pattern without confirming BOS
  if (hasBullishSwings && !hasBearishSwings) {
    return {
      direction: 0.5,
      reasoning: `HH/HL swing sequence without active bullish BOS`,
    };
  }

  // Moderate bearish: swing pattern without confirming BOS
  if (hasBearishSwings && !hasBullishSwings) {
    return {
      direction: -0.5,
      reasoning: `LH/LL swing sequence without active bearish BOS`,
    };
  }

  // BOS but mixed swings
  if (bosDirection === "bullish") {
    return {
      direction: 0.5,
      reasoning: `Active bullish BOS but mixed swing sequence`,
    };
  }
  if (bosDirection === "bearish") {
    return {
      direction: -0.5,
      reasoning: `Active bearish BOS but mixed swing sequence`,
    };
  }

  // Use overall direction as fallback
  if (direction === "bullish") {
    return { direction: 0.3, reasoning: "Bullish trend inferred from swing sequence" };
  }
  if (direction === "bearish") {
    return { direction: -0.3, reasoning: "Bearish trend inferred from swing sequence" };
  }

  return { direction: 0, reasoning: "No clear directional bias (ranging)" };
}

/**
 * Get the interpretation string for a composite score.
 */
function getInterpretation(composite: number): string {
  const abs = Math.abs(composite);
  const dir = composite >= 0 ? "bullish" : "bearish";

  if (abs >= 70) return `Strong ${dir} alignment`;
  if (abs >= 30) return `Moderate ${dir}`;
  return "Mixed/ranging";
}

/**
 * Normalize a timeframe string to canonical form for weight lookup.
 */
function normalizeTF(tf: string): string {
  const upper = tf.toUpperCase();
  // Handle aliases
  if (upper === "D1") return "D";
  if (upper === "W1") return "W";
  return upper;
}

/**
 * Compute MTF composite score from multiple timeframe structures.
 *
 * @param structures - Map of timeframe → CurrentStructure (e.g. { D: {...}, W: {...}, MN: {...} })
 * @returns MTFScore with composite -100 to +100 and per-TF breakdown
 */
export function computeMTFScore(
  structures: Record<string, CurrentStructure>
): MTFScore {
  const entries: MTFDirectionEntry[] = [];
  let rawScore = 0;
  let usedWeightSum = 0;

  for (const [tf, structure] of Object.entries(structures)) {
    const normalizedTF = normalizeTF(tf);
    const weight = TF_WEIGHTS[normalizedTF];
    if (weight === undefined) continue;

    const { direction, reasoning } = computeTFDirection(structure);

    entries.push({
      timeframe: tf,
      weight,
      direction,
      reasoning,
    });

    rawScore += direction * weight;
    usedWeightSum += weight;
  }

  // Normalize to -100..+100 using actual weights present
  const effectiveMax = usedWeightSum > 0 ? usedWeightSum : MAX_WEIGHT_SUM;
  const composite = usedWeightSum > 0
    ? (rawScore / effectiveMax) * 100
    : 0;

  // Clamp to -100..+100
  const clamped = Math.max(-100, Math.min(100, Math.round(composite)));

  return {
    composite: clamped,
    rawScore,
    maxScore: MAX_WEIGHT_SUM,
    entries,
    interpretation: getInterpretation(clamped),
    computedAt: Date.now(),
  };
}
