"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface CandleData {
  time: string;
  timestamp: number;
  pair: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface UseCandlesOptions {
  pair: string;
  timeframe: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

interface UseCandlesResult {
  candles: CandleData[] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  hasMoreHistory: boolean;
  refetch: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;
}

/**
 * Custom hook to fetch candles from ClickHouse via API
 *
 * Replaces the Convex useQuery for candles, fetching from our
 * ClickHouse-backed API route instead.
 *
 * Supports TradingView-style infinite scroll-back via loadMoreHistory()
 */
export function useCandles({
  pair,
  timeframe,
  limit = 2000,
  startTime,
  endTime,
}: UseCandlesOptions): UseCandlesResult {
  const [candles, setCandles] = useState<CandleData[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);

  // Track if we're already loading to prevent duplicate requests
  const loadingMoreRef = useRef(false);

  const fetchCandles = useCallback(async () => {
    if (!pair || !timeframe) {
      setCandles(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        pair,
        timeframe,
        limit: limit.toString(),
      });

      if (startTime) {
        params.set("startTime", startTime.toString());
      }
      if (endTime) {
        params.set("endTime", endTime.toString());
      }

      const response = await fetch(`/api/candles?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch candles: ${response.statusText}`);
      }

      const data = await response.json();
      setCandles(data.candles);
      setHasMoreHistory(true); // Reset on fresh fetch
    } catch (err) {
      console.error("Error fetching candles:", err);
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [pair, timeframe, limit, startTime, endTime]);

  // Load more historical candles (for scroll-back)
  const loadMoreHistory = useCallback(async () => {
    if (!candles || candles.length === 0 || !hasMoreHistory || loadingMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      // Get the oldest candle's timestamp
      const oldestTimestamp = candles[0].timestamp;

      const params = new URLSearchParams({
        pair,
        timeframe,
        limit: limit.toString(),
        before: oldestTimestamp.toString(),
      });

      const response = await fetch(`/api/candles?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch more candles: ${response.statusText}`);
      }

      const data = await response.json();
      const newCandles: CandleData[] = data.candles;

      if (newCandles.length === 0) {
        setHasMoreHistory(false);
      } else {
        // Prepend older candles to existing data
        setCandles(prev => {
          if (!prev) return newCandles;
          // Dedupe by timestamp
          const existingTimestamps = new Set(prev.map(c => c.timestamp));
          const uniqueNew = newCandles.filter(c => !existingTimestamps.has(c.timestamp));
          return [...uniqueNew, ...prev];
        });

        // If we got fewer than requested, we've reached the end
        if (newCandles.length < limit) {
          setHasMoreHistory(false);
        }
      }
    } catch (err) {
      console.error("Error loading more history:", err);
    } finally {
      setIsLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [candles, pair, timeframe, limit, hasMoreHistory]);

  // Fetch on mount and when params change
  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  return {
    candles,
    isLoading,
    isLoadingMore,
    error,
    hasMoreHistory,
    refetch: fetchCandles,
    loadMoreHistory,
  };
}
