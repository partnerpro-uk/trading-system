// Trading Analysis Constants
// AI/ML algorithm parameters, model definitions, feature configs, and AI library settings

// Month and day abbreviations
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// AI/ML algorithm parameters
export const AI_EPS = 1e-8;
export const K_ENTRY = 21;
export const K_EXIT = 11;
export const SEED_LOOKAHEAD_BARS = 96;
export const SEED_STRIDE = 0; // 0 = evaluate every bar (matches normal trading when stride is 0)

// Trading model names
export const MODELS = [
  "Momentum",
  "Mean Reversion",
  "Seasons",
  "Time of Day",
  "Fibonacci",
  "Support / Resistance",
];

// Session defaults
export const DEFAULT_SESSIONS: Record<string, boolean> = {
  Tokyo: true,
  London: true,
  "New York": true,
  Sydney: true,
};

// Month labels and defaults
export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export const DEFAULT_MONTHS: Record<number, boolean> = (() => {
  const o: Record<number, boolean> = {};
  for (let i = 0; i < 12; i++) o[i] = true;
  return o;
})();

// Day of week labels and defaults
export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const DEFAULT_DOWS: Record<number, boolean> = (() => {
  const o: Record<number, boolean> = {};
  for (let i = 0; i < 7; i++) o[i] = true;
  return o;
})();

// Hour labels and defaults
export const HOUR_LABELS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0")
);

export const DEFAULT_HOURS: Record<number, boolean> = (() => {
  const o: Record<number, boolean> = {};
  for (let i = 0; i < 24; i++) o[i] = true;
  return o;
})();

// ============================================
// Feature Configuration
// ============================================

// Model-specific feature definitions
export const MODEL_FEATURE_DEFS_BY_MODEL: Record<
  string,
  { key: string; label: string; hint: string; model: string }[]
> = {
  Momentum: [
    {
      key: "mf__momentum__core",
      label: "Momentum Feature",
      hint: "trend, persistence, accel, drift",
      model: "Momentum",
    },
  ],
  "Mean Reversion": [
    {
      key: "mf__mean_reversion__core",
      label: "Mean Reversion Feature",
      hint: "z-score, crossings, overshoot, snapback",
      model: "Mean Reversion",
    },
  ],
  Seasons: [
    {
      key: "mf__seasons__core",
      label: "Seasons Feature",
      hint: "sin/cos TOD, DOY, + basic stats",
      model: "Seasons",
    },
  ],
  "Time of Day": [
    {
      key: "mf__time_of_day__core",
      label: "Time of Day Feature",
      hint: "sin/cos TOD + vol/accel hints",
      model: "Time of Day",
    },
  ],
  Fibonacci: [
    {
      key: "mf__fibonacci__core",
      label: "Fibonacci Feature",
      hint: "fib levels, pivots, touches",
      model: "Fibonacci",
    },
  ],
  "Support / Resistance": [
    {
      key: "mf__support_resistance__core",
      label: "S/R Feature",
      hint: "pivots, levels, volatility",
      model: "Support / Resistance",
    },
  ],
};

// Flatten model features
export const MODEL_FEATURE_DEFS_FLAT = Object.values(
  MODEL_FEATURE_DEFS_BY_MODEL
).flat();

// Base feature definitions
export const FEATURE_DEFS = [
  {
    key: "pricePath",
    label: "Price Path",
    hint: "OHLC/returns shape inside the window",
  },
  {
    key: "rangeTrend",
    label: "Range / Trend",
    hint: "window range + net trend",
  },
  { key: "wicks", label: "Wicks", hint: "wick vs body structure" },
  { key: "time", label: "Time", hint: "time-of-day / day-of-year cycles" },
  {
    key: "temporal",
    label: "Temporal",
    hint: "year/month/day-of-week/hour (explicit)",
  },
  {
    key: "position",
    label: "Position",
    hint: "fib/levels position + touches",
  },
  {
    key: "topography",
    label: "Topography",
    hint: "terrain/roughness: pivots, curvature, choppiness",
  },
];

// Combined feature definitions
export const ALL_FEATURE_DEFS = [...FEATURE_DEFS, ...MODEL_FEATURE_DEFS_FLAT];

// Feature level labels
export const FEATURE_LEVEL_LABEL: Record<number, string> = {
  0: "None",
  1: "Very Light",
  2: "Light",
  3: "Heavy",
  4: "Very Heavy",
};

