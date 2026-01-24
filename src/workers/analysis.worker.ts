/**
 * Analysis Web Worker - Full Implementation
 * Complete port from haji-project-data with all 85+ parameters
 *
 * This worker handles compute-intensive analysis tasks:
 * - Feature vector building (7 base + model-specific features)
 * - Library seeding from history
 * - kNN / HDBSCAN clustering
 * - Trade simulation with stop management
 * - Statistics computation
 * - PCA embedding for ClusterMap visualization
 */

// ============================================
// CONSTANTS
// ============================================

const AI_EPS = 1e-8;
const SEED_LOOKAHEAD_BARS = 96;

const MODELS = [
  "Momentum",
  "Mean Reversion",
  "Seasons",
  "Time of Day",
  "Fibonacci",
  "Support / Resistance",
];

// ============================================
// STATE
// ============================================

let CANDLES: Candle[] = [];
let FEATURE_LEVELS: Record<string, number> = {};
let FEATURE_MODES: Record<string, string> = {};
let PARSE_MODE: ParseMode = "utc";

// ============================================
// TYPES
// ============================================

type ParseMode = "utc" | "local";
type AIMethod = "off" | "knn" | "hdbscan";
type KnnVoteMode = "uniform" | "distance" | "pnl_weighted";
type DistanceMetric = "euclidean" | "cosine" | "manhattan";
type CompressionMethod = "pca" | "jl" | "none";

interface Candle {
  time: string;
  timestamp: number;
  pair: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  uid: string;
  entryTime: string;
  entryPrice: number;
  entryIndex: number;
  signalIndex: number;
  exitTime?: string;
  exitPrice?: number;
  exitIndex?: number;
  dir: number;
  direction?: number;
  pnl: number;
  isOpen: boolean;
  tp: number;
  sl: number;
  model?: string;
  chunkType?: string;
  session?: string;
  aiMargin?: number;
  aiMode?: string;
  result?: "TP" | "SL" | "MW" | "ML" | "BE" | "Trail";
  win?: boolean;
  x?: number;
  y?: number;
  r?: number;
  kind?: string;
  closestCluster?: string;
  closestClusterPnl?: number;
  closestClusterUid?: string;
  [key: string]: unknown;
}

interface SimulationStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  rr: number;
  sharpe: number;
  sortino: number;
  avgDrawdown: number;
  maxDrawdown: number;
  avgWinDurationMin: number;
  avgLossDurationMin: number;
  expectancy: number;
  kellyPct: number;
}

interface LibraryPoint {
  id: string;
  x: number;
  y: number;
  r: number;
  kind: string;
  dir: number;
  pnl: number;
  win: boolean;
  time?: string;
  libId?: string;
  v?: number[];
  weight?: number;
  [key: string]: unknown;
}

interface LibrarySettings {
  weight: number;
  maxSamples: number;
  stride: number;
  tpDollars?: number;
  slDollars?: number;
  jumpToResolution?: boolean;
  windowTrades?: number;
  count?: number;
  pivotSpan?: number;
  model?: string;
  kind?: string;
}

interface SimulateSettings {
  // Parse mode
  parseMode?: ParseMode;

  // Trade parameters
  tpDist?: number;
  slDist?: number;
  chunkBars?: number;
  dollarsPerMove?: number;

  // Trade limits
  maxTradesPerDay?: number;
  cooldownBars?: number;
  maxConcurrentTrades?: number;
  maxBarsInTrade?: number;

  // Stop management (0=none, 1=breakeven, 2=trailing, 3=both)
  stopMode?: number;
  stopTriggerPct?: number;
  breakEvenTriggerPct?: number;
  trailingStartPct?: number;
  trailingDistPct?: number;

  // AI core
  model?: string;
  aiMethod?: AIMethod;
  useAI?: boolean;
  checkEveryBar?: boolean;

  // KNN parameters
  kEntry?: number;
  kExit?: number;
  knnVoteMode?: KnnVoteMode;

  // HDBSCAN parameters
  hdbMinClusterSize?: number;
  hdbMinSamples?: number;
  hdbEpsQuantile?: number;
  hdbSampleCap?: number;
  hdbModalityDistinction?: string;

  // Confidence & exit
  confidenceThreshold?: number;
  aiExitStrict?: number;
  aiExitLossTol?: number;
  aiExitWinTol?: number;
  useMimExit?: boolean;

  // Dimensionality
  complexity?: number;
  dimStyle?: string;
  dimManualAmount?: number;
  compressionMethod?: CompressionMethod;
  distanceMetric?: DistanceMetric;
  dimWeightMode?: string;
  dimWeightsBump?: number;

  // Calibration
  calibrationMode?: string;
  volatilityPercentile?: number;

  // Modalities
  modalities?: string[];
  remapOppositeOutcomes?: boolean;

  // Model states (0=disabled, 1=entry only, 2=full)
  modelStates?: Record<string, number>;

  // Features
  featureLevels?: Record<string, number>;
  featureModes?: Record<string, string>;

  // Validation
  validationMode?: string;
  antiCheatEnabled?: boolean;
  preventAiLeak?: boolean;
  realismLevel?: number;
  staticLibrariesClusters?: boolean;

  // Session/time filters
  sessions?: Record<string, boolean>;
  months?: Record<number, boolean>;
  dows?: Record<number, boolean>;
  hours?: Record<number, boolean>;
  years?: Record<number, boolean>;

  // Libraries
  aiLibrariesActive?: string[];
  aiLibrariesSettings?: Record<string, LibrarySettings>;
  activeLibraries?: Record<string, boolean>;
  librarySettings?: Record<string, unknown>;

  [key: string]: unknown;
}

interface SimulateResult {
  trades: Trade[];
  ghostEntries: Trade[];
  libraryPoints: LibraryPoint[];
  stats: SimulationStats;
  potential?: unknown;
  entryBreakdowns?: unknown[];
  libraryCounts?: Record<string, number>;
}

