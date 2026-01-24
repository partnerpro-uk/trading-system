/**
 * Settings Mapper
 *
 * Maps SimpleSettings (12 params) → FullAnalysisSettings (85+ params)
 * for worker compatibility. Uses sensible defaults for hidden params.
 */

import type { SimpleSettings, ModelKey } from "./simple-settings-types";
import { MODEL_KEYS } from "./simple-settings-types";
import type { FullAnalysisSettings, ModelStates } from "./settings-types";
import { DEFAULT_FULL_SETTINGS } from "./settings-types";

/**
 * Dollars per 1.0 price move for different instruments.
 * This converts raw price differences to P&L in dollars.
 *
 * For forex: 1 pip = 0.0001, and 1 pip on a standard lot (100k units) = $10
 *   So 1.0 price move = $10 / 0.0001 = $100,000
 *
 * For JPY pairs: 1 pip = 0.01, and 1 pip on a standard lot = $10
 *   So 1.0 price move = $10 / 0.01 = $1,000
 *
 * For Gold (XAU): Trading 1 lot (100 oz), $1 move = $100
 *   So 1.0 price move = $100
 *
 * For Bitcoin: 1 lot (1 BTC), $1 move = $1
 *   So 1.0 price move = $1
 *
 * For indices (SPX500): typically $1 per point
 *   So 1.0 price move = $1
 */
const DOLLARS_PER_MOVE: Record<string, number> = {
  // Major forex pairs (1 pip = 0.0001 = $10)
  EUR_USD: 100000,
  GBP_USD: 100000,
  AUD_USD: 100000,
  NZD_USD: 100000,
  USD_CHF: 100000,
  USD_CAD: 100000,

  // JPY pairs (1 pip = 0.01 = $10)
  USD_JPY: 1000,
  EUR_JPY: 1000,
  GBP_JPY: 1000,
  AUD_JPY: 1000,

  // Gold (100 oz lot, $1 move = $100)
  XAU_USD: 100,

  // Bitcoin ($1 move = $1)
  BTC_USD: 1,

  // Indices ($1 per point)
  SPX500_USD: 1,
  DXY: 1,
};

/**
 * Get dollarsPerMove for a specific pair.
 * Defaults to forex value (100000) if pair not found.
 */
export function getDollarsPerMove(pair: string): number {
  return DOLLARS_PER_MOVE[pair] ?? 100000;
}

/**
 * Pip value in dollars (for display purposes).
 * For forex: $10/pip, For JPY: $10/pip, For Gold: $0.10/pip
 */
export function getPipValue(pair: string): number {
  if (pair.includes("JPY")) return 10;
  if (pair === "XAU_USD") return 10; // Gold: $0.10 move = $10
  if (pair === "BTC_USD") return 1;
  if (pair === "SPX500_USD" || pair === "DXY") return 1;
  return 10; // Standard forex pip value
}

/**
 * Maps simplified settings to full worker format.
 * @param simple - Simple settings with 12 parameters
 * @param pair - Currency pair (e.g., "EUR_USD", "XAU_USD") for correct dollarsPerMove
 */
export function mapSimpleToFull(simple: SimpleSettings, pair?: string): FullAnalysisSettings {
  const dollarsPerMove = pair ? getDollarsPerMove(pair) : 100000;
  const pipValue = pair ? getPipValue(pair) : 10;

  // Convert pips to dollars
  // For forex: 30 pips * $10/pip = $300
  // For Gold: 30 pips * $10/pip = $300 (where 1 "pip" = $0.10 move)
  const tpDollars = simple.tpPips * pipValue;
  const slDollars = simple.slPips * pipValue;

  // Convert boolean model toggles to 0/2 states
  const modelStates: ModelStates = {
    Momentum: simple.models.momentum ? 2 : 0,
    "Mean Reversion": simple.models.meanReversion ? 2 : 0,
    Seasons: simple.models.seasons ? 2 : 0,
    "Time of Day": simple.models.timeOfDay ? 2 : 0,
    Fibonacci: simple.models.fibonacci ? 2 : 0,
    "Support / Resistance": simple.models.supportResistance ? 2 : 0,
  };

  // AI configuration - sensible defaults when enabled
  const aiConfig = simple.useAI
    ? {
        aiMethod: "knn" as const,
        useAI: true,
        kEntry: 21,
        kExit: 11,
        knnVoteMode: "distance" as const,
        confidenceThreshold: 60,
        aiLibrariesActive: ["core", "recent"],
      }
    : {
        aiMethod: "off" as const,
        useAI: false,
        kEntry: 21,
        kExit: 11,
        knnVoteMode: "distance" as const,
        confidenceThreshold: 60,
        aiLibrariesActive: [],
      };

  return {
    ...DEFAULT_FULL_SETTINGS,

    // Mapped from SimpleSettings
    chunkBars: simple.chunkBars,
    tpDollars,
    slDollars,
    dollarsPerMove,
    modelStates,
    ...aiConfig,
  };
}

/**
 * Maps full settings back to simple format.
 */
export function mapFullToSimple(full: FullAnalysisSettings): SimpleSettings {
  // Convert dollars back to pips using standard pip value ($10/pip)
  // Note: This won't be exact for BTC/indices but is a reasonable default
  const pipValue = 10;

  return {
    tpPips: Math.round(full.tpDollars / pipValue),
    slPips: Math.round(full.slDollars / pipValue),
    chunkBars: full.chunkBars,
    models: {
      momentum: (full.modelStates["Momentum"] ?? 0) > 0,
      meanReversion: (full.modelStates["Mean Reversion"] ?? 0) > 0,
      seasons: (full.modelStates["Seasons"] ?? 0) > 0,
      timeOfDay: (full.modelStates["Time of Day"] ?? 0) > 0,
      fibonacci: (full.modelStates["Fibonacci"] ?? 0) > 0,
      supportResistance: (full.modelStates["Support / Resistance"] ?? 0) > 0,
    },
    direction: "both",
    dateStart: null,
    dateEnd: null,
    useAI: full.useAI,
  };
}

/**
 * Count enabled models
 */
export function countEnabledModels(models: SimpleSettings["models"]): number {
  return Object.values(models).filter(Boolean).length;
}

/**
 * Get enabled model names
 */
export function getEnabledModelNames(models: SimpleSettings["models"]): string[] {
  return (Object.entries(models) as [ModelKey, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([key]) => MODEL_KEYS[key]);
}
