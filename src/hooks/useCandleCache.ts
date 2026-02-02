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

// All available timeframes in order
const ALL_TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D", "W", "M"] as const;

// Batch sizes for fetching
const INITIAL_CANDLES = 500;
const HISTORY_BATCH_SIZE = 200; // Smaller batches for smoother scroll-back

// Get adjacent timeframes for prefetching
function getAdjacentTimeframes(tf: string): string[] {
  const idx = ALL_TIMEFRAMES.indexOf(tf as typeof ALL_TIMEFRAMES[number]);
  if (idx === -1) return [];

  const adjacent: string[] = [];
  if (idx > 0) adjacent.push(ALL_TIMEFRAMES[idx - 1]);
  if (idx < ALL_TIMEFRAMES.length - 1) adjacent.push(ALL_TIMEFRAMES[idx + 1]);
  return adjacent;
}

// Get remaining timeframes (not current or adjacent)
function getRemainingTimeframes(tf: string): string[] {
  const adjacent = getAdjacentTimeframes(tf);
  return ALL_TIMEFRAMES.filter(t => t !== tf && !adjacent.includes(t));
}

interface CandleCacheEntry {
  candles: CandleData[];
  fetchedAt: number;
  hasMoreHistory: boolean;
}

interface UseCandleCacheOptions {
  pair: string;
  initialTimeframe: string;
}

interface UseCandleCacheResult {
  // Current timeframe data
  candles: CandleData[] | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreHistory: boolean;

  // Cache control
  switchTimeframe: (tf: string) => void;
  currentTimeframe: string;
  loadMoreHistory: () => Promise<void>;
  refetch: () => Promise<void>;

  // Prefetch status
  prefetchedTimeframes: string[];
}

/**
 * Candle cache hook with intelligent prefetching
 *
 * - Caches candles by timeframe for instant switching
 * - Prefetches adjacent timeframes immediately
 * - Background fetches remaining timeframes after delay
 */
