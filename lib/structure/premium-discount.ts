/**
 * Premium/Discount Zone Computation
 *
 * Three-tier dealing range analysis:
 * - Structural: H4/D1/W1 swing-to-swing ranges
 * - Yearly: YH/YL from key levels
 * - Macro: All-time range from ClickHouse
 *
 * Pure function — no database dependencies.
 */

import type {
  SwingPoint,
  KeyLevelGrid,
  PremiumDiscountContext,
  ZoneType,
} from "./types";

// --- Helpers ---

interface SwingRange {
  high: number;
  low: number;
}

/**
 * Extract dealing range from most recent swing high + swing low.
 */
function getSwingRange(swings: SwingPoint[]): SwingRange | null {
  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;

  // Scan from most recent backward
  for (let i = swings.length - 1; i >= 0; i--) {
    const s = swings[i];
    if (s.type === "high" && !lastHigh) lastHigh = s;
    if (s.type === "low" && !lastLow) lastLow = s;
    if (lastHigh && lastLow) break;
  }

  if (!lastHigh || !lastLow) return null;
  if (lastHigh.price <= lastLow.price) return null;

  return { high: lastHigh.price, low: lastLow.price };
}

/**
 * Compute zone, equilibrium, and depth for a given range.
 */
function computeZone(
  currentPrice: number,
  range: SwingRange
): { zone: ZoneType; equilibrium: number; depthPercent: number } {
  const equilibrium = (range.high + range.low) / 2;
  const zone: ZoneType = currentPrice >= equilibrium ? "premium" : "discount";

  // Depth: how far into the zone (0% = at equilibrium, 100% = at extreme)
  const halfRange = (range.high - range.low) / 2;
  let depthPercent = 0;

  if (halfRange > 0) {
    if (zone === "premium") {
      depthPercent = ((currentPrice - equilibrium) / halfRange) * 100;
    } else {
      depthPercent = ((equilibrium - currentPrice) / halfRange) * 100;
    }
    depthPercent = Math.max(0, Math.min(100, depthPercent));
  }

  return { zone, equilibrium, depthPercent };
}

// --- Main Computation ---

/**
 * Compute Premium/Discount context across all tiers.
 *
 * @param currentPrice - Current market price
 * @param h4Swings     - H4 swing points
 * @param d1Swings     - D1 swing points
 * @param w1Swings     - W1 swing points
 * @param keyLevels    - Key level grid (for YH/YL)
 * @param macroRange   - All-time range from ClickHouse (optional)
 */
export function computePremiumDiscount(
  currentPrice: number,
  h4Swings: SwingPoint[],
  d1Swings: SwingPoint[],
  w1Swings: SwingPoint[],
  keyLevels: KeyLevelGrid,
  macroRange?: { high: number; low: number } | null
): PremiumDiscountContext | null {
  // Need at least H4 range
  const h4Range = getSwingRange(h4Swings);
  if (!h4Range) return null;

  // D1 and W1 ranges (fallback to H4 if unavailable)
  const d1Range = getSwingRange(d1Swings) || h4Range;
  const w1Range = getSwingRange(w1Swings) || d1Range;

  // Yearly range from key levels
  const yearlyRange: SwingRange =
    keyLevels.yh != null && keyLevels.yl != null && keyLevels.yh > keyLevels.yl
      ? { high: keyLevels.yh, low: keyLevels.yl }
      : w1Range;

  // Macro range: prefer ClickHouse, fallback to yearly
  const effectiveMacroRange: SwingRange =
    macroRange && macroRange.high > macroRange.low
      ? macroRange
      : yearlyRange;

  // Compute each tier
  const h4 = computeZone(currentPrice, h4Range);
  const d1 = computeZone(currentPrice, d1Range);
  const w1 = computeZone(currentPrice, w1Range);
  const yearly = computeZone(currentPrice, yearlyRange);
  const macro = computeZone(currentPrice, effectiveMacroRange);

  // Alignment: how many tiers agree on the same zone
  const zones = [h4.zone, d1.zone, w1.zone, yearly.zone, macro.zone];
  const premiumCount = zones.filter((z) => z === "premium").length;
  const discountCount = zones.filter((z) => z === "discount").length;
  const alignmentCount = Math.max(premiumCount, discountCount);

  // Deep premium/discount: depth > 75% on 2+ tiers
  const depths = [
    { zone: h4.zone, depth: h4.depthPercent },
    { zone: d1.zone, depth: d1.depthPercent },
    { zone: w1.zone, depth: w1.depthPercent },
    { zone: yearly.zone, depth: yearly.depthPercent },
    { zone: macro.zone, depth: macro.depthPercent },
  ];

  const deepPremiumCount = depths.filter(
    (d) => d.zone === "premium" && d.depth > 75
  ).length;
  const deepDiscountCount = depths.filter(
    (d) => d.zone === "discount" && d.depth > 75
  ).length;

  return {
    h4Zone: h4.zone,
    h4Equilibrium: h4.equilibrium,
    h4SwingRange: h4Range,
    h4DepthPercent: h4.depthPercent,
    d1Zone: d1.zone,
    d1Equilibrium: d1.equilibrium,
    d1SwingRange: d1Range,
    d1DepthPercent: d1.depthPercent,
    w1Zone: w1.zone,
    w1Equilibrium: w1.equilibrium,
    w1SwingRange: w1Range,
    w1DepthPercent: w1.depthPercent,
    yearlyZone: yearly.zone,
    yearlyEquilibrium: yearly.equilibrium,
    yearlyRange,
    macroZone: macro.zone,
    macroEquilibrium: macro.equilibrium,
    macroRange: effectiveMacroRange,
    alignmentCount,
    isDeepPremium: deepPremiumCount >= 2,
    isDeepDiscount: deepDiscountCount >= 2,
  };
}
