"use client";

import { useState, useEffect, useCallback } from "react";
import type { AnalysisCandle } from "../../lib/analysis/types";

interface UseAnalysisCandlesOptions {
  pair: string;
  timeframe: string;
  targetCount?: number;
  enabled?: boolean;
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
  targetCount = 3000,
  enabled = true,
}: UseAnalysisCandlesOptions): UseAnalysisCandlesResult {
  const [candles, setCandles] = useState<AnalysisCandle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const fetchCandles = useCallback(async () => {
    if (!enabled || !pair || !timeframe) return;

    setIsLoading(true);
    setError(null);
    setProgress(0);
    setCandles([]);

    try {
      const allCandles: AnalysisCandle[] = [];
      let beforeTimestamp: number | undefined;
      const batchSize = 500;
      let iteration = 0;
      const maxIterations = Math.ceil(targetCount / batchSize) + 2;

      while (allCandles.length < targetCount && iteration < maxIterations) {
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
        setProgress(Math.min(95, Math.round((allCandles.length / targetCount) * 100)));

        // Get oldest timestamp for next batch
        beforeTimestamp = batch[0].timestamp;

        // If we got fewer than requested, we've reached the end
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch candles");
      setCandles([]);
    } finally {
      setIsLoading(false);
    }
  }, [pair, timeframe, targetCount, enabled]);

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
