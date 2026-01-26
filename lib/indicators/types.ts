/**
 * Indicator Engine Types
 *
 * Core types for the indicator computation system.
 * All indicators produce IndicatorValue arrays that can be:
 * - Rendered on lightweight-charts
 * - Queried by Claude for analysis
 * - Stored with trades as snapshots
 */

/** A single computed indicator value at a specific candle */
export interface IndicatorValue {
  /** Candle timestamp (Unix milliseconds) */
  timestamp: number;
  /** The computed indicator value */
  value: number;
  /** Optional metadata for multi-output indicators */
  metadata?: Record<string, unknown>;
}

/** A complete series of indicator values */
export interface IndicatorSeries {
  /** Unique identifier for this series (e.g., "ema_30") */
  id: string;
  /** Indicator type (e.g., "ema", "sma", "atr") */
  type: string;
  /** Parameters used to compute this series */
  params: Record<string, number | string>;
  /** Computed values, one per candle */
  values: IndicatorValue[];
}

/** Configuration for a single indicator */
export interface IndicatorConfig {
  /** Unique identifier for this indicator instance */
  id: string;
  /** Indicator type from the registry */
  type: string;
  /** Parameters for computation */
  params: Record<string, number | string>;
  /** Visual styling for chart rendering */
  style: IndicatorStyle;
}

/** Visual styling options for indicators */
export interface IndicatorStyle {
  /** Line/bar color (hex or rgba) */
  color: string;
  /** Line width in pixels */
  lineWidth?: number;
  /** Whether to render this indicator (some are computation-only) */
  visible?: boolean;
  /** Line style: solid, dashed, dotted */
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Price scale ID for multi-scale charts */
  priceScaleId?: string;
}

/**
 * Snapshot of all indicator values at a specific candle
 * Used for trade logging and Claude queries
 */
export interface IndicatorSnapshot {
  /** Candle timestamp */
  timestamp: number;
  /** Map of indicator ID to value */
  indicators: Record<string, number>;
}

/** Price source options for indicators */
export type PriceSource = "open" | "high" | "low" | "close" | "hl2" | "hlc3" | "ohlc4";

/** Candle data input for indicator computation */
export interface CandleInput {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Base interface for indicator computation functions
 * All primitives follow this pattern
 */
export type IndicatorComputeFn<TParams = Record<string, number | string>> = (
  candles: CandleInput[],
  params: TParams
) => IndicatorValue[];

/**
 * Multi-output indicator computation function
 * For indicators like MACD that produce multiple series
 */
export type MultiOutputIndicatorComputeFn<
  TParams = Record<string, number | string>,
  TOutput extends Record<string, IndicatorValue[]> = Record<string, IndicatorValue[]>
> = (candles: CandleInput[], params: TParams) => TOutput;

/** Registry entry for an indicator type */
export interface IndicatorRegistryEntry {
  /** Computation function */
  compute: IndicatorComputeFn | MultiOutputIndicatorComputeFn;
  /** Default parameters */
  defaultParams: Record<string, number | string>;
  /** Whether this indicator produces multiple output series */
  multiOutput?: boolean;
  /** Output keys for multi-output indicators */
  outputKeys?: string[];
  /** Human-readable description */
  description: string;
}
