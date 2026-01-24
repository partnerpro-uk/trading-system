"use client";

import { useState, useEffect, useCallback } from "react";
import type { AnalysisCandle } from "../../lib/analysis/types";

interface UseAnalysisCandlesOptions {
  pair: string;
  timeframe: string;
  targetCount?: number;
  enabled?: boolean;
  dateStart?: string | null; // ISO date string (YYYY-MM-DD)
  dateEnd?: string | null;   // ISO date string (YYYY-MM-DD)
}

interface UseAnalysisCandlesResult {
  candles: AnalysisCandle[];
  isLoading: boolean;
  error: string | null;
  progress: number; // 0-100
  refetch: () => void;
  stats: {
    count: number;
    dateRange: { from: Date | null; to: Date | null };
    pair: string;
    timeframe: string;
  };
}

export function useAnalysisCandles({
  pair,
  timeframe,
  targetCount = 10000,
  enabled = true,
  dateStart,
  dateEnd,
}: UseAnalysisCandlesOptions): UseAnalysisCandlesResult {
  const [candles, setCandles] = useState<AnalysisCandle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Convert date strings to timestamps
  const startTimestamp = dateStart ? new Date(dateStart).getTime() : null;
  const endTimestamp = dateEnd ? new Date(dateEnd + "T23:59:59").getTime() : null;

  // Use range API when we have date filters (much faster - single query)
  const hasDateFilter = startTimestamp !== null || endTimestamp !== null;

  const fetchCandles = useCallback(async () => {
    if (!enabled || !pair || !timeframe) return;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setCandles([]);

    try {
      if (hasDateFilter) {
        // Fast path: Use range API for date-filtered queries
        // This is a single query instead of paginating in 500-candle batches
        setProgress(10);

        const params = new URLSearchParams({ pair, timeframe });
        if (startTimestamp) params.set("from", startTimestamp.toString());
        if (endTimestamp) params.set("to", endTimestamp.toString());

        const response = await fetch(`/api/candles/range?${params}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch candles: ${response.status}`);
        }

        setProgress(80);

        const data = await response.json();
        const fetchedCandles = (data.candles || []) as AnalysisCandle[];

        setCandles(fetchedCandles);
        setProgress(100);
      } else {
        // Legacy path: Paginate backwards for "ALL" or no date filter
        // This fetches in 500-candle batches
        const allCandles: AnalysisCandle[] = [];
        let beforeTimestamp: number | undefined = undefined;
        const batchSize = 500;
        let iteration = 0;
        const maxIterations = Math.ceil(targetCount / batchSize) + 10;

        while (iteration < maxIterations) {
          iteration++;

          const params = new URLSearchParams({
            pair,
            timeframe,
            limit: batchSize.toString(),
          });

          if (beforeTimestamp) {
            params.set("before", beforeTimestamp.toString());
          }

          const response = await fetch(`/api/candles?${params}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch candles: ${response.status}`);
          }

          const data = await response.json();
          const batch = data.candles as AnalysisCandle[];

          if (!batch || batch.length === 0) {
            break; // No more history available
          }

          // Prepend older candles
          allCandles.unshift(...batch);

          // Update progress
          const progressPct = Math.min(95, Math.round((allCandles.length / targetCount) * 100));
          setProgress(progressPct);

          // Get oldest timestamp for next batch
          beforeTimestamp = batch[0].timestamp;

          // Stop if we've hit the target count
          if (allCandles.length >= targetCount) {
            break;
          }
          // Stop if we got fewer than requested (reached end of history)
          if (batch.length < batchSize) {
            break;
          }
        }

        // Deduplicate by timestamp
        const seen = new Set<number>();
        const deduped = allCandles.filter((c) => {
          if (seen.has(c.timestamp)) return false;
          seen.add(c.timestamp);
          return true;
        });

        // Sort ascending (oldest first)
        deduped.sort((a, b) => a.timestamp - b.timestamp);

        setCandles(deduped);
        setProgress(100);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch candles");
      setCandles([]);
    } finally {
      setIsLoading(false);
    }
  }, [pair, timeframe, targetCount, enabled, hasDateFilter, startTimestamp, endTimestamp]);

  useEffect(() => {
    fetchCandles();
  }, [fetchCandles]);

  const stats = {
    count: candles.length,
    dateRange: {
      from: candles.length > 0 ? new Date(candles[0].timestamp) : null,
      to: candles.length > 0 ? new Date(candles[candles.length - 1].timestamp) : null,
    },
    pair,
    timeframe,
  };

  return {
    candles,
    isLoading,
    error,
    progress,
    refetch: fetchCandles,
    stats,
  };
}