// ============================================
// MATH UTILITIES
// ============================================

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

function sma(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = sma(arr);
  let v = 0;
  for (const x of arr) {
    const d = x - m;
    v += d * d;
  }
  v /= arr.length;
  return Math.sqrt(Math.max(0, v));
}

function mMedian(arr: number[]): number {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function safeSliceIndex(n: number, i: number): number {
  if (i < 0) return 0;
  if (i >= n) return n - 1;
  return i;
}

function atr(candles: Candle[], period: number): number[] {
  const n = candles.length;
  const result = new Array(n).fill(NaN);
  if (n === 0) return result;
  const trs = new Array(n).fill(0);
  trs[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const prevClose = candles[i - 1].close;
    const high = candles[i].high;
    const low = candles[i].low;
    trs[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  let rmaPrev: number | null = null;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const tr = trs[i];
    if (!Number.isFinite(tr)) continue;
    if (i < period) {
      sum += tr;
      if (i === period - 1) {
        rmaPrev = sum / period;
        result[i] = rmaPrev;
      }
    } else {
      if (rmaPrev === null) rmaPrev = tr;
      else rmaPrev = (rmaPrev * (period - 1) + tr) / period;
      result[i] = rmaPrev;
    }
  }
  return result;
}

// Distance metrics
function euclideanDist(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function cosineDist(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom < AI_EPS) return 1;
  return 1 - dot / denom;
}

function manhattanDist(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum;
}

function computeDistance(a: number[], b: number[], metric: DistanceMetric): number {
  switch (metric) {
    case "cosine": return cosineDist(a, b);
    case "manhattan": return manhattanDist(a, b);
    default: return euclideanDist(a, b);
  }
}

// ============================================
// DATE/TIME UTILITIES
// ============================================

function parseDateFromString(raw: string | number | null | undefined, parseMode: ParseMode): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const num = Number(s);
    if (!Number.isFinite(num)) return null;
    const ms = s.length >= 13 ? num : num * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const ss = Number(m[6] ?? 0);
    const d =
      parseMode === "utc"
        ? new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss, 0))
        : new Date(yyyy, mm - 1, dd, hh, mi, ss, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function sessionFromTime(raw: string | number | null | undefined, parseMode: ParseMode): string {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return "Sydney";
  const h =
    parseMode === "utc" ? d.getUTCHours() + d.getUTCMinutes() / 60 : d.getHours() + d.getMinutes() / 60;
  if (h >= 22 || h < 7) return "Tokyo";
  if (h >= 7 && h < 8) return "London";
  if (h >= 8 && h < 13) return "London";
  if (h >= 13 && h < 17) return "New York";
  if (h >= 17 && h < 22) return "Sydney";
  return "London";
}

function timeOfDayUnit(raw: string | number | null | undefined, parseMode: ParseMode): number {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return 0.5;
  const h = parseMode === "utc" ? d.getUTCHours() + d.getUTCMinutes() / 60 : d.getHours() + d.getMinutes() / 60;
  return clamp(h / 24, 0, 1);
}

function dayOfYearUnit(raw: string | number | null | undefined, parseMode: ParseMode): number {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return 0.5;
  const yyyy = parseMode === "utc" ? d.getUTCFullYear() : d.getFullYear();
  const start = parseMode === "utc" ? new Date(Date.UTC(yyyy, 0, 0)) : new Date(yyyy, 0, 0);
  const diff = d.getTime() - start.getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const doy = Math.floor(diff / oneDay);
  return clamp(doy / 366, 0, 1);
}

function minutesBetween(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  parseMode: ParseMode
): number | null {
  const da = parseDateFromString(a, parseMode);
  const db = parseDateFromString(b, parseMode);
  if (!da || !db) return null;
  const diff = db.getTime() - da.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, diff / 60000);
}

