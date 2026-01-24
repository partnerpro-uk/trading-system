// ============================================
// FULL ANALYSIS SETTINGS - 85+ CONFIGURABLE PARAMETERS
// Matches haji-project-data format exactly
// ============================================

// ============================================
// ENUMS AND CONSTANTS
// ============================================

export type AIMethod = "off" | "knn" | "hdbscan";
export type StopMode = "none" | "breakeven" | "trailing" | "both";
export type KnnVoteMode = "uniform" | "distance" | "pnl_weighted";
export type DimStyle = "recommended" | "manual" | "auto";
export type CompressionMethod = "pca" | "jl" | "none";
export type DistanceMetric = "euclidean" | "cosine" | "manhattan";
export type DimWeightMode = "uniform" | "pnl_scaled" | "confidence_scaled";
export type CalibrationMode = "none" | "isotonic" | "platt";
export type ValidationMode = "none" | "split" | "walkforward" | "kfold";
export type MetaMode = "off" | "stacking" | "voting";
export type HdbModalityDistinction = "real" | "conceptual" | "none";
export type FeatureMode = "individual" | "ensemble";
export type AiBulkScope = "active" | "all" | "none";
export type ModelState = 0 | 1 | 2; // 0=disabled, 1=entry only, 2=full

// ============================================
// LIBRARY SETTINGS
// ============================================

export interface LibrarySettings {
  weight: number;
  maxSamples: number;
  stride: number;
  // Optional per-library overrides
  tpDollars?: number;
  slDollars?: number;
  jumpToResolution?: boolean;
  windowTrades?: number;
  count?: number;
  pivotSpan?: number;
  model?: string;
  kind?: string;
}

export const DEFAULT_LIBRARY_SETTINGS: LibrarySettings = {
  weight: 100,
  maxSamples: 10000,
  stride: 0,
};

// All available libraries
export const LIBRARY_IDS = [
  "core",
  "suppressed",
  "recent",
  "base",
  "wins",
  "wins_tokyo",
  "wins_sydney",
  "wins_london",
  "wins_newyork",
  "terrific",
  "terrible",
  "momentum",
  "mean_reversion",
  "seasons",
  "time_of_day",
  "fibonacci",
  "support_resistance",
] as const;

export type LibraryId = (typeof LIBRARY_IDS)[number];

// ============================================
// FEATURE LEVELS AND MODES
// ============================================

export interface FeatureLevels {
  pricePath: number;
  rangeTrend: number;
  wicks: number;
  time: number;
  temporal: number;
  position: number;
  topography: number;
  mf__momentum__core: number;
  mf__mean_reversion__core: number;
  mf__seasons__core: number;
  mf__time_of_day__core: number;
  mf__fibonacci__core: number;
  mf__support_resistance__core: number;
  [key: string]: number;
}

export interface FeatureModes {
  pricePath: FeatureMode;
  rangeTrend: FeatureMode;
  wicks: FeatureMode;
  time: FeatureMode;
  temporal: FeatureMode;
  position: FeatureMode;
  topography: FeatureMode;
  mf__momentum__core: FeatureMode;
  mf__mean_reversion__core: FeatureMode;
  mf__seasons__core: FeatureMode;
  mf__time_of_day__core: FeatureMode;
  mf__fibonacci__core: FeatureMode;
  mf__support_resistance__core: FeatureMode;
  [key: string]: FeatureMode;
}

export const DEFAULT_FEATURE_LEVELS: FeatureLevels = {
  pricePath: 2,
  rangeTrend: 2,
  wicks: 2,
  time: 2,
  temporal: 2,
  position: 2,
  topography: 2,
  mf__momentum__core: 2,
  mf__mean_reversion__core: 2,
  mf__seasons__core: 2,
  mf__time_of_day__core: 2,
  mf__fibonacci__core: 2,
  mf__support_resistance__core: 2,
};

export const DEFAULT_FEATURE_MODES: FeatureModes = {
  pricePath: "ensemble",
  rangeTrend: "ensemble",
  wicks: "ensemble",
  time: "ensemble",
  temporal: "ensemble",
  position: "ensemble",
  topography: "ensemble",
  mf__momentum__core: "individual",
  mf__mean_reversion__core: "individual",
  mf__seasons__core: "individual",
  mf__time_of_day__core: "individual",
  mf__fibonacci__core: "individual",
  mf__support_resistance__core: "individual",
};

// ============================================
// MODEL STATES
// ============================================

export interface ModelStates {
  "Momentum": ModelState;
  "Mean Reversion": ModelState;
  "Seasons": ModelState;
  "Time of Day": ModelState;
  "Fibonacci": ModelState;
  "Support / Resistance": ModelState;
  [key: string]: ModelState;
}

export const DEFAULT_MODEL_STATES: ModelStates = {
  "Momentum": 2,
  "Mean Reversion": 2,
  "Seasons": 2,
  "Time of Day": 2,
  "Fibonacci": 2,
  "Support / Resistance": 2,
};

