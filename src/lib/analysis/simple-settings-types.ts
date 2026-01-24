/**
 * Simplified Settings for Analysis
 *
 * Reduces 85+ parameters to 12 essential ones.
 * Maps to FullAnalysisSettings internally for worker compatibility.
 */

export interface SimpleSettings {
  // Trade Parameters (3)
  tpPips: number;
  slPips: number;
  chunkBars: number;

  // Model Toggles (6)
  models: {
    momentum: boolean;
    meanReversion: boolean;
    seasons: boolean;
    timeOfDay: boolean;
    fibonacci: boolean;
    supportResistance: boolean;
  };

  // Filters (3)
  direction: "long" | "short" | "both";
  dateStart: string | null;
  dateEnd: string | null;

  // AI (1)
  useAI: boolean;
}

export const DEFAULT_SIMPLE_SETTINGS: SimpleSettings = {
  tpPips: 30,
  slPips: 20,
  chunkBars: 16,
  models: {
    momentum: true,
    meanReversion: true,
    seasons: false,
    timeOfDay: false,
    fibonacci: false,
    supportResistance: false,
  },
  direction: "both",
  dateStart: null,
  dateEnd: null,
  useAI: false,
};

// Model key to display name mapping
export const MODEL_KEYS = {
  momentum: "Momentum",
  meanReversion: "Mean Reversion",
  seasons: "Seasons",
  timeOfDay: "Time of Day",
  fibonacci: "Fibonacci",
  supportResistance: "Support / Resistance",
} as const;

export type ModelKey = keyof SimpleSettings["models"];
