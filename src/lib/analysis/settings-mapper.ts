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

const PIPS_TO_DOLLARS = 100; // $100 per pip for major pairs

/**
 * Maps simplified settings to full worker format.
 */
export function mapSimpleToFull(simple: SimpleSettings): FullAnalysisSettings {
  // Convert pips to dollars
  const tpDollars = simple.tpPips * PIPS_TO_DOLLARS;
  const slDollars = simple.slPips * PIPS_TO_DOLLARS;

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
    dollarsPerMove: PIPS_TO_DOLLARS,
    modelStates,
    ...aiConfig,
  };
}

/**
 * Maps full settings back to simple format.
 */
export function mapFullToSimple(full: FullAnalysisSettings): SimpleSettings {
  const dollarsPerMove = full.dollarsPerMove || PIPS_TO_DOLLARS;

  return {
    tpPips: Math.round(full.tpDollars / dollarsPerMove),
    slPips: Math.round(full.slDollars / dollarsPerMove),
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