// ============================================
// TIME FILTERS
// ============================================

export interface EnabledSessions {
  Tokyo: boolean;
  London: boolean;
  "New York": boolean;
  Sydney: boolean;
}

export interface EnabledMonths {
  [month: string]: boolean; // "0" to "11"
}

export interface EnabledDows {
  [dow: string]: boolean; // "0" to "6" (Sunday to Saturday)
}

export interface EnabledHours {
  [hour: string]: boolean; // "0" to "23"
}

export interface EnabledYears {
  [year: string]: boolean; // e.g., "2023", "2024", "2025"
}

export const DEFAULT_ENABLED_SESSIONS: EnabledSessions = {
  Tokyo: true,
  London: true,
  "New York": true,
  Sydney: true,
};

export const DEFAULT_ENABLED_MONTHS: EnabledMonths = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i), true])
);

export const DEFAULT_ENABLED_DOWS: EnabledDows = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [String(i), true])
);

export const DEFAULT_ENABLED_HOURS: EnabledHours = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [String(i), true])
);

export const DEFAULT_ENABLED_YEARS: EnabledYears = {
  "2023": true,
  "2024": true,
  "2025": true,
  "2026": true,
};

// ============================================
// FULL SETTINGS INTERFACE
// ============================================

export interface FullAnalysisSettings {
  // ========== Version ==========
  version: number;

  // ========== Trade Parameters ==========
  chunkBars: number;
  tpDollars: number;
  slDollars: number;
  dollarsPerMove: number;

  // ========== Trade Limits ==========
  maxTradesPerDay: number;
  cooldownBars: number;
  maxConcurrentTrades: number;
  maxBarsInTrade: number;

  // ========== Stop Management ==========
  stopMode: number; // 0=none, 1=breakeven, 2=trailing, 3=both
  stopTriggerPct: number;
  breakEvenTriggerPct: number;
  trailingStartPct: number;
  trailingDistPct: number;

  // ========== AI Core ==========
  useAI: boolean;
  aiMethod: AIMethod;
  checkEveryBar: boolean;

  // ========== HDBSCAN Parameters ==========
  hdbMinClusterSize: number;
  hdbMinSamples: number;
  hdbEpsQuantile: number;
  hdbSampleCap: number;
  hdbModalityDistinction: HdbModalityDistinction;

  // ========== KNN Parameters ==========
  kEntry: number;
  kExit: number;
  knnVoteMode: KnnVoteMode;

  // ========== Confidence & Exit ==========
  confidenceThreshold: number;
  aiExitStrict: number;
  aiExitLossTol: number;
  aiExitWinTol: number;
  useMimExit: boolean;

  // ========== Dimensionality ==========
  complexity: number;
  dimStyle: DimStyle;
  dimManualAmount: number;
  compressionMethod: CompressionMethod;
  distanceMetric: DistanceMetric;
  dimWeightMode: DimWeightMode;
  dimWeightsBump: number;

  // ========== Calibration ==========
  calibrationMode: CalibrationMode;
  volatilityPercentile: number;

  // ========== Modalities ==========
  modalities: string[];
  remapOppositeOutcomes: boolean;

  // ========== Time Filters ==========
  enabledSessions: EnabledSessions;
  enabledMonths: EnabledMonths;
  enabledDows: EnabledDows;
  enabledHours: EnabledHours;
  enabledYears: EnabledYears;

  // ========== Models ==========
  modelStates: ModelStates;

  // ========== Features ==========
  featureLevels: FeatureLevels;
  featureModes: FeatureModes;

  // ========== Meta Learning ==========
  metaMode: MetaMode;

  // ========== Validation ==========
  antiCheatEnabled: boolean;
  validationMode: ValidationMode;
  preventAiLeak: boolean;
  realismLevel: number;

  // ========== Libraries ==========
  staticLibrariesClusters: boolean;
  aiLibrariesActive: string[];
  aiLibrariesSettings: Record<string, LibrarySettings>;
  aiSelectedLibrary: string;

  // ========== Bulk Library Operations ==========
  aiBulkScope: AiBulkScope;
  aiBulkWeight: number;
  aiBulkStride: number;
  aiBulkMaxSamples: number;
}

// ============================================
// DEFAULT SETTINGS
// ============================================

