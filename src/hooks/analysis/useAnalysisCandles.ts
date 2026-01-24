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
  targetCount = 10000, // Increased default for date range queries
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

  const fetchCandles = useCallback(async () => {
    if (!enabled || !pair || !timeframe) return;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setCandles([]);

    try {
      const allCandles: AnalysisCandle[] = [];
      let beforeTimestamp: number | undefined = endTimestamp || undefined;
      const batchSize = 500;
      let iteration = 0;
      // Allow many more iterations when fetching a date range (could be years of data)
      // H1 = 24 candles/day × 365 = 8760/year, at 500/batch = ~18 iterations/year
      const maxIterations = startTimestamp
        ? 500  // Allow up to ~5 years of history when date filtering
        : Math.ceil(targetCount / batchSize) + 10;

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

        // Filter batch by start date if specified
        let filteredBatch = batch;
        if (startTimestamp) {
          filteredBatch = batch.filter((c) => c.timestamp >= startTimestamp);
        }

        // Prepend older candles
        allCandles.unshift(...filteredBatch);

        // Update progress - estimate based on date range or count
        const progressPct = startTimestamp
          ? Math.min(95, Math.round(((endTimestamp || Date.now()) - batch[0].timestamp) / ((endTimestamp || Date.now()) - startTimestamp) * 100))
          : Math.min(95, Math.round((allCandles.length / targetCount) * 100));
        setProgress(progressPct);

        // Get oldest timestamp for next batch
        beforeTimestamp = batch[0].timestamp;

        // Stop conditions:
        // 1. If we have a start date and the oldest candle is before it - we've fetched enough
        if (startTimestamp && batch[0].timestamp < startTimestamp) {
          break;
        }
        // 2. If no date range and we've hit the target count
        if (!startTimestamp && allCandles.length >= targetCount) {
          break;
        }
        // 3. If we got fewer than requested AND no date range - we've reached the end
        //    (When date filtering, keep going - dual-database may return partial batches)
        if (!startTimestamp && batch.length < batchSize) {
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

      // Final filter by date range
      let finalCandles = deduped;
      if (startTimestamp) {
        finalCandles = finalCandles.filter((c) => c.timestamp >= startTimestamp);
      }
      if (endTimestamp) {
        finalCandles = finalCandles.filter((c) => c.timestamp <= endTimestamp);
      }

      setCandles(finalCandles);
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch candles");
      setCandles([]);
    } finally {
      setIsLoading(false);
    }
  }, [pair, timeframe, targetCount, enabled, startTimestamp, endTimestamp]);

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