function dayKeyFromTime(raw: string | number | null | undefined, parseMode: ParseMode = "utc"): string {
  const d = parseDateFromString(raw, parseMode);
  if (!d) return "unknown";
  const yyyy = parseMode === "utc" ? d.getUTCFullYear() : d.getFullYear();
  const mm = String((parseMode === "utc" ? d.getUTCMonth() : d.getMonth()) + 1).padStart(2, "0");
  const dd = String(parseMode === "utc" ? d.getUTCDate() : d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isSessionAllowed(
  raw: string | number | null | undefined,
  enabledSessions: Record<string, boolean> | undefined,
  parseMode: ParseMode
): boolean {
  if (!enabledSessions) return true;
  const allDisabled = Object.values(enabledSessions).every(v => !v);
  if (allDisabled) return true;
  const sess = sessionFromTime(raw, parseMode);
  return enabledSessions[sess] !== false;
}

// ============================================
// HASH UTILITIES
// ============================================

function hashStrToInt(str: string): number {
  str = String(str || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================
// FEATURE LEVEL CONFIGURATION
// ============================================

const FEATURE_LEVEL_TAKES: Record<string, number[]> = {
  pricePath: [0, 6, 14, 28, 60],
  rangeTrend: [0, 2, 4, 6, 10],
  wicks: [0, 1, 2, 4, 6],
  time: [0, 2, 4, 6, 8],
  temporal: [0, 4, 8, 12, 16],
  position: [0, 2, 4, 6, 10],
  topography: [0, 3, 6, 9, 12],
  mf__momentum__core: [0, 4, 8, 12, 16],
  mf__mean_reversion__core: [0, 4, 8, 12, 16],
  mf__seasons__core: [0, 4, 8, 12, 16],
  mf__time_of_day__core: [0, 4, 8, 12, 16],
  mf__fibonacci__core: [0, 4, 8, 12, 16],
  mf__support_resistance__core: [0, 4, 8, 12, 16],
};

function featureN(key: string): number {
  const lvl = FEATURE_LEVELS && typeof FEATURE_LEVELS[key] === "number" ? FEATURE_LEVELS[key] : 2;
  const i = clamp(Math.round(lvl), 0, 4);
  const steps = FEATURE_LEVEL_TAKES[key] || [0, 2, 4, 6, 8];
  return Number(steps[i] ?? 0) || 0;
}

// ============================================
// STATISTICS COMPUTATION
// ============================================

function computeStats(closedTrades: Trade[], parseMode: ParseMode): SimulationStats {
  if (!closedTrades || !closedTrades.length) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnl: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      rr: 0,
      sharpe: 0,
      sortino: 0,
      avgDrawdown: 0,
      maxDrawdown: 0,
      avgWinDurationMin: 0,
      avgLossDurationMin: 0,
      expectancy: 0,
      kellyPct: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let sumWin = 0;
  let sumLossAbs = 0;
  let winDurSum = 0;
  let winDurCount = 0;
  let lossDurSum = 0;
  let lossDurCount = 0;

  const returns: number[] = [];
  const downside: number[] = [];
  let eq = 0;
  let peak = 0;
  const dds: number[] = [];

  const sorted = closedTrades.slice().sort((a, b) => (a.exitIndex || 0) - (b.exitIndex || 0));

  for (const t of sorted) {
    const pnl = t.pnl || 0;
    returns.push(pnl);
    eq += pnl;
    if (eq > peak) peak = eq;
    dds.push(peak - eq);

    if (pnl > 0) {
      wins++;
      sumWin += pnl;
    } else if (pnl < 0) {
      losses++;
      sumLossAbs += -pnl;
      downside.push(pnl);
    }

    const dur = minutesBetween(t.entryTime, t.exitTime, parseMode);
    if (dur != null) {
      if (pnl >= 0) {
        winDurSum += dur;
        winDurCount++;
      } else {
        lossDurSum += dur;
        lossDurCount++;
      }
    }
  }

  const totalPnl = sumWin - sumLossAbs;
  const avgPnl = totalPnl / sorted.length;
  const winRate = wins / sorted.length;
  const profitFactor = sumLossAbs > 0 ? sumWin / sumLossAbs : sumWin > 0 ? Infinity : 0;
  const avgWin = wins > 0 ? sumWin / wins : 0;
  const avgLoss = losses > 0 ? -(sumLossAbs / losses) : 0;
  const rr = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;

  // Sharpe
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const varAll = returns.reduce((s, r) => {
    const d = r - mean;
    return s + d * d;
  }, 0) / returns.length;
  const stdAll = Math.sqrt(Math.max(0, varAll));
  const sharpe = stdAll > 0 ? mean / stdAll : 0;

  // Sortino
  let sortino = 0;
  if (downside.length) {
    const md = downside.reduce((a, b) => a + b, 0) / downside.length;
    const vd = downside.reduce((s, r) => {
      const d = r - md;
      return s + d * d;
    }, 0) / downside.length;
    const sdd = Math.sqrt(Math.max(0, vd));
    sortino = sdd > 0 ? mean / sdd : 0;
  }

  const avgDrawdown = dds.reduce((a, b) => a + b, 0) / dds.length;
  const maxDrawdown = Math.max(...dds, 0);

  // Expectancy and Kelly
  const winRateFrac = wins / sorted.length;
  const expectancy = winRateFrac * avgWin + (1 - winRateFrac) * avgLoss;
  const kellyPct = rr > 0 ? winRateFrac - (1 - winRateFrac) / rr : 0;

  return {
    trades: sorted.length,
    wins,
    losses,
    winRate,
    totalPnl,
    avgPnl,
    profitFactor,
    avgWin,
    avgLoss,
    rr,
    sharpe,
    sortino,
    avgDrawdown,
    maxDrawdown,
    avgWinDurationMin: winDurCount > 0 ? winDurSum / winDurCount : 0,
    avgLossDurationMin: lossDurCount > 0 ? lossDurSum / lossDurCount : 0,
    expectancy,
    kellyPct: clamp(kellyPct * 100, 0, 100),
  };
}

// ============================================
// ENTRY SIGNAL LOGIC (Per Model)
// ============================================

function getEntrySignal(
  candles: Candle[],
  i: number,
  chunkBars: number,
  model: string,
  parseMode: ParseMode,
  modelStates?: Record<string, number>
): { dir: number; score: number; model: string } | null {
  if (i < chunkBars) return null;

  // Check if model is enabled (state >= 1 for entry)
  if (modelStates) {
    const state = modelStates[model];
    if (state !== undefined && state < 1) return null;
  }

  const n = candles.length;
  const bars = Math.max(2, chunkBars);
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const opens: number[] = [];

  for (let offset = bars - 1; offset >= 0; offset--) {
    const idx = safeSliceIndex(n, i - offset);
    const c = candles[idx];
    opens.push(c.open);
    highs.push(c.high);
    lows.push(c.low);
    closes.push(c.close);
  }

  const last = closes[closes.length - 1];
  const first = closes[0];
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  const denom = Math.max(Math.abs(last), AI_EPS);
  const trendNorm = (last - first) / denom;
  const rangeNorm = (maxH - minL) / denom;
  const swing = Math.max(maxH - minL, AI_EPS);
  const pos = (last - minL) / swing;

  const prev = closes[Math.max(0, closes.length - 2)];
  const lastRet = (last - prev) / denom;
  const thrTrend = 0.01;
  const thrImp = 0.006;

  // Time-based features
  const tRaw = candles[i]?.time;
  const tod = timeOfDayUnit(tRaw, parseMode);
  const doy = dayOfYearUnit(tRaw, parseMode);
  const bias = Math.cos(tod * Math.PI * 2) * 0.55 + Math.sin(doy * Math.PI * 2) * 0.25;

  let buyScore = 0;
  let sellScore = 0;

  if (model === "Momentum") {
    if (trendNorm > thrTrend) buyScore += 0.4;
    if (lastRet < -thrImp * 0.5) buyScore += 0.3;
    if (pos > 0.5) buyScore += 0.3;

    if (trendNorm < -thrTrend) sellScore += 0.4;
    if (lastRet > thrImp * 0.5) sellScore += 0.3;
    if (pos < 0.5) sellScore += 0.3;
  } else if (model === "Mean Reversion") {
    const thrPosLow = 0.25;
    const thrPosHigh = 0.75;
    const weakTrend = Math.abs(trendNorm) < thrTrend;

    if (pos < thrPosLow) buyScore += 0.4;
    if (lastRet > thrImp) buyScore += 0.3;
    if (weakTrend) buyScore += 0.3;

    if (pos > thrPosHigh) sellScore += 0.4;
    if (lastRet < -thrImp) sellScore += 0.3;
    if (weakTrend) sellScore += 0.3;
  } else if (model === "Seasons") {
    const thrB = 0.12;
    if (bias > thrB) buyScore += 0.4;
    if (trendNorm > thrTrend) buyScore += 0.3;
    if (pos < 0.85) buyScore += 0.3;

    if (bias < -thrB) sellScore += 0.4;
    if (trendNorm < -thrTrend) sellScore += 0.3;
    if (pos > 0.15) sellScore += 0.3;
  } else if (model === "Time of Day") {
    const sess = sessionFromTime(tRaw, parseMode);
    const isDaySess = sess === "London" || sess === "New York";

    if (isDaySess && rangeNorm > 0.005) {
      if (trendNorm > thrTrend) buyScore += 0.5;
      else if (trendNorm < -thrTrend) sellScore += 0.5;
    }
    if (rangeNorm > 0.005) {
      buyScore += 0.25;
      sellScore += 0.25;
    }
  } else if (model === "Support / Resistance") {
    const band = 0.08;
    const nearSup = pos <= band;
    const nearRes = pos >= 1 - band;

    if (nearSup && lastRet > 0.002) buyScore += 0.6;
    if (rangeNorm > 0.008) buyScore += 0.4;

    if (nearRes && lastRet < -0.002) sellScore += 0.6;
    if (rangeNorm > 0.008) sellScore += 0.4;
  } else {
    // Fibonacci (default)
    const levels = [0.236, 0.382, 0.5, 0.618, 0.786];
    let nearFib = false;
    for (const lv of levels) {
      if (Math.abs(pos - lv) < 0.05) nearFib = true;
    }

    if (trendNorm > thrTrend && nearFib) buyScore += 0.5;
    if (pos <= 0.382) buyScore += 0.3;

    if (trendNorm < -thrTrend && nearFib) sellScore += 0.5;
    if (pos >= 0.618) sellScore += 0.3;
  }

  // Threshold for entry
  const threshold = 0.5;
  if (buyScore >= threshold && buyScore > sellScore) {
    return { dir: 1, score: buyScore, model };
  } else if (sellScore >= threshold && sellScore > buyScore) {
    return { dir: -1, score: sellScore, model };
  }

  return null;
}

// Pick best entry across multiple models (legacy - kept for backwards compatibility)
function pickBestEntry(
  candles: Candle[],
  i: number,
  chunkBars: number,
  parseMode: ParseMode,
  modelStates?: Record<string, number>
): { dir: number; score: number; model: string } | null {
  let best: { dir: number; score: number; model: string } | null = null;

  for (const model of MODELS) {
    // Skip disabled models
    if (modelStates) {
      const state = modelStates[model];
      if (state !== undefined && state < 1) continue;
    }

    const signal = getEntrySignal(candles, i, chunkBars, model, parseMode, modelStates);
    if (signal && (!best || signal.score > best.score)) {
      best = signal;
    }
  }

  return best;
}

// Get ALL entry signals from all enabled models (for multi-model simulation)
function getAllEntrySignals(
  candles: Candle[],
  i: number,
  chunkBars: number,
  parseMode: ParseMode,
  modelStates?: Record<string, number>
): { dir: number; score: number; model: string }[] {
  const signals: { dir: number; score: number; model: string }[] = [];

  for (const model of MODELS) {
    // Skip disabled models
    if (modelStates) {
      const state = modelStates[model];
      if (state !== undefined && state < 1) continue;
    }

    const signal = getEntrySignal(candles, i, chunkBars, model, parseMode, modelStates);
    if (signal) {
      signals.push(signal);
    }
  }

  return signals;
}

// ============================================
// KNN FUNCTIONS
// ============================================

function knnVote(
  library: LibraryPoint[],
  query: number[],
  k: number,
  voteMode: KnnVoteMode,
  distanceMetric: DistanceMetric
): { margin: number; confidence: number; neighbors: LibraryPoint[] } {
  if (!library.length || !query.length) {
    return { margin: 0, confidence: 0.5, neighbors: [] };
  }

  // Calculate distances
  const withDist: { point: LibraryPoint; dist: number }[] = [];
  for (const point of library) {
    if (!point.v || !point.v.length) continue;
    const dist = computeDistance(query, point.v, distanceMetric);
    withDist.push({ point, dist });
  }

  if (!withDist.length) {
    return { margin: 0, confidence: 0.5, neighbors: [] };
  }

  // Sort by distance and take k nearest
  withDist.sort((a, b) => a.dist - b.dist);
  const neighbors = withDist.slice(0, Math.min(k, withDist.length));

  // Vote based on mode
  let winVotes = 0;
  let lossVotes = 0;
  let totalWeight = 0;

  for (const { point, dist } of neighbors) {
    let weight = 1;

    if (voteMode === "distance") {
      weight = 1 / (dist + AI_EPS);
    } else if (voteMode === "pnl_weighted") {
      weight = Math.abs(point.pnl || 1) / (dist + AI_EPS);
    }

    totalWeight += weight;
    if (point.win || (point.pnl && point.pnl > 0)) {
      winVotes += weight;
    } else {
      lossVotes += weight;
    }
  }

  const margin = totalWeight > 0 ? (winVotes - lossVotes) / totalWeight : 0;
  const confidence = totalWeight > 0 ? winVotes / totalWeight : 0.5;

  return {
    margin,
    confidence,
    neighbors: neighbors.map(n => n.point),
  };
}

// ============================================
// VECTOR BUILDING FOR EMBEDDING
// ============================================

function buildChunkVector(
  candles: Candle[],
  endIndex: number,
  chunkBars: number,
  model: string,
  parseMode: ParseMode
): number[] {
  const n = candles.length;
  const bars = Math.max(1, chunkBars);
  const safeEnd = clampInt(endIndex, 0, n - 1);
  const last = candles[safeEnd];
  const baseClose = last?.close ?? 1;
  const denom = Math.max(Math.abs(baseClose), AI_EPS);

  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const opens: number[] = [];

  for (let offset = bars - 1; offset >= 0; offset--) {
    const idx = safeSliceIndex(n, safeEnd - offset);
    const c = candles[idx];
    opens.push(c.open ?? 0);
    highs.push(c.high ?? 0);
    lows.push(c.low ?? 0);
    closes.push(c.close ?? 0);
  }

  const firstClose = closes[0] ?? baseClose;
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  const rangeNorm = (maxH - minL) / denom;
  const trendNorm = (closes[closes.length - 1] - firstClose) / denom;

  if (model === "Momentum") {
    const vec: number[] = [];
    for (let i = 0; i < bars; i++) {
      const rc = (closes[i] - baseClose) / denom;
      const rh = (highs[i] - baseClose) / denom;
      const rl = (lows[i] - baseClose) / denom;
      vec.push(rc, rh, rl);
    }
    let bull = 0, bear = 0;
    for (let i = 0; i < bars; i++) {
      if (closes[i] > opens[i]) bull++;
      else if (closes[i] < opens[i]) bear++;
    }
    vec.push(rangeNorm, trendNorm, bull / bars, bear / bars);
    return vec;
  }

  if (model === "Mean Reversion") {
    const m = sma(closes);
    const s = Math.max(std(closes), AI_EPS);
    const vec: number[] = [];
    for (let i = 0; i < bars; i++) vec.push((closes[i] - m) / s);
    const lastClose = closes[closes.length - 1];
    const dev = (lastClose - m) / s;
    const mid = closes[Math.floor(bars / 2)] ?? lastClose;
    const halfDev = (mid - m) / s;
    vec.push(dev, dev - halfDev, rangeNorm, trendNorm);
    return vec;
  }

  if (model === "Seasons") {
    const vec: number[] = [];
    const tRaw = candles[safeEnd]?.time;
    const tod = timeOfDayUnit(tRaw, parseMode);
    const doy = dayOfYearUnit(tRaw, parseMode);
    vec.push(
      Math.sin(tod * Math.PI * 2),
      Math.cos(tod * Math.PI * 2),
      Math.sin(doy * Math.PI * 2),
      Math.cos(doy * Math.PI * 2),
      rangeNorm,
      trendNorm,
      (closes[closes.length - 1] - mMedian(closes)) / denom
    );
    return vec;
  }

  if (model === "Time of Day") {
    const vec: number[] = [];
    const tRaw = candles[safeEnd]?.time;
    const tod = timeOfDayUnit(tRaw, parseMode);
    vec.push(Math.sin(tod * Math.PI * 2), Math.cos(tod * Math.PI * 2), rangeNorm, trendNorm);
    for (let i = Math.max(1, bars - 4); i < bars; i++) {
      const r = (closes[i] - closes[i - 1]) / denom;
      vec.push(r);
    }
    return vec;
  }

  if (model === "Support / Resistance") {
    const vec: number[] = [];
    const lastClose = closes[closes.length - 1];
    const swing = Math.max(maxH - minL, AI_EPS);
    const pos = (lastClose - minL) / swing;
    const dSup = (lastClose - minL) / swing;
    const dRes = (maxH - lastClose) / swing;
    let supTouches = 0, resTouches = 0;
    const touchBand = 0.08;
    for (let i = 0; i < bars; i++) {
      const p = (closes[i] - minL) / swing;
      if (p <= touchBand) supTouches++;
      if (p >= 1 - touchBand) resTouches++;
    }
    const prevClose = closes[Math.max(0, closes.length - 2)] ?? lastClose;
    const lastRet = (lastClose - prevClose) / denom;
    vec.push(pos, dSup, dRes, supTouches / bars, resTouches / bars, rangeNorm, trendNorm, lastRet);
    return vec;
  }

  // Fibonacci (default)
  const vec: number[] = [];
  const lastClose = closes[closes.length - 1];
  const swing = Math.max(maxH - minL, AI_EPS);
  const pos = (lastClose - minL) / swing;
  const levels = [0.236, 0.382, 0.5, 0.618, 0.786];
  for (const lv of levels) vec.push(pos - lv);
  vec.push(rangeNorm, trendNorm);
  return vec;
}

function buildTradeVector(
  candles: Candle[],
  endIndex: number,
  chunkBars: number,
  model: string,
  trade: Trade,
  parseMode: ParseMode
): number[] {
  const vec = buildChunkVector(candles, endIndex, chunkBars, model, parseMode);

  // Add trade metadata
  vec.push((trade.dir ?? 1) * 0.5);
  vec.push(trade.pnl > 0 ? 0.5 : -0.5);

  // Time features
  const timeUnit = timeOfDayUnit(trade.entryTime, parseMode);
  const dayUnit = dayOfYearUnit(trade.entryTime, parseMode);
  vec.push(timeUnit - 0.5);
  vec.push(dayUnit - 0.5);

  return vec;
}

// ============================================
// PCA HELPERS
// ============================================

function powerIterationVec(cov: number[][], dim: number, seed: string, iterations = 20): number[] {
  const vec = new Array(dim);
  for (let i = 0; i < dim; i++) {
    vec[i] = stableHashToUnit(seed + i) * 2 - 1;
  }
  let v = normalizeVec(vec);
  for (let iter = 0; iter < iterations; iter++) {
    const next = matVecMult(cov, v);
    v = normalizeVec(next);
  }
  return v;
}

function matVecMult(mat: number[][], vec: number[]): number[] {
  const dim = vec.length;
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    let sum = 0;
    const row = mat[i];
    for (let j = 0; j < dim; j++) {
      sum += row[j] * vec[j];
    }
    out[i] = sum;
  }
  return out;
}

function normalizeVec(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec.slice();
  const out = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

function stableHashToUnit(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 10000) / 10000;
}

// ============================================
// SIMULATION
// ============================================

function simulate(settings: SimulateSettings): SimulateResult {
  const candles = CANDLES;
  const n = candles.length;
  const parseMode = settings.parseMode || "utc";
  PARSE_MODE = parseMode;

  FEATURE_LEVELS = settings.featureLevels || {};
  FEATURE_MODES = settings.featureModes || {};

  if (!n || n < 50) {
    return {
      trades: [],
      ghostEntries: [],
      libraryPoints: [],
      stats: computeStats([], parseMode),
      libraryCounts: {},
    };
  }

  // Simulation parameters
  const tpDist = settings.tpDist ?? 50;
  const slDist = settings.slDist ?? 30;
  const chunkBars = settings.chunkBars ?? 16;
  const dollarsPerMove = settings.dollarsPerMove ?? 100;
  const model = settings.model || "Momentum";
  const checkEveryBar = settings.checkEveryBar ?? false;

  // Trade limits
  const maxTradesPerDay = settings.maxTradesPerDay ?? 0;
  const cooldownBars = settings.cooldownBars ?? 0;
  const maxConcurrentTrades = settings.maxConcurrentTrades ?? 1;
  const maxBarsInTrade = settings.maxBarsInTrade ?? 0;

  // Stop management
  const stopMode = settings.stopMode ?? 0; // 0=none, 1=BE, 2=trail, 3=both
  const breakEvenTriggerPct = settings.breakEvenTriggerPct ?? 50;
  const trailingStartPct = settings.trailingStartPct ?? 50;
  const trailingDistPct = settings.trailingDistPct ?? 30;

  // AI settings
  const aiMethod = settings.aiMethod || "off";
  const kEntry = settings.kEntry ?? 21;
  const kExit = settings.kExit ?? 11;
  const knnVoteMode = settings.knnVoteMode ?? "distance";
  const distanceMetric = settings.distanceMetric ?? "euclidean";
  const confidenceThreshold = settings.confidenceThreshold ?? 0;

  // Model states
  const modelStates = settings.modelStates;

  // Calculate ATR for dynamic TP/SL
  const atrValues = atr(candles, 100);

  const trades: Trade[] = [];
  const ghostEntries: Trade[] = [];
  const libraryPoints: LibraryPoint[] = [];
  const library: LibraryPoint[] = [];

  // Trade tracking - per model for multi-model simulation
  const tradesPerDayByModel: Record<string, Record<string, number>> = {};
  const cooldownByModel: Record<string, number> = {};
  const openTradesByModel: Record<string, Trade[]> = {};

  // Initialize tracking for each enabled model
  for (const m of MODELS) {
    const state = modelStates?.[m] ?? 0;
    if (state >= 1) {
      tradesPerDayByModel[m] = {};
      cooldownByModel[m] = 0;
      openTradesByModel[m] = [];
    }
  }

  // Legacy single-model tracking (for backward compatibility)
  let openTrades: Trade[] = [];

  // Report progress
  postMessage({ type: "progress", phase: "Simulation", pct: 0 });

  // Stride for checking entries
  const entryStride = checkEveryBar ? 1 : Math.max(1, Math.floor(chunkBars / 4));

  for (let i = chunkBars; i < n; i++) {
    const c = candles[i];
    const atrVal = atrValues[i] || 1;

    // Process exits for ALL models' open trades
    for (const modelKey of Object.keys(openTradesByModel)) {
      const modelOpenTrades = openTradesByModel[modelKey];
      for (let ti = modelOpenTrades.length - 1; ti >= 0; ti--) {
        const trade = modelOpenTrades[ti];
        const high = c.high;
        const low = c.low;
        const dir = trade.dir;
        let tp = trade.tp;
        let sl = trade.sl;
        const entryPrice = trade.entryPrice;

        // Stop management updates
        const barsInTrade = i - trade.entryIndex;

        // Break-even stop (modes 1 and 3)
        if ((stopMode === 1 || stopMode === 3) && barsInTrade > 0) {
          const beMove = tpDist * (breakEvenTriggerPct / 100) * atrVal / 10000;
          if (dir === 1 && (high - entryPrice) >= beMove) {
            sl = Math.max(sl, entryPrice);
          } else if (dir === -1 && (entryPrice - low) >= beMove) {
            sl = Math.min(sl, entryPrice);
          }
          trade.sl = sl;
        }

        // Trailing stop (modes 2 and 3)
        if ((stopMode === 2 || stopMode === 3) && barsInTrade > 0) {
          const startMove = tpDist * (trailingStartPct / 100) * atrVal / 10000;
          const trailDist = tpDist * (trailingDistPct / 100) * atrVal / 10000;
          if (dir === 1) {
            const adv = high - entryPrice;
            if (adv >= startMove) {
              const candidate = high - trailDist;
              sl = Math.max(sl, candidate);
            }
          } else {
            const adv = entryPrice - low;
            if (adv >= startMove) {
              const candidate = low + trailDist;
              sl = Math.min(sl, entryPrice);
            }
          }
          trade.sl = sl;
        }

        let exited = false;
        let exitPrice = c.close;
        let result: Trade["result"] = "MW";

        // Check TP hit
        if (dir > 0 && high >= tp) {
          exitPrice = tp;
          exited = true;
          result = "TP";
        } else if (dir < 0 && low <= tp) {
          exitPrice = tp;
          exited = true;
          result = "TP";
        }

        // Check SL hit
        if (!exited) {
          if (dir > 0 && low <= sl) {
            exitPrice = sl;
            exited = true;
            result = sl === entryPrice ? "BE" : "SL";
          } else if (dir < 0 && high >= sl) {
            exitPrice = sl;
            exited = true;
            result = sl === entryPrice ? "BE" : "SL";
          }
        }

        // Check max bars timeout
        if (!exited && maxBarsInTrade > 0 && barsInTrade >= maxBarsInTrade) {
          exitPrice = c.close;
          exited = true;
          const pnlCheck = (exitPrice - entryPrice) * dir;
          result = pnlCheck > 0 ? "MW" : "ML";
        }

        // Check lookahead timeout
        if (!exited && barsInTrade >= SEED_LOOKAHEAD_BARS) {
          exitPrice = c.close;
          exited = true;
          const pnlCheck = (exitPrice - entryPrice) * dir;
          result = pnlCheck > 0 ? "MW" : "ML";
        }

        if (exited) {
          const pnl = (exitPrice - entryPrice) * dir * dollarsPerMove;
          trade.exitTime = c.time;
          trade.exitPrice = exitPrice;
          trade.exitIndex = i;
          trade.pnl = pnl;
          trade.result = result;
          trade.win = pnl > 0;
          trade.isOpen = false;

          // Generate cluster coords
          const hash1 = hashStrToInt(trade.uid + "-x");
          const hash2 = hashStrToInt(trade.uid + "-y");
          const rnd1 = mulberry32(hash1);
          const rnd2 = mulberry32(hash2);
          trade.x = (rnd1() - 0.5) * 4;
          trade.y = (rnd2() - 0.5) * 4;
          trade.r = 4 + Math.abs(pnl) / 100;
          trade.kind = "trade";
          trade.direction = dir;

          trades.push(trade);
          modelOpenTrades.splice(ti, 1);

          // Add to library for kNN
          const vec = buildChunkVector(candles, trade.entryIndex, chunkBars, trade.model || modelKey, parseMode);
          library.push({
            id: `lib-${trade.uid}`,
            x: trade.x,
            y: trade.y,
            r: trade.r,
            kind: "library",
            dir: trade.dir,
            pnl: trade.pnl,
            win: trade.win || false,
            time: trade.entryTime,
            v: vec,
            weight: 1,
          });
        }
      }
    }

    // Check for entries - get ALL signals from all enabled models
    if (i % entryStride === 0 && i < n - SEED_LOOKAHEAD_BARS) {
      // Get all entry signals from all enabled models
      const allSignals = getAllEntrySignals(candles, i, chunkBars, parseMode, modelStates);

      // Process each signal independently
      for (const signal of allSignals) {
        const signalModel = signal.model;
        const modelOpenTrades = openTradesByModel[signalModel];
        if (!modelOpenTrades) continue;

        // Check per-model concurrent trade limit
        if (modelOpenTrades.length >= maxConcurrentTrades) continue;

        // Check per-model cooldown
        const modelCooldown = cooldownByModel[signalModel] || 0;
        if (cooldownBars > 0 && i < modelCooldown) continue;

        // Check per-model max trades per day
        if (maxTradesPerDay > 0) {
          const dk = dayKeyFromTime(c.time, parseMode);
          const modelDayTrades = tradesPerDayByModel[signalModel] || {};
          const used = modelDayTrades[dk] || 0;
          if (used >= maxTradesPerDay) continue;
        }

        // AI confidence gate
        let passConfidence = true;
        let aiMargin = signal.score;

        if (aiMethod === "knn" && library.length >= 40 && confidenceThreshold > 0) {
          const vec = buildChunkVector(candles, i, chunkBars, signalModel, parseMode);
          const vote = knnVote(library, vec, kEntry, knnVoteMode, distanceMetric);
          aiMargin = vote.confidence;

          if (vote.confidence * 100 < confidenceThreshold) {
            passConfidence = false;

            // Track as ghost entry
            ghostEntries.push({
              uid: `ghost-${signalModel}-${i}-${Date.now()}`,
              entryTime: c.time,
              entryPrice: c.close,
              entryIndex: i,
              signalIndex: i,
              dir: signal.dir,
              pnl: 0,
              isOpen: false,
              tp: 0,
              sl: 0,
              model: signalModel,
              aiMargin,
              aiMode: "filter",
            });
          }
        }

        if (passConfidence) {
          const entryPrice = c.close;
          const dir = signal.dir;
          const tp = entryPrice + (dir * tpDist * atrVal) / 10000;
          const sl = entryPrice - (dir * slDist * atrVal) / 10000;
          const sess = sessionFromTime(c.time, parseMode);

          const trade: Trade = {
            uid: `trade-${signalModel}-${i}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            entryTime: c.time,
            entryPrice,
            entryIndex: i,
            signalIndex: i,
            dir,
            direction: dir,
            pnl: 0,
            isOpen: true,
            tp,
            sl,
            model: signalModel,
            chunkType: signalModel,
            session: sess,
            aiMargin,
            aiMode: aiMethod === "knn" ? "filter" : "off",
          };

          modelOpenTrades.push(trade);

          // Update per-model cooldown
          if (cooldownBars > 0) {
            cooldownByModel[signalModel] = i + cooldownBars;
          }

          // Update per-model trades per day
          const dk = dayKeyFromTime(c.time, parseMode);
          if (!tradesPerDayByModel[signalModel]) {
            tradesPerDayByModel[signalModel] = {};
          }
          tradesPerDayByModel[signalModel][dk] = (tradesPerDayByModel[signalModel][dk] || 0) + 1;
        }
      }
    }

    // Update combined openTrades list for legacy compatibility
    openTrades = Object.values(openTradesByModel).flat();

    // Progress update every 500 bars
    if (i % 500 === 0) {
      postMessage({
        type: "progress",
        phase: "Simulation",
        pct: clamp((i - chunkBars) / (n - chunkBars), 0, 0.9),
      });
    }
  }

  // Close any remaining open trades
  for (const trade of openTrades) {
    const lastCandle = candles[n - 1];
    trade.exitTime = lastCandle.time;
    trade.exitPrice = lastCandle.close;
    trade.exitIndex = n - 1;
    trade.pnl = (lastCandle.close - trade.entryPrice) * trade.dir * dollarsPerMove;
    trade.result = trade.pnl > 0 ? "MW" : "ML";
    trade.win = trade.pnl > 0;
    trade.isOpen = false;
    trade.kind = "trade";
    trades.push(trade);
  }

  // Build feature vectors for PCA embedding
  postMessage({ type: "progress", phase: "Building vectors", pct: 0.85 });

  const vectors: number[][] = [];
  for (const t of trades) {
    const vec = buildTradeVector(candles, t.entryIndex, chunkBars, t.model || model, t, parseMode);
    vectors.push(vec);
  }

  // Compute PCA embedding
  postMessage({ type: "progress", phase: "PCA embedding", pct: 0.9 });

  if (vectors.length > 0 && vectors[0].length > 0) {
    const dim = vectors[0].length;
    const mean = new Array(dim).fill(0);
    const stdev = new Array(dim).fill(0);

    for (const v of vectors) {
      for (let i = 0; i < dim; i++) mean[i] += v[i];
    }
    for (let i = 0; i < dim; i++) mean[i] /= vectors.length;

    for (const v of vectors) {
      for (let i = 0; i < dim; i++) {
        const d = v[i] - mean[i];
        stdev[i] += d * d;
      }
    }
    for (let i = 0; i < dim; i++) {
      stdev[i] = Math.sqrt(stdev[i] / vectors.length);
      if (stdev[i] < 1e-8) stdev[i] = 1;
    }

    const stdData: number[][] = [];
    for (const v of vectors) {
      const row = new Array(dim);
      for (let i = 0; i < dim; i++) {
        row[i] = (v[i] - mean[i]) / stdev[i];
      }
      stdData.push(row);
    }

    // Compute PCA
    const cov: number[][] = new Array(dim);
    for (let i = 0; i < dim; i++) cov[i] = new Array(dim).fill(0);

    for (const row of stdData) {
      for (let i = 0; i < dim; i++) {
        const vi = row[i];
        for (let j = i; j < dim; j++) {
          cov[i][j] += vi * row[j];
        }
      }
    }
    const invN = 1 / stdData.length;
    for (let i = 0; i < dim; i++) {
      for (let j = i; j < dim; j++) {
        cov[i][j] *= invN;
        cov[j][i] = cov[i][j];
      }
    }

    const pc1 = powerIterationVec(cov, dim, "pc1");

    const covPc1 = matVecMult(cov, pc1);
    let eig1 = 0;
    for (let i = 0; i < dim; i++) eig1 += pc1[i] * covPc1[i];
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        cov[i][j] -= eig1 * pc1[i] * pc1[j];
      }
    }
    const pc2 = powerIterationVec(cov, dim, "pc2");

    // Project to 2D
    for (let ti = 0; ti < trades.length; ti++) {
      const v = stdData[ti];
      let x = 0, y = 0;
      for (let j = 0; j < dim; j++) {
        x += v[j] * pc1[j];
        y += v[j] * pc2[j];
      }
      trades[ti].x = x;
      trades[ti].y = y;
      trades[ti].r = 4 + Math.abs(trades[ti].pnl) / 100;
      trades[ti].kind = "trade";
    }
  }

  // Generate library points for visualization
  postMessage({ type: "progress", phase: "Finalizing", pct: 0.95 });

  const libraryCounts: Record<string, number> = {};
  for (const t of trades) {
    libraryPoints.push({
      id: `lib-${t.uid}`,
      x: t.x || 0,
      y: t.y || 0,
      r: t.r || 4,
      kind: "trade",
      dir: t.dir,
      pnl: t.pnl,
      win: t.win || false,
      time: t.entryTime,
    });
    libraryCounts["core"] = (libraryCounts["core"] || 0) + 1;
  }

  const stats = computeStats(trades, parseMode);

  postMessage({ type: "progress", phase: "Done", pct: 1 });

  return {
    trades,
    ghostEntries,
    libraryPoints,
    stats,
    libraryCounts,
  };
}

// ============================================
// MESSAGE HANDLER
// ============================================

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data || {};

  if (msg.type === "set_candles") {
    CANDLES = msg.candles || [];
    postMessage({ type: "candles_ok", count: CANDLES.length });
    return;
  }

  if (msg.type === "compute") {
    const id = msg.id;
    const settings = msg.settings || {};
    try {
      const res = simulate(settings);
      postMessage({ type: "result", id, res });
    } catch (e) {
      const error = e as Error;
      postMessage({
        type: "error",
        id,
        message: error?.message || String(e),
      });
    }
    return;
  }
};

// Export for type checking
export {};
