/**
 * Snapshot Capture Logic
 *
 * Assembles a snapshot data object from the current chart state.
 * Used by both auto-capture (entry/exit) and manual capture (setup/during).
 */

import { Drawing } from "@/lib/drawings/types";
import { filterDrawingsForSnapshot } from "./filter-drawings";
import { generateSnapshotDescription, computeTradeContext } from "./describe";

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
  createdBy: "auto" | "manual";
}

/**
 * Build a snapshot data object ready for insertion into Convex.
 *
 * Steps:
 * 1. Filter drawings using the 3-criteria algorithm
 * 2. Compute trade context metrics (P&L, distance to TP/SL)
 * 3. Generate AI description
 * 4. Return serialized snapshot
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

  // 3. Generate AI description
  const aiDescription = generateSnapshotDescription(
    filteredDrawings,
    params.currentPrice,
    tradeContext,
    params.momentLabel,
    params.pair,
    params.timeframe
  );

  // 4. Determine if auto or manual
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
    createdBy,
  };
}