// How many dimensions each feature family contributes at each level (0..4)
export const FEATURE_LEVEL_TAKES: Record<string, number[]> = {
  pricePath: [0, 6, 14, 28, 60],
  rangeTrend: [0, 2, 4, 6, 10],
  wicks: [0, 1, 2, 4, 6],
  time: [0, 2, 4, 6, 8],
  temporal: [0, 4, 8, 12, 16],
  position: [0, 2, 4, 6, 10],
  topography: [0, 3, 6, 9, 12],
  // Model Features
  mf__momentum__core: [0, 4, 8, 12, 16],
  mf__mean_reversion__core: [0, 4, 8, 12, 16],
  mf__seasons__core: [0, 4, 8, 12, 16],
  mf__time_of_day__core: [0, 4, 8, 12, 16],
  mf__fibonacci__core: [0, 4, 8, 12, 16],
  mf__support_resistance__core: [0, 4, 8, 12, 16],
};

// Explicit names for each sub-dimension
export const FEATURE_DIM_NAME_BANK: Record<string, string[]> = {
  pricePath: [
    "Return mean",
    "Return std",
    "Return max",
    "Return min",
    "Abs return sum",
    "Close position in range",
    "Trend (net return)",
    "Range (high-low)",
    "Body mean",
    "Upper wick mean",
    "Lower wick mean",
    "Bull candle fraction",
    "Bear candle fraction",
    "Reversal rate",
    "Chop ratio",
    "Last return",
    "First return",
    "Return p25",
    "Return p50",
    "Return p75",
  ],
  rangeTrend: [
    "Range (high-low)",
    "Trend (net return)",
    "Range/|Trend|",
    "Chop ratio",
    "Bull-Bear imbalance",
    "Abs return mean",
  ],
  wicks: [
    "Wick/body ratio",
    "Upper wick mean",
    "Lower wick mean",
    "Wick asymmetry",
    "Doji rate",
  ],
  time: [
    "sin(TOD)",
    "cos(TOD)",
    "sin(DOY)",
    "cos(DOY)",
    "TOD unit",
    "DOY unit",
    "Range + TOD",
    "Trend + DOY",
  ],
  temporal: [
    "Year offset",
    "Month",
    "Day of Month",
    "Day of Week",
    "Hour of Day",
    "Minute of Hour",
    "sin(Month)",
    "cos(Month)",
    "sin(DOW)",
    "cos(DOW)",
    "sin(Hour)",
    "cos(Hour)",
    "Weekend flag",
    "Night flag",
    "US session flag",
    "EU session flag",
  ],
  position: [
    "Close vs high",
    "Close vs low",
    "Mid-range position",
    "Upper touches",
    "Lower touches",
    "Near high",
    "Near low",
    "Breakout proxy",
    "False break proxy",
    "Range squeeze",
  ],
  topography: [
    "Pivot count",
    "Pivot rate",
    "Curvature mean",
    "Curvature std",
    "Choppiness index",
    "Smoothness",
    "Direction changes",
    "Avg run length",
    "Max run length",
    "Roughness score",
    "Slope variance",
    "Trend consistency",
  ],
  mf__momentum__core: [
    "Trend",
    "Persistence",
    "Accel",
    "Drift mean",
    "Drift std",
    "Last vs avg drift",
    "Range",
    "Chop ratio",
    "Bull fraction",
    "Bear fraction",
    "Position",
    "Reversal rate",
    "Strength",
    "Conviction",
    "Regime score",
    "Skew proxy",
  ],
  mf__mean_reversion__core: [
    "Z mean",
    "Z std",
    "Z max",
    "Z min",
    "Abs Z mean",
    "Crossings rate",
    "Last Z",
    "Mid Z",
    "Last-Mid Z",
    "Overshoot high",
    "Overshoot low",
    "Snapback proxy",
    "Wick score",
    "Chop ratio",
    "Range",
    "Trend",
  ],
  mf__seasons__core: [
    "sin(TOD)",
    "cos(TOD)",
    "sin(DOY)",
    "cos(DOY)",
    "DOY",
    "TOD",
    "Range",
    "Trend",
    "Abs return mean",
    "Abs return std",
    "Chop ratio",
    "Wick/body",
    "Bull fraction",
    "Bear fraction",
    "Reversal rate",
    "Position",
  ],
  mf__time_of_day__core: [
    "sin(TOD)",
    "cos(TOD)",
    "TOD",
    "Range",
    "Trend",
    "Abs return mean",
    "Abs return std",
    "Chop ratio",
    "Wick/body",
    "Bull fraction",
    "Bear fraction",
    "Reversal rate",
    "Position",
    "Last return",
    "Accel",
    "Vol burst",
  ],
  mf__fibonacci__core: [
    "p0-0.236",
    "p0-0.382",
    "p0-0.5",
    "p0-0.618",
    "p0-0.786",
    "p0-1.0",
    "Closest fib",
    "Fib zone",
    "Pivot count",
    "Upper pivots",
    "Lower pivots",
    "Touch count",
    "Range",
    "Trend",
    "Chop ratio",
    "Position",
  ],
  mf__support_resistance__core: [
    "Pivot count",
    "Upper pivots",
    "Lower pivots",
    "Pivot density",
    "Level touches",
    "Recent touch",
    "Level break",
    "Bounce score",
    "Range",
    "Trend",
    "Vol mean",
    "Vol std",
    "Bull fraction",
    "Bear fraction",
    "Reversal rate",
    "Position",
  ],
};

