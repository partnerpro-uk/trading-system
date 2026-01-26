/**
 * Strategies Module - Public API
 */

// Types
export type {
  StrategyVisuals,
  StrategyDefinition,
  StrategyIndicatorConfig,
  CustomIndicatorConfig,
  MarkerConfig,
  ZoneConfig,
  LoadedStrategy,
  StrategyListItem,
  StrategyCondition,
  TakeProfitConfig,
  StopLossConfig,
  TrailingStopConfig,
  IndicatorReference,
  StrategyParam,
} from "./types";

// Loader functions
export {
  getStrategyList,
  loadStrategyDefinition,
  loadStrategyVisuals,
  loadStrategy,
  validateVisuals,
  getCustomIndicatorPath,
  strategyExists,
  getStrategyPath,
} from "./loader";
