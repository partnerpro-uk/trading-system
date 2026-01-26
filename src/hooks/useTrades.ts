"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export type TradeStatus = "pending" | "open" | "closed" | "cancelled";
export type TradeOutcome = "TP" | "SL" | "MW" | "ML" | "BE";
export type TradeDirection = "LONG" | "SHORT";

export interface Trade {
  _id: Id<"trades">;
  _creationTime: number;
  userId?: string;
  strategyId: string;
  pair: string;
  timeframe: string;
  direction: TradeDirection;
  entryTime: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  quantity?: number;
  riskPercent?: number;
  outcome?: TradeOutcome;
  pnlPips?: number;
  pnlDollars?: number;
  barsHeld?: number;
  maxDrawdownPips?: number;  // Max adverse excursion (how far trade went against)
  indicatorSnapshot?: string;
  conditionsMet?: string[];
  notes?: string;
  entryScreenshot?: string;  // Screenshot URL at entry
  exitScreenshot?: string;   // Screenshot URL at exit
  status: TradeStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinPips: number;
  avgLossPips: number;
  totalPnlPips: number;
  totalPnlDollars: number;
  avgBarsHeld: number;
  expectancy: number;
}

interface UseTradesOptions {
  status?: TradeStatus;
  strategyId?: string;
  pair?: string;
  limit?: number;
}

/**
 * Hook for fetching and managing trades from Convex
 */
export function useTrades(options: UseTradesOptions = {}) {
  const { status, strategyId, pair, limit } = options;

  // Fetch trades based on filters
  const trades = useQuery(
    strategyId
      ? api.trades.getTradesByStrategy
      : pair
        ? api.trades.getTradesByPair
        : api.trades.getTrades,
    strategyId
      ? { strategyId, limit }
      : pair
        ? { pair, limit }
        : { status, limit }
  );

  // Mutations
  const createTradeMutation = useMutation(api.trades.createTrade);
  const closeTradeMutation = useMutation(api.trades.closeTrade);
  const updateTradeMutation = useMutation(api.trades.updateTrade);
  const cancelTradeMutation = useMutation(api.trades.cancelTrade);
  const deleteTradeMutation = useMutation(api.trades.deleteTrade);

  return {
    trades: trades as Trade[] | undefined,
    isLoading: trades === undefined,
    createTrade: createTradeMutation,
    closeTrade: closeTradeMutation,
    updateTrade: updateTradeMutation,
    cancelTrade: cancelTradeMutation,
    deleteTrade: deleteTradeMutation,
  };
}

/**
 * Hook for fetching trade statistics
 */
export function useTradeStats(options: { strategyId?: string; pair?: string } = {}) {
  const stats = useQuery(api.trades.getTradeStats, options);

  return {
    stats: stats as TradeStats | undefined,
    isLoading: stats === undefined,
  };
}

/**
 * Hook for fetching open trades
 */
export function useOpenTrades() {
  const trades = useQuery(api.trades.getOpenTrades, {});

  return {
    trades: trades as Trade[] | undefined,
    isLoading: trades === undefined,
  };
}

/**
 * Hook for fetching a single trade
 */
export function useTrade(tradeId: Id<"trades"> | null) {
  const trade = useQuery(
    api.trades.getTrade,
    tradeId ? { id: tradeId } : "skip"
  );

  return {
    trade: trade as Trade | undefined,
    isLoading: trade === undefined,
  };
}

/**
 * Hook for fetching trades for a specific chart (pair + timeframe)
 * Returns a map of tradeId -> Trade for easy lookup when rendering positions
 */
export function useTradesForChart(pair: string, timeframe: string) {
  const trades = useQuery(api.trades.getTradesByPair, { pair, limit: 100 });

  // Filter by timeframe and create a lookup map
  const tradesMap = new Map<string, Trade>();
  if (trades) {
    for (const trade of trades) {
      if (trade.timeframe === timeframe) {
        tradesMap.set(trade._id, trade as Trade);
      }
    }
  }

  return {
    trades: trades?.filter((t) => t.timeframe === timeframe) as Trade[] | undefined,
    tradesMap,
    isLoading: trades === undefined,
    // Helper to get trade by ID
    getTradeById: (tradeId: string) => tradesMap.get(tradeId),
  };
}
