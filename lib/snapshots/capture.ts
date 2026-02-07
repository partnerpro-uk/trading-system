/**
 * Snapshot Capture Logic
 *
 * Assembles a snapshot data object from the current chart state.
 * Used by both auto-capture (entry/exit) and manual capture (setup/during).
 */

import { Drawing } from "@/lib/drawings/types";
import { filterDrawingsForSnapshot } from "./filter-drawings";
import { generateSnapshotDescription, computeTradeContext } from "./describe";
import type { StructureResponse } from "@/lib/structure/types";

export type MomentLabel = "setup" | "entry" | "during" | "exit";

export interface CaptureSnapshotParams {
  tradeId: string;
  momentLabel: MomentLabel;
  pair: string;
  timeframe: string;
  visibleRange: { from: number; to: number };
  currentPrice: number;
  allDrawings: Drawing[];
  trade: {
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    direction: "LONG" | "SHORT";
    entryTime: number;
    createdAt: number;
    strategyId?: string;
  };
  notes?: string;
  structureData?: StructureResponse | null;
}

export interface SnapshotInsertData {
  tradeId: string;
  momentLabel: MomentLabel;
  pair: string;
  timeframe: string;
  timestamp: number;
  visibleRange: { from: number; to: number };
  drawings: string;
  tradeContext: string;
  strategy?: string;
  analysisNotes?: string;
  aiDescription: string;
  structureContext?: string;
  createdBy: "auto" | "manual";
}

/**
 * Extract a compact structure context from StructureResponse for snapshot storage.
 */
function extractStructureContext(
  sd: StructureResponse,
  entryPrice: number
): string {
  const pipMultiplier = sd.pair.includes("JPY") ? 100 : 10000;

  const activeFVGs = sd.fvgEvents
    .filter((f) => f.status === "fresh" || f.status === "partial")
    .map((f) => ({
      direction: f.direction,
      topPrice: f.topPrice,
      bottomPrice: f.bottomPrice,
      tier: f.tier,
      fillPercent: f.fillPercent,
    }))
    .sort((a, b) => {
      const distA = Math.min(
        Math.abs(entryPrice - a.topPrice),
        Math.abs(entryPrice - a.bottomPrice)
      );
      const distB = Math.min(
        Math.abs(entryPrice - b.topPrice),
        Math.abs(entryPrice - b.bottomPrice)
      );
      return distA - distB;
    })
    .slice(0, 5);

  const recentBOS = sd.bosEvents
    .filter((b) => b.status === "active")
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3)
    .map((b) => ({
      direction: b.direction,
      brokenLevel: b.brokenLevel,
      timestamp: b.timestamp,
      status: b.status,
      magnitudePips: b.magnitudePips,
    }));

  const context = {
    mtfScore: sd.mtfScore
      ? { composite: sd.mtfScore.composite, interpretation: sd.mtfScore.interpretation }
      : null,
    currentStructure: {
      direction: sd.currentStructure.direction,
      swingSequence: sd.currentStructure.swingSequence.slice(-5),
    },
    activeFVGs,
    recentBOS,
    premiumDiscount: sd.premiumDiscount
      ? {
          h4Zone: sd.premiumDiscount.h4Zone,
          d1Zone: sd.premiumDiscount.d1Zone,
          alignmentCount: sd.premiumDiscount.alignmentCount,
          isDeepPremium: sd.premiumDiscount.isDeepPremium,
          isDeepDiscount: sd.premiumDiscount.isDeepDiscount,
        }
      : null,
    keyLevels: sd.keyLevelEntries.map((l) => ({
      label: l.label,
      price: l.price,
    })),
  };

  return JSON.stringify(context);
}

/**
 * Build a snapshot data object ready for insertion into Convex.
 *
 * Steps:
 * 1. Filter drawings using the 3-criteria algorithm
 * 2. Compute trade context metrics (P&L, distance to TP/SL)
 * 3. Extract structure context (if available)
 * 4. Generate AI description
 * 5. Return serialized snapshot
 */
export function buildSnapshotData(params: CaptureSnapshotParams): SnapshotInsertData {
  const now = Date.now();

  // 1. Filter drawings for this snapshot
  const filteredDrawings = filterDrawingsForSnapshot(
    params.allDrawings,
    params.tradeId,
    params.trade.createdAt,
    now,
    params.visibleRange
  );

  // 2. Compute trade context
  const tradeContext = computeTradeContext(
    params.trade.entryPrice,
    params.trade.stopLoss,
    params.trade.takeProfit,
    params.currentPrice,
    params.trade.direction,
    params.pair
  );

  // 3. Extract structure context
  const structureContext = params.structureData
    ? extractStructureContext(params.structureData, params.currentPrice)
    : undefined;

  // Parse structure context for AI description
  const parsedStructureContext = structureContext
    ? JSON.parse(structureContext)
    : undefined;

  // 4. Generate AI description (now with structure context)
  const aiDescription = generateSnapshotDescription(
    filteredDrawings,
    params.currentPrice,
    tradeContext,
    params.momentLabel,
    params.pair,
    params.timeframe,
    parsedStructureContext
  );

  // 5. Determine if auto or manual
  const createdBy: "auto" | "manual" =
    params.momentLabel === "entry" || params.momentLabel === "exit" ? "auto" : "manual";

  return {
    tradeId: params.tradeId,
    momentLabel: params.momentLabel,
    pair: params.pair,
    timeframe: params.timeframe,
    timestamp: now,
    visibleRange: params.visibleRange,
    drawings: JSON.stringify(filteredDrawings),
    tradeContext: JSON.stringify(tradeContext),
    strategy: params.trade.strategyId,
    analysisNotes: params.notes,
    aiDescription,
    structureContext,
    createdBy,
  };
}
