/**
 * Snapshot AI Description Generator
 *
 * Generates natural language descriptions of trade snapshots for Claude analysis.
 * Extends the existing lib/drawings/describe.ts patterns with trade-specific context.
 */

import { Drawing } from "@/lib/drawings/types";
import { describeAllDrawings, extractKeyLevels } from "@/lib/drawings/describe";

export interface SnapshotTradeContext {
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  direction: "LONG" | "SHORT";
  pnlPips: number;
  distanceToTP: number;
  distanceToSL: number;
}

/**
 * Generate a comprehensive AI-readable description of a trade snapshot.
 * Pre-computed at capture time and stored in the snapshot for instant retrieval.
 */
export function generateSnapshotDescription(
  drawings: Drawing[],
  currentPrice: number,
  tradeContext: SnapshotTradeContext,
  momentLabel: string,
  pair?: string,
  timeframe?: string,
  structureContext?: {
    mtfScore: { composite: number; interpretation: string } | null;
    currentStructure: { direction: string; swingSequence: string[] };
    activeFVGs: { direction: string; topPrice: number; bottomPrice: number; tier: number; fillPercent: number }[];
    recentBOS: { direction: string; brokenLevel: number; timestamp: number; status: string; magnitudePips: number }[];
    premiumDiscount: { h4Zone: string; d1Zone: string; alignmentCount: number; isDeepPremium: boolean; isDeepDiscount: boolean } | null;
    keyLevels: { label: string; price: number }[];
  }
): string {
  const lines: string[] = [];

  // Header
  lines.push(`=== Trade Snapshot: ${momentLabel.toUpperCase()} ===`);

  // Trade context
  const pairLabel = pair || "Unknown";
  const tfLabel = timeframe || "";
  lines.push(
    `${pairLabel} ${tfLabel} ${tradeContext.direction} | Entry: ${formatPrice(tradeContext.entryPrice, pairLabel)}, SL: ${formatPrice(tradeContext.stopLoss, pairLabel)}, TP: ${formatPrice(tradeContext.takeProfit, pairLabel)}`
  );

  // Position status
  const pnlSign = tradeContext.pnlPips >= 0 ? "+" : "";
  lines.push(
    `Current: ${formatPrice(tradeContext.currentPrice, pairLabel)} | P&L: ${pnlSign}${tradeContext.pnlPips.toFixed(1)} pips | TP: ${tradeContext.distanceToTP.toFixed(1)} pips away | SL: ${tradeContext.distanceToSL.toFixed(1)} pips away`
  );

  // Drawing context
  if (drawings.length > 0) {
    lines.push("");
    lines.push(describeAllDrawings(drawings, currentPrice));
  } else {
    lines.push("");
    lines.push("No drawings captured in this snapshot.");
  }

  // Key levels
  const keyLevels = extractKeyLevels(drawings, currentPrice);
  if (keyLevels.length > 0) {
    lines.push("");
    lines.push("Key Levels:");
    keyLevels.slice(0, 10).forEach((level) => {
      const distance = Math.abs(level.price - currentPrice);
      const pipMultiplier = pairLabel.includes("JPY") ? 100 : 10000;
      const distancePips = (distance * pipMultiplier).toFixed(1);
      const direction = level.price > currentPrice ? "above" : "below";
      lines.push(
        `  ${formatPrice(level.price, pairLabel)} - ${level.description} (${distancePips} pips ${direction})`
      );
    });
  }

  // Structure context (from market structure engine)
  if (structureContext) {
    lines.push("");
    lines.push("Structure Context:");

    if (structureContext.mtfScore) {
      lines.push(
        `  MTF Score: ${structureContext.mtfScore.composite > 0 ? "+" : ""}${structureContext.mtfScore.composite} (${structureContext.mtfScore.interpretation})`
      );
    }

    if (structureContext.currentStructure) {
      const seq = structureContext.currentStructure.swingSequence.join(", ");
      lines.push(
        `  Trend: ${structureContext.currentStructure.direction} (${seq})`
      );
    }

    if (structureContext.premiumDiscount) {
      const pd = structureContext.premiumDiscount;
      lines.push(
        `  Zone: ${pd.h4Zone} (H4), ${pd.d1Zone} (D1), ${pd.alignmentCount}/5 tiers aligned${pd.isDeepPremium ? " [DEEP PREMIUM]" : ""}${pd.isDeepDiscount ? " [DEEP DISCOUNT]" : ""}`
      );
    }

    if (structureContext.activeFVGs.length > 0) {
      const bullish = structureContext.activeFVGs.filter((f) => f.direction === "bullish").length;
      const bearish = structureContext.activeFVGs.filter((f) => f.direction === "bearish").length;
      lines.push(`  Active FVGs: ${bullish} bullish, ${bearish} bearish`);
    }

    if (structureContext.recentBOS.length > 0) {
      const last = structureContext.recentBOS[0];
      lines.push(
        `  Last BOS: ${last.direction} at ${formatPrice(last.brokenLevel, pairLabel)}, ${last.magnitudePips.toFixed(0)} pips magnitude`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Format price with appropriate precision
 */
function formatPrice(price: number, pair: string): string {
  const precision = pair.includes("JPY") ? 3 : 5;
  return price.toFixed(precision);
}

/**
 * Compute trade context metrics from raw trade data
 */
export function computeTradeContext(
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  currentPrice: number,
  direction: "LONG" | "SHORT",
  pair: string
): SnapshotTradeContext {
  const pipMultiplier = pair.includes("JPY") ? 100 : 10000;
  const isLong = direction === "LONG";

  const pnlPips = isLong
    ? (currentPrice - entryPrice) * pipMultiplier
    : (entryPrice - currentPrice) * pipMultiplier;

  const distanceToTP = isLong
    ? (takeProfit - currentPrice) * pipMultiplier
    : (currentPrice - takeProfit) * pipMultiplier;

  const distanceToSL = isLong
    ? (currentPrice - stopLoss) * pipMultiplier
    : (stopLoss - currentPrice) * pipMultiplier;

  return {
    entryPrice,
    stopLoss,
    takeProfit,
    currentPrice,
    direction,
    pnlPips: Math.round(pnlPips * 100) / 100,
    distanceToTP: Math.round(distanceToTP * 100) / 100,
    distanceToSL: Math.round(distanceToSL * 100) / 100,
  };
}