// Helper function to get take count for a feature at a given level
export function featureTakeCount(key: string, level: number | string): number {
  const lvl = Math.min(4, Math.max(0, Math.round(Number(level) || 0)));
  const steps = FEATURE_LEVEL_TAKES[key] || [0, 2, 4, 6, 8];
  const take = Number(steps[lvl] ?? 0) || 0;
  const bank = FEATURE_DIM_NAME_BANK[key];
  return bank && bank.length ? Math.min(take, bank.length) : take;
}

// ============================================
// AI Library Configuration
// ============================================

// Types for AI library definitions
export type AiLibraryFieldType = "boolean" | "number" | "select" | "text";

export type AiLibraryField = {
  key: string;
  label: string;
  type: AiLibraryFieldType;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
};

export type AiLibraryDef = {
  id: string;
  name: string;
  description: string;
  defaults: Record<string, unknown>;
  fields: AiLibraryField[];
};

// Base AI Library definitions
export const BASE_AI_LIBRARY_DEFS: AiLibraryDef[] = [
  {
    id: "core",
    name: "Online Learning",
    description: "",
    defaults: { weight: 100, maxSamples: 10000, stride: 0 },
    fields: [
      {
        key: "weight",
        label: "Weight (%)",
        type: "number",
        min: 0,
        max: 500,
        step: 5,
        help: "200% = 2× influence on neighbor votes.",
      },
      {
        key: "stride",
        label: "Stride",
        type: "number",
        min: 0,
        max: 5000,
        step: 1,
      },
      {
        key: "maxSamples",
        label: "Amount of Samples",
        type: "number",
        min: 0,
        max: 100000,
        step: 100,
        help: "Soft cap on the number of examples kept for this library.",
      },
    ],
  },
  {
    id: "suppressed",
    name: "Suppressed",
    description:
      "Trades rejected because AI confidence is below the entry threshold (training-only neighbors).",
    defaults: { weight: 100, maxSamples: 10000, stride: 0 },
    fields: [
      {
        key: "weight",
        label: "Weight (%)",
        type: "number",
        min: 0,
        max: 500,
        step: 5,
      },
      {
        key: "stride",
        label: "Stride",
        type: "number",
        min: 0,
        max: 5000,
        step: 1,
      },
      {
        key: "maxSamples",
        label: "Amount of Samples",
        type: "number",
        min: 0,
        max: 100000,
        step: 100,
      },
    ],
  },
  {
    id: "recent",
    name: "Recent Window",
    description: "",
    defaults: { weight: 100, windowTrades: 1500, maxSamples: 10000, stride: 0 },
    fields: [
      {
        key: "weight",
        label: "Weight (%)",
        type: "number",
        min: 0,
        max: 500,
        step: 5,
      },
      {
        key: "stride",
        label: "Stride",
        type: "number",
        min: 0,
        max: 5000,
        step: 1,
      },
      {
        key: "windowTrades",
        label: "Window (trades)",
        type: "number",
        min: 50,
        max: 200000,
        step: 50,
        help: "How many most-recent trades are eligible.",
      },
      {
        key: "maxSamples",
        label: "Amount of Samples",
        type: "number",
        min: 0,
        max: 100000,
        step: 100,
      },
    ],
  },
  {
    id: "base",
    name: "Base Seeding",
    description: "",
    defaults: {
      weight: 100,
      maxSamples: 10000,
      stride: 0,
      tpDollars: 250,
      slDollars: 250,
      jumpToResolution: true,
    },
    fields: [
      {
        key: "weight",
        label: "Weight (%)",
        type: "number",
        min: 0,
        max: 500,
        step: 5,
      },
      {
        key: "stride",
        label: "Stride",
        type: "number",
        min: 0,
        max: 5000,
        step: 1,
      },
      {
        key: "maxSamples",
        label: "Amount of Samples",
        type: "number",
        min: 0,
        max: 100000,
        step: 100,
      },
      {
        key: "tpDollars",
        label: "Seed TP ($)",
        type: "number",
        min: 10,
        max: 10000,
        step: 10,
      },
      {
        key: "slDollars",
        label: "Seed SL ($)",
        type: "number",
        min: 10,
        max: 10000,
        step: 10,
      },
      {
        key: "jumpToResolution",
        label: "Jump to resolution",
        type: "boolean",
        help: "Seed from exit bar instead of entry bar.",
      },
    ],
  },
  {
    id: "random",
    name: "Shuffled Seeding",
    description: "",
    defaults: {
      weight: 100,
      maxSamples: 10000,
      stride: 0,
      randomChance: 0.5,
      tpDollars: 250,
      slDollars: 250,
      jumpToResolution: true,
    },
    fields: [
      {
        key: "weight",
        label: "Weight (%)",
        type: "number",
        min: 0,
        max: 500,
        step: 5,
      },
      {
        key: "stride",
        label: "Stride",
        type: "number",
        min: 0,
        max: 5000,
        step: 1,
      },
      {
        key: "randomChance",
        label: "Pick chance",
        type: "number",
        min: 0,
        max: 1,
        step: 0.05,
        help: "Probability each bar is picked as a seed.",
      },
      {
        key: "maxSamples",
        label: "Amount of Samples",
        type: "number",
        min: 0,
        max: 100000,
        step: 100,
      },
      {
        key: "tpDollars",
        label: "Seed TP ($)",
        type: "number",
        min: 10,
        max: 10000,
        step: 10,
      },
      {
        key: "slDollars",
        label: "Seed SL ($)",
        type: "number",
        min: 10,
        max: 10000,
        step: 10,
      },
      {
        key: "jumpToResolution",
        label: "Jump to resolution",
        type: "boolean",
        help: "Seed from exit bar instead of entry bar.",
      },
    ],
  },
];

