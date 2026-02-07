/**
 * Structure Link Builder
 *
 * Pure function that takes structure data + trade context and returns
 * link candidates for auto-linking on trade entry.
 */

import type { StructureResponse } from "./types";

export interface StructureLinkCandidate {
  entityType: "bos" | "fvg" | "key_level" | "sweep";
  entityId: string;
  role: "entry_reason" | "exit_target" | "invalidation" | "confluence";
}

/**
 * Compute structure links for a trade based on current structure data.
 *
 * Logic:
 * 1. BOS — Most recent active BOS matching trade direction → entry_reason
 * 2. FVGs — Active FVGs overlapping entry price → entry_reason or confluence
 * 3. Key levels — Near SL → invalidation, near TP → exit_target
 * 4. Sweeps — Recent sweeps in trade direction → confluence
 */
export function computeStructureLinks(
  structureData: StructureResponse,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  direction: "LONG" | "SHORT",
  pair: string,
  timeframe: string
): StructureLinkCandidate[] {
  const links: StructureLinkCandidate[] = [];
  const pipMultiplier = pair.includes("JPY") ? 100 : 10000;
  const bosDirection = direction === "LONG" ? "bullish" : "bearish";

  // 1. Most recent active BOS matching trade direction
  const matchingBOS = structureData.bosEvents
    .filter((b) => b.status === "active" && b.direction === bosDirection)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (matchingBOS.length > 0) {
    const bos = matchingBOS[0];
    links.push({
      entityType: "bos",
      entityId: `${pair}-${timeframe}-${bos.timestamp}`,
      role: "entry_reason",
    });
  }

  // 2. Active FVGs overlapping or near entry price
  const activeFVGs = structureData.fvgEvents.filter(
    (f) => f.status === "fresh" || f.status === "partial"
  );

  for (const fvg of activeFVGs) {
    const overlapsEntry =
      entryPrice >= fvg.bottomPrice && entryPrice <= fvg.topPrice;
    const distancePips =
      Math.min(
        Math.abs(entryPrice - fvg.topPrice),
        Math.abs(entryPrice - fvg.bottomPrice)
      ) * pipMultiplier;

    if (overlapsEntry) {
      links.push({
        entityType: "fvg",
        entityId: fvg.id,
        role: "entry_reason",
      });
    } else if (distancePips <= 20) {
      links.push({
        entityType: "fvg",
        entityId: fvg.id,
        role: "confluence",
      });
    }
  }

  // 3. Key levels near SL (invalidation) and TP (exit_target)
  for (const level of structureData.keyLevelEntries) {
    const distToSL = Math.abs(level.price - stopLoss) * pipMultiplier;
    const distToTP = Math.abs(level.price - takeProfit) * pipMultiplier;

    // Proximity threshold scales with level significance
    const threshold = level.significance >= 4 ? 40 : level.significance >= 3 ? 25 : 15;

    if (distToSL <= threshold) {
      links.push({
        entityType: "key_level",
        entityId: `${pair}-${level.label}-${level.price}`,
        role: "invalidation",
      });
    }

    if (distToTP <= threshold) {
      links.push({
        entityType: "key_level",
        entityId: `${pair}-${level.label}-${level.price}`,
        role: "exit_target",
      });
    }
  }

  // 4. Recent sweeps in trade direction
  const recentSweeps = structureData.sweepEvents
    .filter((s) => s.direction === bosDirection)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  for (const sweep of recentSweeps) {
    links.push({
      entityType: "sweep",
      entityId: `${pair}-${timeframe}-sweep-${sweep.timestamp}`,
      role: "confluence",
    });
  }

  return links;
}
