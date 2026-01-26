/**
 * Indicator Engine
 *
 * A complete indicator computation and management system for the trading platform.
 *
 * Features:
 * - Pure function primitives (EMA, SMA, ATR, etc.)
 * - Compute orchestrator for batch processing
 * - Zustand store for React integration
 * - Snapshot queries for Claude analysis
 *
 * @example
 * ```tsx
 * // In a component
 * import { useIndicatorStore } from "@/lib/indicators";
 *
 * function Chart() {
 *   const { compute, getVisibleSeries } = useIndicatorStore();
 *
 *   useEffect(() => {
 *     compute(candles);
 *   }, [candles]);
 *
 *   const series = getVisibleSeries();
 *   // Render series on chart...
 * }
 * ```
 */

// Types
export type {
  IndicatorValue,
  IndicatorSeries,
  IndicatorConfig,
  IndicatorStyle,
  IndicatorSnapshot,
  CandleInput,
  PriceSource,
  IndicatorComputeFn,
  MultiOutputIndicatorComputeFn,
  IndicatorRegistryEntry,
} from "./types";

// Primitives
export {
  computeEMA,
  computeSMA,
  computeATR,
  getEMAAtTimestamp,
  getSMAAtTimestamp,
  getATRAtTimestamp,
  getATRMultiple,
  EMA_DEFAULTS,
  SMA_DEFAULTS,
  ATR_DEFAULTS,
} from "./primitives";

export type { EMAParams, SMAParams, ATRParams } from "./primitives";

// Compute orchestrator
export {
  computeIndicator,
  computeIndicators,
  getIndicatorSnapshot,
  getIndicatorValuesInRange,
  findCrossovers,
  compareIndicatorsAt,
  getAvailableIndicators,
  getIndicatorDescription,
  INDICATOR_REGISTRY,
} from "./compute";

// Store
export {
  useIndicatorStore,
  useCrossovers,
  useTrendState,
} from "./store";
