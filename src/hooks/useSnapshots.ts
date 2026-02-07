"use client";

import { useCallback, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useDrawingStore } from "@/lib/drawings/store";
import { buildSnapshotData, MomentLabel } from "@/lib/snapshots/capture";
import type { StructureResponse } from "@/lib/structure/types";

/**
 * Hook for fetching snapshots for a specific trade
 */
export function useSnapshots(tradeId: Id<"trades"> | null) {
  const snapshots = useQuery(
    api.snapshots.getSnapshotsByTrade,
    tradeId ? { tradeId } : "skip"
  );

  const deleteSnapshotMutation = useMutation(api.snapshots.deleteSnapshot);
  const updateSnapshotMutation = useMutation(api.snapshots.updateSnapshot);

  return {
    snapshots,
    isLoading: snapshots === undefined,
    deleteSnapshot: deleteSnapshotMutation,
    updateSnapshot: updateSnapshotMutation,
  };
}

/**
 * Hook for capturing snapshots from the chart.
 * Returns a `capture` function that builds and persists a snapshot.
 *
 * Requires a ref to the current visible range, updated by the Chart component.
 */
export function useCaptureSnapshot(
  pair: string,
  timeframe: string,
  visibleRangeRef: React.RefObject<{ from: number; to: number } | null>,
  structureDataRef?: React.RefObject<StructureResponse | null>
) {
  const createSnapshot = useMutation(api.snapshots.createSnapshot);
  const drawingsKeyRef = useRef(`${pair}:${timeframe}`);
  drawingsKeyRef.current = `${pair}:${timeframe}`;

  const capture = useCallback(
    async (params: {
      tradeId: string;
      momentLabel: MomentLabel;
      currentPrice: number;
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
    }) => {
      const visibleRange = visibleRangeRef.current;
      if (!visibleRange) {
        console.warn("Cannot capture snapshot: no visible range available");
        return null;
      }

      // Get all drawings for this chart from the store
      const allDrawings =
        useDrawingStore.getState().drawings[drawingsKeyRef.current] || [];

      // Build the snapshot data (include structure context if available)
      const snapshotData = buildSnapshotData({
        ...params,
        pair,
        timeframe,
        visibleRange,
        allDrawings,
        structureData: structureDataRef?.current ?? null,
      });

      try {
        const snapshotId = await createSnapshot({
          ...snapshotData,
          tradeId: params.tradeId as Id<"trades">,
        });
        return snapshotId;
      } catch (error) {
        console.error("Failed to create snapshot:", error);
        return null;
      }
    },
    [pair, timeframe, createSnapshot, visibleRangeRef]
  );

  return { capture };
}
