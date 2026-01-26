/**
 * Indicator Store (Zustand)
 *
 * Manages indicator state for the chart. Provides:
 * - Configuration management
 * - Computed series storage
 * - Snapshot queries for Claude
 */

import { create } from "zustand";
import {
  CandleInput,
  IndicatorConfig,
  IndicatorSeries,
  IndicatorSnapshot,
} from "./types";
import {
  computeIndicators,
  getIndicatorSnapshot,
  findCrossovers,
} from "./compute";

interface IndicatorStore {
  /** Current indicator configurations */
  configs: IndicatorConfig[];

  /** Computed indicator series */
  series: IndicatorSeries[];

  /** Whether indicators are currently being computed */
  isComputing: boolean;

  /** Last computation timestamp */
  lastComputedAt: number | null;

  /** Error from last computation */
  error: string | null;

  // Actions

  /** Set indicator configurations (from strategy visuals.json) */
  setConfigs: (configs: IndicatorConfig[]) => void;

  /** Compute indicators from candle data */
  compute: (candles: CandleInput[]) => void;

  /** Get snapshot of all indicator values at a timestamp */
  getSnapshot: (timestamp: number) => IndicatorSnapshot;

  /** Get a specific indicator series by ID */
  getSeries: (id: string) => IndicatorSeries | undefined;

  /** Get visible indicator series (for chart rendering) */
  getVisibleSeries: () => IndicatorSeries[];

  /** Clear all indicator data */
  clear: () => void;

  /** Check if indicators are loaded */
  hasIndicators: () => boolean;
}

export const useIndicatorStore = create<IndicatorStore>((set, get) => ({
  configs: [],
  series: [],
  isComputing: false,
  lastComputedAt: null,
  error: null,

  setConfigs: (configs) => {
    set({ configs, series: [], error: null });
  },

  compute: (candles) => {
    const { configs } = get();

    if (configs.length === 0) {
      set({ series: [], isComputing: false });
      return;
    }

    if (candles.length === 0) {
      set({ series: [], isComputing: false });
      return;
    }

    set({ isComputing: true, error: null });

    try {
      const series = computeIndicators(candles, configs);
      set({
        series,
        isComputing: false,
        lastComputedAt: Date.now(),
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
        isComputing: false,
      });
    }
  },

  getSnapshot: (timestamp) => {
    const { series } = get();
    return getIndicatorSnapshot(series, timestamp);
  },

  getSeries: (id) => {
    const { series } = get();
    return series.find((s) => s.id === id);
  },

  getVisibleSeries: () => {
    const { series, configs } = get();

    // Get IDs of visible indicators
    const visibleIds = new Set(
      configs.filter((c) => c.style.visible !== false).map((c) => c.id)
    );

    return series.filter((s) => visibleIds.has(s.id));
  },

  clear: () => {
    set({
      configs: [],
      series: [],
      isComputing: false,
      lastComputedAt: null,
      error: null,
    });
  },

  hasIndicators: () => {
    const { series } = get();
    return series.length > 0;
  },
}));

/**
 * Hook to get crossovers between two indicators
 * Useful for strategy signal detection
 */
export function useCrossovers(fastId: string, slowId: string) {
  const fast = useIndicatorStore((state) => state.getSeries(fastId));
  const slow = useIndicatorStore((state) => state.getSeries(slowId));

  if (!fast || !slow) return [];

  return findCrossovers(fast, slow);
}

/**
 * Hook to check trend state at current candle
 */
export function useTrendState(fastId: string, slowId: string, timestamp: number) {
  const snapshot = useIndicatorStore((state) => state.getSnapshot(timestamp));

  const fastValue = snapshot.indicators[fastId];
  const slowValue = snapshot.indicators[slowId];

  if (fastValue === undefined || slowValue === undefined) {
    return { trend: "unknown" as const, fastValue: null, slowValue: null };
  }

  return {
    trend: fastValue > slowValue ? ("uptrend" as const) : ("downtrend" as const),
    fastValue,
    slowValue,
  };
}
