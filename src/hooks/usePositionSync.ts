"use client";

import { useEffect, useRef, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDrawingStore } from "@/lib/drawings/store";
import { isPositionDrawing, PositionDrawing } from "@/lib/drawings/types";
import { CandleData } from "./useCandles";
import { Id } from "../../convex/_generated/dataModel";
import { MomentLabel } from "@/lib/snapshots/capture";

/**
 * Hook that syncs position drawings to Convex trades table.
 *
 * Responsibilities:
 * 1. Creates trades in Convex when new position drawings are created
 * 2. Auto-detects TP/SL hits from candle data and closes trades
 * 3. Tracks max drawdown during the trade
 * 4. Auto-captures chart snapshots on trade entry and exit
 *
 * Trade log (Convex) is the source of truth. Manual edits in trade log
 * take priority - auto-detection only runs for open trades.
 */
export function usePositionSync(
  pair: string,
  timeframe: string,
  candles: CandleData[] | null,
  captureSnapshot?: (params: {
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
  }) => Promise<string | null>,
  livePrice?: { mid?: number; bid?: number; ask?: number } | null
) {
  const createTrade = useMutation(api.trades.createTrade);
  const closeTrade = useMutation(api.trades.closeTrade);
  const updateTrade = useMutation(api.trades.updateTrade);
  const updateDrawing = useDrawingStore((state) => state.updateDrawing);

  // Query open trades for this pair
  const openTrades = useQuery(api.trades.getOpenTrades, {});

  // Track processed IDs to avoid duplicate syncs
  const processedIds = useRef<Set<string>>(new Set());
  const syncingIds = useRef<Set<string>>(new Set());
  // Track which trades we've already closed to avoid duplicate close attempts
  const closedTradeIds = useRef<Set<string>>(new Set());
  // Track last processed candle timestamp per trade
  const lastProcessedCandle = useRef<Map<string, number>>(new Map());
  // Track which trades we've already snapshotted to avoid duplicates
  const snapshotted = useRef<Set<string>>(new Set());

  // Store captureSnapshot in a ref to avoid effect dependency churn
  const captureRef = useRef(captureSnapshot);
  captureRef.current = captureSnapshot;

  // Store livePrice in a ref
  const livePriceRef = useRef(livePrice);
  livePriceRef.current = livePrice;

  // Get all drawings for this chart - stable selector that returns the array reference directly
  const drawingsKey = `${pair}:${timeframe}`;
  const allDrawings = useDrawingStore((state) => state.drawings[drawingsKey]);

  // Filter to position drawings with useMemo to keep stable reference
  const drawings = useMemo(() => {
    if (!allDrawings) return [];
    return allDrawings.filter((d): d is PositionDrawing => isPositionDrawing(d));
  }, [allDrawings]);

  // Store in ref for use in effects
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;

  // Effect 1: Create trades for new position drawings
  useEffect(() => {
    const positionDrawings = drawingsRef.current;

    for (const position of positionDrawings) {
      // Skip signal positions - they're visual indicators, not actual trades
      // Only sync when user confirms the trade (status !== "signal")
      if (position.status === "signal") continue;

      // Only sync new positions that don't have a Convex trade ID yet
      if (!position.convexTradeId && !processedIds.current.has(position.id)) {
        if (syncingIds.current.has(position.id)) continue;

        syncingIds.current.add(position.id);
        const direction = position.type === "longPosition" ? "LONG" : "SHORT";

        createTrade({
          strategyId: position.strategyId || "manual",
          pair,
          timeframe,
          direction,
          entryTime: position.entry.timestamp,
          entryPrice: position.entry.price,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          quantity: position.quantity,
          notes: position.notes,
          createdBy: position.createdBy,
          // Plan vs Reality — Entry
          actualEntryPrice: position.actualEntryPrice,
          actualEntryTime: position.actualEntryTimestamp,
          entryReason: position.entryReason,
        })
          .then((tradeId) => {
            updateDrawing(pair, timeframe, position.id, {
              convexTradeId: tradeId,
              syncedToConvex: true,
            });
            processedIds.current.add(position.id);
            syncingIds.current.delete(position.id);

            // Auto-capture entry snapshot (fire-and-forget)
            if (captureRef.current && !snapshotted.current.has(`entry:${tradeId}`)) {
              snapshotted.current.add(`entry:${tradeId}`);
              const currentPrice = livePriceRef.current?.mid || position.entry.price;
              captureRef.current({
                tradeId,
                momentLabel: "entry",
                currentPrice,
                trade: {
                  entryPrice: position.entry.price,
                  stopLoss: position.stopLoss,
                  takeProfit: position.takeProfit,
                  direction,
                  entryTime: position.entry.timestamp,
                  createdAt: Date.now(),
                  strategyId: position.strategyId,
                },
              }).catch((err) => {
                console.error("Failed to capture entry snapshot:", err);
                snapshotted.current.delete(`entry:${tradeId}`);
              });
            }
          })
          .catch((error) => {
            console.error("Failed to sync position to Convex:", error);
            syncingIds.current.delete(position.id);
          });
      }
    }
  }, [drawings, pair, timeframe, createTrade, updateDrawing]);

  // Effect 2: Auto-detect TP/SL hits from candle data
  useEffect(() => {
    if (!candles || candles.length === 0 || !openTrades) return;

    // Filter open trades for this pair and timeframe
    const relevantTrades = openTrades.filter(
      (t) => t.pair === pair && t.timeframe === timeframe && t.status === "open"
    );

    if (relevantTrades.length === 0) return;

    for (const trade of relevantTrades) {
      // Skip if we've already closed this trade
      if (closedTradeIds.current.has(trade._id)) continue;

      const isLong = trade.direction === "LONG";
      const entryTime = trade.entryTime;

      // Get candles after entry
      const candlesAfterEntry = candles.filter((c) => c.timestamp > entryTime);
      if (candlesAfterEntry.length === 0) continue;

      // Get last processed timestamp for this trade
      const lastProcessed = lastProcessedCandle.current.get(trade._id) || entryTime;

      // Only process new candles
      const newCandles = candlesAfterEntry.filter((c) => c.timestamp > lastProcessed);
      if (newCandles.length === 0) continue;

      let maxDrawdown = trade.maxDrawdownPips || 0;
      let hitResult: { type: "TP" | "SL"; candle: CandleData } | null = null;

      // Calculate pip multiplier based on pair (JPY pairs use 100, others use 10000)
      const pipMultiplier = pair.includes("JPY") ? 100 : 10000;

      for (const candle of newCandles) {
        // Track max drawdown (max adverse excursion)
        if (isLong) {
          // For longs, drawdown is how far price went below entry
          const adverse = (trade.entryPrice - candle.low) * pipMultiplier;
          if (adverse > maxDrawdown) {
            maxDrawdown = adverse;
          }

          // Check for SL hit (low touches or crosses stop loss)
          if (candle.low <= trade.stopLoss) {
            hitResult = { type: "SL", candle };
            break;
          }

          // Check for TP hit (high touches or crosses take profit)
          if (candle.high >= trade.takeProfit) {
            hitResult = { type: "TP", candle };
            break;
          }
        } else {
          // For shorts, drawdown is how far price went above entry
          const adverse = (candle.high - trade.entryPrice) * pipMultiplier;
          if (adverse > maxDrawdown) {
            maxDrawdown = adverse;
          }

          // Check for SL hit (high touches or crosses stop loss)
          if (candle.high >= trade.stopLoss) {
            hitResult = { type: "SL", candle };
            break;
          }

          // Check for TP hit (low touches or crosses take profit)
          if (candle.low <= trade.takeProfit) {
            hitResult = { type: "TP", candle };
            break;
          }
        }

        // Update last processed candle
        lastProcessedCandle.current.set(trade._id, candle.timestamp);
      }

      // Update max drawdown if changed (even if trade not closed yet)
      if (maxDrawdown > (trade.maxDrawdownPips || 0)) {
        updateTrade({
          id: trade._id as Id<"trades">,
          maxDrawdownPips: Math.round(maxDrawdown * 100) / 100,
        }).catch((error) => {
          console.error("Failed to update max drawdown:", error);
        });
      }

      // Close trade if TP/SL hit
      if (hitResult) {
        const { type, candle } = hitResult;
        closedTradeIds.current.add(trade._id);

        // Calculate exit price (exact TP or SL level)
        const exitPrice = type === "TP" ? trade.takeProfit : trade.stopLoss;

        // Calculate P&L in pips
        const pnlPips = isLong
          ? (exitPrice - trade.entryPrice) * pipMultiplier
          : (trade.entryPrice - exitPrice) * pipMultiplier;

        // Calculate bars held
        const entryCandle = candles.find((c) => c.timestamp >= entryTime);
        const entryIndex = entryCandle ? candles.indexOf(entryCandle) : 0;
        const exitIndex = candles.indexOf(candle);
        const barsHeld = exitIndex - entryIndex;

        closeTrade({
          id: trade._id as Id<"trades">,
          exitTime: candle.timestamp,
          exitPrice,
          outcome: type,
          pnlPips: Math.round(pnlPips * 100) / 100,
          barsHeld: Math.max(1, barsHeld),
          closeReason: type === "TP" ? "tp_hit" : "sl_hit",
        })
          .then(() => {
            console.log(`Trade ${trade._id} auto-closed: ${type} hit at ${exitPrice}`);

            // Auto-capture exit snapshot (fire-and-forget)
            if (captureRef.current && !snapshotted.current.has(`exit:${trade._id}`)) {
              snapshotted.current.add(`exit:${trade._id}`);
              captureRef.current({
                tradeId: trade._id,
                momentLabel: "exit",
                currentPrice: exitPrice,
                trade: {
                  entryPrice: trade.entryPrice,
                  stopLoss: trade.stopLoss,
                  takeProfit: trade.takeProfit,
                  direction: trade.direction,
                  entryTime: trade.entryTime,
                  createdAt: trade.createdAt,
                  strategyId: trade.strategyId,
                },
              }).catch((err) => {
                console.error("Failed to capture exit snapshot:", err);
                snapshotted.current.delete(`exit:${trade._id}`);
              });
            }
          })
          .catch((error) => {
            console.error("Failed to close trade:", error);
            // Remove from closed set so we can retry
            closedTradeIds.current.delete(trade._id);
          });
      }
    }
  }, [candles, openTrades, pair, timeframe, closeTrade, updateTrade]);
}
