/**
 * Strategy Types
 *
 * TypeScript interfaces for strategy definitions and visuals.
 */

import { IndicatorConfig } from "@/lib/indicators/types";

/**
 * Strategy visual indicator configuration
 * Extends the base IndicatorConfig with visual-specific options
 */
export interface StrategyIndicatorConfig extends IndicatorConfig {
  description?: string;
}

/**
 * Custom indicator configuration
 * For strategy-specific indicators that aren't in the primitive library
 */
export interface CustomIndicatorConfig {
  id: string;
  module: string;  // Relative path to the custom indicator module
  params: Record<string, number | string | boolean>;
  outputs?: string[];  // Names of output series (for multi-output indicators)
}

/**
 * Marker configuration for visual signals
 */
export interface MarkerConfig {
  condition: string;  // Expression to evaluate, e.g., "spike_detector.upSpike === 1"
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  color: string;
  position: "aboveBar" | "belowBar" | "inBar";
  text?: string;
  size?: number;
}

/**
 * Zone configuration for background coloring
 */
export interface ZoneConfig {
  condition: string;  // Expression to evaluate, e.g., "fast_ema > slow_ema"
  color: string;      // RGBA color for the zone
}

/**
 * Strategy visuals definition
 * The structure of a visuals.json file
 */
export interface StrategyVisuals {
  strategyId: string;
  name?: string;
  version?: string;

  // Standard indicators from the primitive library
  indicators: StrategyIndicatorConfig[];

  // Custom strategy-specific indicators
  customIndicators?: CustomIndicatorConfig[];

  // Visual markers (arrows, dots, etc.)
  markers?: Record<string, MarkerConfig>;

  // Background zones
  zones?: Record<string, ZoneConfig>;

  // Descriptions for documentation
  description?: Record<string, string>;

  // Trend rules for quick reference
  trend_rules?: {
    uptrend?: string;
    downtrend?: string;
  };

  // Additional notes
  notes?: string;
}

/**
 * Strategy definition (the main strategy.json)
 */
export interface StrategyDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;

  // Entry conditions
  entry?: {
    long?: StrategyCondition[];
    short?: StrategyCondition[];
  };

  // Exit conditions
  exit?: {
    takeProfit?: TakeProfitConfig;
    stopLoss?: StopLossConfig;
    trailing?: TrailingStopConfig;
  };

  // Risk management
  risk?: {
    maxPositions?: number;
    maxRiskPercent?: number;
    positionSizing?: "fixed" | "percent" | "atr";
  };

  // Indicators used by the strategy
  indicators?: Record<string, IndicatorReference>;

  // Custom parameters
  params?: Record<string, StrategyParam>;
}

/**
 * Strategy condition
 */
export interface StrategyCondition {
  type: "indicator" | "price" | "time" | "custom";
  indicator?: string;
  operator?: ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";
  value?: number | string;
  lookback?: number;
}

/**
 * Take profit configuration
 */
export interface TakeProfitConfig {
  type: "fixed" | "atr" | "percent" | "indicator";
  value: number;
  unit?: "pips" | "percent" | "atr";
}

/**
 * Stop loss configuration
 */
export interface StopLossConfig {
  type: "fixed" | "atr" | "percent" | "swing";
  value: number;
  unit?: "pips" | "percent" | "atr";
}

/**
 * Trailing stop configuration
 */
export interface TrailingStopConfig {
  enabled: boolean;
  type: "fixed" | "atr" | "percent";
  value: number;
  activationProfit?: number;
}

/**
 * Indicator reference in strategy
 */
export interface IndicatorReference {
  type: string;
  params: Record<string, number | string>;
}

/**
 * Strategy parameter definition
 */
export interface StrategyParam {
  type: "number" | "string" | "boolean" | "select";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number }>;
  description?: string;
}

/**
 * Loaded strategy with both definition and visuals
 */
export interface LoadedStrategy {
  id: string;
  definition: StrategyDefinition;
  visuals: StrategyVisuals | null;
  customIndicators: Map<string, unknown>;  // Loaded custom indicator modules
}

/**
 * Strategy list item (for UI)
 */
export interface StrategyListItem {
  id: string;
  name: string;
  version: string;
  summary?: string;
  hasVisuals: boolean;
}