// Helper to create a slug from library name
export const slugLibraryId = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Model-specific AI Library definitions (one per model)
export const MODEL_AI_LIBRARY_DEFS: AiLibraryDef[] = MODELS.map((model) => {
  const slug = slugLibraryId(model);

  const baseFields: AiLibraryField[] = [
    {
      key: "weight",
      label: "Weight (%)",
      type: "number",
      min: 0,
      max: 500,
      step: 5,
      help: "200% = 2× influence on neighbor votes.",
    },
    {
      key: "stride",
      label: "Stride",
      type: "number",
      min: 0,
      max: 5000,
      step: 1,
    },
    {
      key: "maxSamples",
      label: "Amount of Samples",
      type: "number",
      min: 0,
      max: 100000,
      step: 100,
      help: "Caps how many examples are pulled from this library.",
    },
  ];

  return {
    id: `${slug}`,
    name: `${model}`,
    description: "",
    defaults: {
      weight: 100,
      maxSamples: 10000,
      stride: 0,
      model,
      kind: "model_sim",
    },
    fields: baseFields,
  };
});

// Combined library definitions
export const AI_LIBRARY_DEFS: AiLibraryDef[] = [
  ...BASE_AI_LIBRARY_DEFS,
  ...MODEL_AI_LIBRARY_DEFS,
];

// Lookup map by ID
export const AI_LIBRARY_DEF_BY_ID: Record<string, AiLibraryDef> =
  AI_LIBRARY_DEFS.reduce((acc, d) => {
    acc[d.id] = d;
    return acc;
  }, {} as Record<string, AiLibraryDef>);

// Default settings for each library
export const DEFAULT_AI_LIBRARY_SETTINGS: Record<string, Record<string, unknown>> =
  AI_LIBRARY_DEFS.reduce(
    (acc, d) => {
      acc[d.id] = { ...(d.defaults || {}) };
      return acc;
    },
    {} as Record<string, Record<string, unknown>>
  );