export function useCandleCache({
  pair,
  initialTimeframe,
}: UseCandleCacheOptions): UseCandleCacheResult {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [cache, setCache] = useState<Map<string, CandleCacheEntry>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [, setPrefetchedTimeframes] = useState<string[]>([]);

  // Track loading state per timeframe to prevent duplicate fetches
  const loadingRef = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);
  const backgroundFetchScheduled = useRef(false);
  // Use a ref to check cache without triggering callback recreation
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Fetch candles for a specific timeframe
  const fetchCandles = useCallback(async (tf: string, beforeTimestamp?: number): Promise<CandleData[]> => {
    const batchSize = beforeTimestamp ? HISTORY_BATCH_SIZE : INITIAL_CANDLES;
    const params = new URLSearchParams({
      pair,
      timeframe: tf,
      limit: batchSize.toString(),
    });

    if (beforeTimestamp) {
      params.set("before", beforeTimestamp.toString());
    }

    const response = await fetch(`/api/candles?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch candles: ${response.statusText}`);
    }

    const data = await response.json();
    return data.candles;
  }, [pair]);

  // Load a timeframe into cache
  const loadTimeframe = useCallback(async (tf: string, isBackground = false): Promise<boolean> => {
    // Skip if already loading or cached - use ref to avoid dependency on cache
    if (loadingRef.current.has(tf)) return false;
    if (cacheRef.current.has(tf)) return false;

    loadingRef.current.add(tf);

    try {
      const candles = await fetchCandles(tf);

      setCache(prev => {
        const next = new Map(prev);
        next.set(tf, {
          candles,
          fetchedAt: Date.now(),
          // Always assume there's more history until loadMoreHistory returns 0 candles
          hasMoreHistory: true,
        });
        return next;
      });

      if (!isBackground) {
        setPrefetchedTimeframes(prev => [...prev, tf]);
      }
      return true; // Actually loaded
    } catch (err) {
      console.error(`Failed to load ${tf}:`, err);
      return false;
    } finally {
      loadingRef.current.delete(tf);
    }
  }, [fetchCandles]);

  // Load current timeframe on mount/change
  useEffect(() => {
    // If already cached, no loading needed
    if (cacheRef.current.has(timeframe)) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    loadTimeframe(timeframe).then((didLoad) => {
      // Only clear loading state if we actually loaded (not skipped due to race)
      // or if the data is now in cache (loaded by another call)
      if (didLoad || cacheRef.current.has(timeframe)) {
        setIsLoading(false);
      }
    });
  }, [timeframe, loadTimeframe]);

  // Prefetch adjacent timeframes immediately after current loads
  useEffect(() => {
    if (!cache.has(timeframe)) return;

    const adjacent = getAdjacentTimeframes(timeframe);
    adjacent.forEach(tf => {
      if (!cache.has(tf)) {
        loadTimeframe(tf);
      }
    });
  }, [timeframe, cache, loadTimeframe]);

  // Background fetch remaining timeframes after 20 seconds
  useEffect(() => {
    if (!cache.has(timeframe)) return;
    if (backgroundFetchScheduled.current) return;

    backgroundFetchScheduled.current = true;

    const timer = setTimeout(() => {
      const remaining = getRemainingTimeframes(timeframe);
      remaining.forEach((tf, i) => {
        // Stagger requests to avoid overwhelming the server
        setTimeout(() => {
          // Use cacheRef for fresh value inside setTimeout
          if (!cacheRef.current.has(tf)) {
            loadTimeframe(tf, true);
          }
        }, i * 500); // 500ms between each request
      });
    }, 20000); // 20 second delay

    return () => {
      clearTimeout(timer);
    };
  }, [timeframe, cache, loadTimeframe]);

  // Switch timeframe (instant if cached)
  const switchTimeframe = useCallback((tf: string) => {
    setTimeframe(tf);
    // Reset background fetch flag when switching
    backgroundFetchScheduled.current = false;
  }, []);

  // Load more history for current timeframe
  const loadMoreHistory = useCallback(async () => {
    const entry = cache.get(timeframe);
    if (!entry || !entry.hasMoreHistory || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const oldestTimestamp = entry.candles[0]?.timestamp;
      if (!oldestTimestamp) return;

      const newCandles = await fetchCandles(timeframe, oldestTimestamp);

      if (newCandles.length === 0) {
        // No more history
        setCache(prev => {
          const next = new Map(prev);
          const existing = next.get(timeframe);
          if (existing) {
            next.set(timeframe, { ...existing, hasMoreHistory: false });
          }
          return next;
        });
      } else {
        // Prepend older candles, dedupe by timestamp
        setCache(prev => {
          const next = new Map(prev);
          const existing = next.get(timeframe);
          if (existing) {
            const existingTimestamps = new Set(existing.candles.map(c => c.timestamp));
            const uniqueNew = newCandles.filter(c => !existingTimestamps.has(c.timestamp));
            next.set(timeframe, {
              ...existing,
              candles: [...uniqueNew, ...existing.candles],
              // Only set false when we get 0 candles (handled in the if block above)
              hasMoreHistory: true,
            });
          }
          return next;
        });
      }
    } catch (err) {
      console.error("Failed to load more history:", err);
    } finally {
      setIsLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [timeframe, cache, fetchCandles]);

  // Refetch current timeframe
  const refetch = useCallback(async () => {
    // Clear from cache and reload
    setCache(prev => {
      const next = new Map(prev);
      next.delete(timeframe);
      return next;
    });
    loadingRef.current.delete(timeframe);
    await loadTimeframe(timeframe);
  }, [timeframe, loadTimeframe]);

  // Clear cache when pair changes
  useEffect(() => {
    setCache(new Map());
    setPrefetchedTimeframes([]);
    loadingRef.current.clear();
    backgroundFetchScheduled.current = false;
  }, [pair]);

  const entry = cache.get(timeframe);

  return {
    candles: entry?.candles ?? null,
    isLoading,
    isLoadingMore,
    hasMoreHistory: entry?.hasMoreHistory ?? true,
    switchTimeframe,
    currentTimeframe: timeframe,
    loadMoreHistory,
    refetch,
    prefetchedTimeframes: Array.from(cache.keys()),
  };
}