export const DEFAULT_FULL_SETTINGS: FullAnalysisSettings = {
  // Version
  version: 2,

  // Trade Parameters
  chunkBars: 16,
  tpDollars: 3000,
  slDollars: 1325,
  dollarsPerMove: 100,

  // Trade Limits
  maxTradesPerDay: 0,
  cooldownBars: 0,
  maxConcurrentTrades: 1,
  maxBarsInTrade: 0,

  // Stop Management
  stopMode: 0,
  stopTriggerPct: 50,
  breakEvenTriggerPct: 50,
  trailingStartPct: 50,
  trailingDistPct: 30,

  // AI Core
  useAI: false,
  aiMethod: "off",
  checkEveryBar: false,

  // HDBSCAN
  hdbMinClusterSize: 40,
  hdbMinSamples: 12,
  hdbEpsQuantile: 0.85,
  hdbSampleCap: 3000,
  hdbModalityDistinction: "conceptual",

  // KNN
  kEntry: 21,
  kExit: 11,
  knnVoteMode: "distance",

  // Confidence & Exit
  confidenceThreshold: 60,
  aiExitStrict: 0,
  aiExitLossTol: 0,
  aiExitWinTol: 0,
  useMimExit: false,

  // Dimensionality
  complexity: 75,
  dimStyle: "recommended",
  dimManualAmount: 24,
  compressionMethod: "jl",
  distanceMetric: "euclidean",
  dimWeightMode: "uniform",
  dimWeightsBump: 0,

  // Calibration
  calibrationMode: "none",
  volatilityPercentile: 0,

  // Modalities
  modalities: ["Direction"],
  remapOppositeOutcomes: true,

  // Time Filters
  enabledSessions: DEFAULT_ENABLED_SESSIONS,
  enabledMonths: DEFAULT_ENABLED_MONTHS,
  enabledDows: DEFAULT_ENABLED_DOWS,
  enabledHours: DEFAULT_ENABLED_HOURS,
  enabledYears: DEFAULT_ENABLED_YEARS,

  // Models
  modelStates: DEFAULT_MODEL_STATES,

  // Features
  featureLevels: DEFAULT_FEATURE_LEVELS,
  featureModes: DEFAULT_FEATURE_MODES,

  // Meta Learning
  metaMode: "off",

  // Validation
  antiCheatEnabled: false,
  validationMode: "split",
  preventAiLeak: false,
  realismLevel: 0,

  // Libraries
  staticLibrariesClusters: true,
  aiLibrariesActive: ["core"],
  aiLibrariesSettings: {
    core: { weight: 100, maxSamples: 10000, stride: 200 },
    suppressed: { weight: 100, maxSamples: 10000, stride: 0 },
    recent: { weight: 100, maxSamples: 10000, stride: 0, windowTrades: 1500 },
    base: { weight: 100, maxSamples: 10000, stride: 200, tpDollars: 250, slDollars: 250, jumpToResolution: true },
    wins: { weight: 100, maxSamples: 10000, stride: 0, tpDollars: 250, slDollars: 250, jumpToResolution: true },
    wins_tokyo: { weight: 100, maxSamples: 8000, stride: 0, tpDollars: 250, slDollars: 250, jumpToResolution: true },
    wins_sydney: { weight: 100, maxSamples: 8000, stride: 0, tpDollars: 250, slDollars: 250, jumpToResolution: true },
    wins_london: { weight: 100, maxSamples: 8000, stride: 0, tpDollars: 250, slDollars: 250, jumpToResolution: true },
    wins_newyork: { weight: 100, maxSamples: 8000, stride: 0, tpDollars: 250, slDollars: 250, jumpToResolution: true },
    terrific: { weight: 100, maxSamples: 10000, stride: 0, count: 500, pivotSpan: 4 },
    terrible: { weight: 100, maxSamples: 10000, stride: 0, count: 500, pivotSpan: 4 },
    momentum: { weight: 100, maxSamples: 10000, stride: 0, model: "Momentum", kind: "model_sim" },
    mean_reversion: { weight: 100, maxSamples: 10000, stride: 0, model: "Mean Reversion", kind: "model_sim" },
    seasons: { weight: 100, maxSamples: 10000, stride: 0, model: "Seasons", kind: "model_sim" },
    time_of_day: { weight: 100, maxSamples: 10000, stride: 0, model: "Time of Day", kind: "model_sim" },
    fibonacci: { weight: 100, maxSamples: 10000, stride: 0, model: "Fibonacci", kind: "model_sim" },
    support_resistance: { weight: 100, maxSamples: 10000, stride: 0, model: "Support / Resistance", kind: "model_sim" },
  },
  aiSelectedLibrary: "core",

  // Bulk Operations
  aiBulkScope: "active",
  aiBulkWeight: 100,
  aiBulkStride: 200,
  aiBulkMaxSamples: 10000,
};

// ============================================
// HAJI FORMAT WRAPPER
// ============================================

export interface HajiSettingsExport {
  version: number;
  exportedAt: string;
  data: FullAnalysisSettings;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

export function isHajiFormat(obj: unknown): obj is HajiSettingsExport {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "version" in obj &&
    "data" in obj &&
    typeof (obj as HajiSettingsExport).data === "object"
  );
}

export function extractSettings(imported: unknown): Partial<FullAnalysisSettings> {
  if (isHajiFormat(imported)) {
    return imported.data;
  }
  return imported as Partial<FullAnalysisSettings>;
}

export function createExport(settings: FullAnalysisSettings): HajiSettingsExport {
  return {
    version: settings.version,
    exportedAt: new Date().toISOString(),
    data: settings,
  };
}
