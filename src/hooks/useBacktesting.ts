/**
 * Backtesting Hook
 *
 * Manages query state, fetches data from multiple API endpoints,
 * and computes derived analytics (distribution, heatmap, seasonal).
 */

import { useState, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export type EntityType = "bos" | "fvg" | "sweep" | "swing";

export interface BacktestingQuery {
  pairs: string[];
  timeframes: string[];
  startDate: string;
  endDate: string;
  entityType: EntityType;
  filters: {
    direction?: string;
    displacement?: boolean;
    counterTrend?: boolean;
    tier?: number;
    minGapPips?: number;
    status?: string;
    sweptLevelType?: string;
    followedByBOS?: boolean;
  };
}

export interface QueryResult {
  data: Record<string, unknown>[];
  total: number;
  hasMore: boolean;
  pair: string;
  entityType: string;
}

export interface StatsData {
  totalEvents: number;
  successRate: number;
  avgMagnitude: number;
  bestCombo: string;
}

export interface DistributionBin {
  range: string;
  bullish: number;
  bearish: number;
}

export interface HeatmapCell {
  pair: string;
  timeframe: string;
  value: number;
  count: number;
}

export interface SeasonalData {
  month: number;
  monthName: string;
  bullish: number;
  bearish: number;
  netBias: number;
  avgMagnitude: number;
}

export interface BacktestingResult {
  queryResults: QueryResult[];
  stats: StatsData;
  distribution: DistributionBin[];
  heatmap: HeatmapCell[];
  seasonal: SeasonalData[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════════════════════

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const DEFAULT_QUERY: BacktestingQuery = {
  pairs: ["EUR_USD"],
  timeframes: ["H4"],
  startDate: "2024-01-01",
  endDate: new Date().toISOString().split("T")[0],
  entityType: "bos",
  filters: {},
};

// ═══════════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════════

export function useBacktesting() {
  const [query, setQuery] = useState<BacktestingQuery>(DEFAULT_QUERY);
  const [result, setResult] = useState<BacktestingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runQuery = useCallback(async (q?: BacktestingQuery) => {
    const activeQuery = q || query;
    setIsLoading(true);
    setError(null);

    try {
      // Fetch data for all pair × timeframe combinations in parallel
      const fetches: Promise<QueryResult>[] = [];

      for (const pair of activeQuery.pairs) {
        for (const timeframe of activeQuery.timeframes) {
          const params = new URLSearchParams({
            pair,
            timeframe,
            entityType: activeQuery.entityType,
            startDate: activeQuery.startDate,
            endDate: activeQuery.endDate,
            limit: "5000",
          });

          if (activeQuery.filters.direction)
            params.set("direction", activeQuery.filters.direction);
          if (activeQuery.filters.displacement)
            params.set("displacement", "true");
          if (activeQuery.filters.counterTrend)
            params.set("counterTrend", "true");
          if (activeQuery.filters.tier)
            params.set("tier", String(activeQuery.filters.tier));
          if (activeQuery.filters.minGapPips)
            params.set("minGapPips", String(activeQuery.filters.minGapPips));
          if (activeQuery.filters.status)
            params.set("status", activeQuery.filters.status);
          if (activeQuery.filters.sweptLevelType)
            params.set("sweptLevelType", activeQuery.filters.sweptLevelType);
          if (activeQuery.filters.followedByBOS)
            params.set("followedByBOS", "true");

          fetches.push(
            fetch(`/api/backtesting/query?${params}`)
              .then((r) => r.json())
              .then((json) => ({
                ...json,
                pair,
                timeframe,
              }))
          );
        }
      }

      // Also fetch analytics data in parallel
      const analyticsFetches = activeQuery.pairs.map(async (pair) => {
        const tf = activeQuery.timeframes[0];
        const tfParam = tf ? `?timeframe=${tf}` : "";

        if (activeQuery.entityType === "fvg") {
          const res = await fetch(`/api/historical/fvg-effectiveness/${pair}${tfParam}`);
          return { pair, type: "fvg", data: await res.json() };
        } else if (activeQuery.entityType === "bos") {
          const res = await fetch(`/api/historical/bos-patterns/${pair}${tfParam}`);
          return { pair, type: "bos", data: await res.json() };
        }
        return { pair, type: activeQuery.entityType, data: null };
      });

      const [queryResults, analyticsResults] = await Promise.all([
        Promise.all(fetches),
        Promise.all(analyticsFetches),
      ]);

      // Merge all data rows
      const allData = queryResults.flatMap((r) => r.data || []);

      // Compute stats
      const stats = computeStats(allData, activeQuery.entityType, analyticsResults);

      // Compute distribution
      const distribution = computeDistribution(allData, activeQuery.entityType);

      // Compute heatmap
      const heatmap = computeHeatmap(queryResults, activeQuery.entityType);

      // Compute seasonal
      const seasonal = computeSeasonal(allData, activeQuery.entityType);

      setResult({
        queryResults,
        stats,
        distribution,
        heatmap,
        seasonal,
      });
    } catch (err) {
      console.error("[useBacktesting] Error:", err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  return { query, setQuery, result, runQuery, isLoading, error };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Computation Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function computeStats(
  data: Record<string, unknown>[],
  entityType: EntityType,
  analytics: { pair: string; type: string; data: Record<string, unknown> | null }[]
): StatsData {
  const total = data.length;

  let successRate = 0;
  let avgMagnitude = 0;
  let bestCombo = "-";

  if (entityType === "bos") {
    const active = data.filter((d) => d.status === "active").length;
    successRate = total > 0 ? (active / total) * 100 : 0;
    const mags = data.map((d) => Number(d.magnitude_pips || 0)).filter((m) => m > 0);
    avgMagnitude = mags.length > 0 ? mags.reduce((a, b) => a + b, 0) / mags.length : 0;

    // Find best combo from analytics
    const bosAnalytics = analytics.find((a) => a.type === "bos" && a.data);
    if (bosAnalytics?.data) {
      const stats = (bosAnalytics.data as Record<string, unknown>).stats as Record<string, unknown>[];
      if (stats?.length > 0) {
        const best = stats.reduce((a, b) =>
          Number(a.continuationRate || 0) > Number(b.continuationRate || 0) ? a : b
        );
        bestCombo = `${best.timeframe} ${best.direction}`;
      }
    }
  } else if (entityType === "fvg") {
    const filled = data.filter((d) => d.status === "filled").length;
    successRate = total > 0 ? (filled / total) * 100 : 0;
    const gaps = data.map((d) => Number(d.gap_size_pips || 0)).filter((g) => g > 0);
    avgMagnitude = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

    const fvgAnalytics = analytics.find((a) => a.type === "fvg" && a.data);
    if (fvgAnalytics?.data) {
      const stats = (fvgAnalytics.data as Record<string, unknown>).stats as Record<string, unknown>[];
      if (stats?.length > 0) {
        const best = stats.reduce((a, b) =>
          Number(a.fillRate || 0) > Number(b.fillRate || 0) ? a : b
        );
        bestCombo = `T${best.tier} ${best.direction}`;
      }
    }
  } else if (entityType === "sweep") {
    const withBos = data.filter((d) => d.followed_by_bos === 1).length;
    successRate = total > 0 ? (withBos / total) * 100 : 0;
    avgMagnitude = 0; // Sweeps don't have magnitude
    bestCombo = "-";
  } else if (entityType === "swing") {
    successRate = 0; // N/A for swings
    const ranges = data.map((d) => Number(d.true_range || 0)).filter((r) => r > 0);
    avgMagnitude = ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
  }

  return { totalEvents: total, successRate, avgMagnitude, bestCombo };
}

function computeDistribution(
  data: Record<string, unknown>[],
  entityType: EntityType
): DistributionBin[] {
  // Get magnitude field based on entity type
  const getMagnitude = (d: Record<string, unknown>): number => {
    switch (entityType) {
      case "bos": return Number(d.magnitude_pips || 0);
      case "fvg": return Number(d.gap_size_pips || 0);
      case "swing": return Number(d.true_range || 0);
      case "sweep": return Number(d.wick_extreme || 0) - Number(d.swept_level || 0);
      default: return 0;
    }
  };

  const getDirection = (d: Record<string, unknown>): string => {
    return String(d.direction || d.swing_type || "unknown").toLowerCase();
  };

  const magnitudes = data.map((d) => ({
    value: Math.abs(getMagnitude(d)),
    dir: getDirection(d),
  })).filter((m) => m.value > 0);

  if (magnitudes.length === 0) return [];

  const maxMag = Math.max(...magnitudes.map((m) => m.value));
  const binCount = 10;
  const binSize = Math.ceil(maxMag / binCount) || 1;

  const bins: DistributionBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const low = i * binSize;
    const high = (i + 1) * binSize;
    bins.push({
      range: `${low}-${high}`,
      bullish: magnitudes.filter(
        (m) => m.value >= low && m.value < high && m.dir.includes("bull")
      ).length,
      bearish: magnitudes.filter(
        (m) => m.value >= low && m.value < high && m.dir.includes("bear")
      ).length,
    });
  }

  return bins.filter((b) => b.bullish > 0 || b.bearish > 0);
}

function computeHeatmap(
  results: QueryResult[],
  entityType: EntityType
): HeatmapCell[] {
  return results.map((r) => {
    const data = r.data || [];
    let value = 0;

    if (entityType === "bos") {
      const active = data.filter((d) => (d as Record<string, unknown>).status === "active").length;
      value = data.length > 0 ? (active / data.length) * 100 : 0;
    } else if (entityType === "fvg") {
      const filled = data.filter((d) => (d as Record<string, unknown>).status === "filled").length;
      value = data.length > 0 ? (filled / data.length) * 100 : 0;
    } else if (entityType === "sweep") {
      const withBos = data.filter((d) => (d as Record<string, unknown>).followed_by_bos === 1).length;
      value = data.length > 0 ? (withBos / data.length) * 100 : 0;
    } else {
      value = data.length;
    }

    return {
      pair: r.pair,
      timeframe: (r as unknown as Record<string, unknown>).timeframe as string || "all",
      value,
      count: data.length,
    };
  });
}

function computeSeasonal(
  data: Record<string, unknown>[],
  entityType: EntityType
): SeasonalData[] {
  const monthly: Record<number, { bullish: number; bearish: number; magnitudes: number[] }> = {};

  for (let m = 1; m <= 12; m++) {
    monthly[m] = { bullish: 0, bearish: 0, magnitudes: [] };
  }

  for (const d of data) {
    const time = String(d.time || "");
    if (!time) continue;

    const month = new Date(time).getMonth() + 1;
    if (month < 1 || month > 12) continue;

    const dir = String(d.direction || d.swing_type || "").toLowerCase();
    if (dir.includes("bull")) monthly[month].bullish++;
    else if (dir.includes("bear")) monthly[month].bearish++;

    let mag = 0;
    if (entityType === "bos") mag = Number(d.magnitude_pips || 0);
    else if (entityType === "fvg") mag = Number(d.gap_size_pips || 0);
    else if (entityType === "swing") mag = Number(d.true_range || 0);
    if (mag > 0) monthly[month].magnitudes.push(mag);
  }

  return Object.entries(monthly).map(([m, v]) => ({
    month: parseInt(m),
    monthName: MONTH_NAMES[parseInt(m) - 1],
    bullish: v.bullish,
    bearish: v.bearish,
    netBias: v.bullish - v.bearish,
    avgMagnitude:
      v.magnitudes.length > 0
        ? v.magnitudes.reduce((a, b) => a + b, 0) / v.magnitudes.length
        : 0,
  }));
}
