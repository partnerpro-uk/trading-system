/**
 * useStructure — React hook for fetching market structure data.
 *
 * Fetches from /api/structure/[pair] and re-fetches on a timer
 * matching the API cache TTL for the given timeframe.
 */

import { useState, useEffect, useRef, useCallback } from "react";
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

interface UseStructureOptions {
  pair: string;
  timeframe: string;
  enabled?: boolean;
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
}: UseStructureOptions): UseStructureResult {
  const [structure, setStructure] = useState<StructureResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchStructure = useCallback(async () => {
    if (!enabled || !pair || !timeframe) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/structure/${pair}?timeframe=${timeframe}`,
        { signal: controller.signal }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data: StructureResponse = await res.json();
      setStructure(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [pair, timeframe, enabled]);

  // Fetch on mount and when pair/timeframe changes
  useEffect(() => {
    if (!enabled) {
      setStructure(null);
      return;
    }

    fetchStructure();

    // Re-fetch on interval
    const interval = REFETCH_INTERVAL[timeframe] || 300_000;
    const timer = setInterval(fetchStructure, interval);

    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [pair, timeframe, enabled, fetchStructure]);

  return { structure, isLoading, error, refetch: fetchStructure };
}
