/**
 * useStructure — React hook for fetching market structure data.
 *
 * Two modes:
 * 1. Legacy (no visibleRange): fetches all structure on-demand
 * 2. Range-based (with visibleRange): reads pre-computed from DB + live tail
 *
 * Range-based mode debounces visible range changes and pads the request
 * to avoid re-fetching on small scrolls.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { StructureResponse } from "@/lib/structure/types";

const REFETCH_INTERVAL: Record<string, number> = {
  M15: 60_000,
  M30: 60_000,
  H1: 180_000,
  H4: 300_000,
  D: 900_000,
  W: 900_000,
  M: 900_000,
};

/** Pad the visible range by this fraction on each side to reduce refetches on small scrolls. */
const RANGE_PAD_FRACTION = 0.2;

/** Debounce delay for visible range changes (ms). */
const RANGE_DEBOUNCE_MS = 200;

interface UseStructureOptions {
  pair: string;
  timeframe: string;
  enabled?: boolean;
  visibleRange?: { from: number; to: number } | null;
}

interface UseStructureResult {
  structure: StructureResponse | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStructure({
  pair,
  timeframe,
  enabled = true,
  visibleRange = null,
}: UseStructureOptions): UseStructureResult {
  const [structure, setStructure] = useState<StructureResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Track the range we've already fetched to avoid redundant requests
  const fetchedRangeRef = useRef<{ from: number; to: number } | null>(null);

  // Debounced visible range
  const [debouncedRange, setDebouncedRange] = useState(visibleRange);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedRange(visibleRange), RANGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visibleRange?.from, visibleRange?.to]);

  // Compute padded range
  const paddedRange = useMemo(() => {
    if (!debouncedRange) return null;
    const span = debouncedRange.to - debouncedRange.from;
    const pad = span * RANGE_PAD_FRACTION;
    return {
      from: Math.floor(debouncedRange.from - pad),
      to: Math.ceil(debouncedRange.to + pad),
    };
  }, [debouncedRange]);

  // Check if the current visible range is within the already-fetched range
  const needsFetch = useMemo(() => {
    if (!paddedRange) return true; // No range = legacy mode, always fetch
    const fetched = fetchedRangeRef.current;
    if (!fetched) return true; // Never fetched
    // Refetch if visible range extends beyond what we have
    return paddedRange.from < fetched.from || paddedRange.to > fetched.to;
  }, [paddedRange]);

  const fetchStructure = useCallback(
    async (force = false) => {
      if (!enabled || !pair || !timeframe) return;

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        // Build URL: include from/to if we have a padded range
        let url = `/api/structure/${pair}?timeframe=${timeframe}`;
        if (paddedRange) {
          url += `&from=${paddedRange.from}&to=${paddedRange.to}`;
        }

        const res = await fetch(url, { signal: controller.signal });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const data: StructureResponse = await res.json();
        setStructure(data);

        // Track what range we fetched
        if (paddedRange) {
          fetchedRangeRef.current = paddedRange;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [pair, timeframe, enabled, paddedRange]
  );

  // Reset fetched range when pair/timeframe changes
  useEffect(() => {
    fetchedRangeRef.current = null;
  }, [pair, timeframe]);

  // Fetch on mount, pair/timeframe change, or when visible range exceeds cache
  useEffect(() => {
    if (!enabled) {
      setStructure(null);
      return;
    }

    if (needsFetch) {
      fetchStructure();
    }

    // Re-fetch on interval for leading edge updates (live tail)
    const interval = REFETCH_INTERVAL[timeframe] || 300_000;
    const timer = setInterval(() => {
      // Force refetch on timer regardless of range cache
      fetchedRangeRef.current = null;
      fetchStructure(true);
    }, interval);

    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [pair, timeframe, enabled, needsFetch, fetchStructure]);

  return { structure, isLoading, error, refetch: fetchStructure };
}
