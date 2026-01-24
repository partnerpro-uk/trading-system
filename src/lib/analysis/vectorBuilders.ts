// Vector Building Utilities
// Functions for building feature vectors for ML models

import { AI_EPS } from './constants';
import { safeSliceIndex, sma, std, mMedian } from './math';
import { timeOfDayUnit, dayOfYearUnit, sessionFromTime, ParseMode } from './dateTime';
import type { AnalysisCandle } from './types';

// Use AnalysisCandle as the Candle type
type Candle = AnalysisCandle;

// Vector strength constants
export const DIR_STRENGTH = 1;
export const RESULT_STRENGTH = 0.5;
export const PNL_STRENGTH = 1;
export const EXTRA_FEATURE_WEIGHT = 3;
export const TIME_Y_STRENGTH = 0;
export const TIME_FEATURE_STRENGTH = 1.0;

// Types
export interface WindowOHLCResult {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  baseClose: number;
  denom: number;
  maxH: number;
  minL: number;
  rangeNorm: number;
  trendNorm: number;
  last: number;
  prev: number;
  lastRet: number;
}

export interface ChecklistResult {
  buyChecks: { label: string; ok: boolean }[];
  sellChecks: { label: string; ok: boolean }[];
  buyScore: number;
  sellScore: number;
}

export interface TradeLike {
  direction?: number;
  result?: string;
  isOpen?: boolean;
  unrealizedPnl?: number;
  pnl?: number;
}

/**
 * Extract OHLC window data for UI display
 */
export function windowOHLCUI(
  candles: Candle[],
  endIndex: number,
  bars: number
): WindowOHLCResult {
  const n = candles.length;
  const safeEnd = Math.min(n - 1, Math.max(0, Math.trunc(endIndex)));
  const b = Math.max(2, Math.trunc(bars));
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  for (let offset = b - 1; offset >= 0; offset--) {
    const idx = safeSliceIndex(n, safeEnd - offset);
    const c = candles[idx];
    opens.push(c.open ?? 0);
    highs.push(c.high ?? 0);
    lows.push(c.low ?? 0);
    closes.push(c.close ?? 0);
  }
  const baseClose = closes[closes.length - 1] ?? 1;
  const denom = Math.max(Math.abs(baseClose), AI_EPS);
  let maxH = -Infinity;
  let minL = Infinity;
  for (let i = 0; i < b; i++) {
    if (highs[i] > maxH) maxH = highs[i];
    if (lows[i] < minL) minL = lows[i];
  }
  const rangeNorm = (maxH - minL) / denom;
  const trendNorm = (closes[closes.length - 1] - closes[0]) / denom;
  const last = closes[closes.length - 1];
  const prev = closes[Math.max(0, closes.length - 2)];
  const lastRet = (last - prev) / denom;
  return {
    opens,
    highs,
    lows,
    closes,
    baseClose,
    denom,
    maxH,
    minL,
    rangeNorm,
    trendNorm,
    last,
    prev,
    lastRet,
  };
}

/**
 * Generate entry checklist for UI based on model type
 */
export function entryChecklistUI(
  candles: Candle[],
  i: number,
  chunkBars: number,
  model: string,
  parseMode: ParseMode
): ChecklistResult {
  const w = windowOHLCUI(candles, i, chunkBars);
  const { denom, maxH, minL, rangeNorm, trendNorm, last, prev, lastRet } = w;
  const thrImp = 0.006;
  let recentUp = false;
  let recentDown = false;
  for (let k = 1; k <= 3; k++) {
    const j = i - k;
    if (j < 1) break;
    const pClose = (candles[j - 1] as Candle).close ?? 0;
    const cClose = (candles[j] as Candle).close ?? 0;
    const ret = (cClose - pClose) / Math.max(1e-8, Math.abs(pClose));
    if (ret > thrImp) recentUp = true;
    if (ret < -thrImp) recentDown = true;
    if (recentUp && recentDown) break;
  }
  const swing = Math.max(maxH - minL, AI_EPS);
  const pos = swing > 0 ? (last - minL) / swing : 0.5;
  const tRaw = (candles[i] as Candle)?.time;
  const tod = timeOfDayUnit(tRaw, parseMode);
  const doy = dayOfYearUnit(tRaw, parseMode);
  const bias =
    Math.cos(tod * Math.PI * 2) * 0.55 + Math.sin(doy * Math.PI * 2) * 0.25;
  const sess = sessionFromTime(tRaw, parseMode);
  const daySession = sess === "London" || sess === "New York";
  let prevDaySession = daySession;
  if (i > 0) {
    const prevSess = sessionFromTime((candles[i - 1] as Candle)?.time, parseMode);
    prevDaySession = prevSess === "London" || prevSess === "New York";
  }
  const thrTrend = 0.01;
  const upTrend = trendNorm > thrTrend;
  const downTrend = trendNorm < -thrTrend;
  const upImpulse = lastRet > thrImp;
  const downImpulse = lastRet < -thrImp;
  const out: ChecklistResult = {
    buyChecks: [],
    sellChecks: [],
    buyScore: 0,
    sellScore: 0,
  };
  if (model === "Momentum") {
    const buy = [
      { label: "Strong uptrend", ok: trendNorm > thrTrend },
      { label: "Recent pullback", ok: lastRet < -thrImp * 0.5 || downImpulse },
      { label: "Above mid‑range", ok: pos > 0.5 },
    ];
    const sell = [
      { label: "Strong downtrend", ok: trendNorm < -thrTrend },
      { label: "Recent rally", ok: lastRet > thrImp * 0.5 || upImpulse },
      { label: "Below mid‑range", ok: pos < 0.5 },
    ];
    out.buyChecks = buy;
    out.sellChecks = sell;
  } else if (model === "Mean Reversion") {
    const thrPosLow = 0.25;
    const thrPosHigh = 0.75;
    const weakTrend = Math.abs(trendNorm) < thrTrend;
    const buy = [
      { label: "Oversold (low range)", ok: pos < thrPosLow },
      { label: "Bounce from low", ok: upImpulse },
      { label: "Weak or flat trend", ok: weakTrend },
    ];
    const sell = [
      { label: "Overbought (high range)", ok: pos > thrPosHigh },
      { label: "Dip from high", ok: downImpulse },
      { label: "Weak or flat trend", ok: weakTrend },
    ];
    out.buyChecks = buy;
    out.sellChecks = sell;
  } else if (model === "Seasons") {
    const thrB = 0.12;
    const bullishBias = bias > thrB;
    const bearishBias = bias < -thrB;
    const buy = [
      { label: "Seasonal bias bullish", ok: bullishBias },
      { label: "Uptrend confirmation", ok: upTrend },
      { label: "Not overbought", ok: pos < 0.85 },
    ];
    const sell = [
      { label: "Seasonal bias bearish", ok: bearishBias },
      { label: "Downtrend confirmation", ok: downTrend },
      { label: "Not oversold", ok: pos > 0.15 },
    ];
    out.buyChecks = buy;
    out.sellChecks = sell;
  } else if (model === "Time of Day") {
    const thrVol = 0.005;
    const buy = [
      { label: "Day session start", ok: daySession && !prevDaySession },
      { label: "Uptrend confirmation", ok: upTrend },
      { label: "Adequate volatility", ok: rangeNorm > thrVol },
    ];
    const sell = [
      { label: "Night session start", ok: !daySession && prevDaySession },
      { label: "Downtrend confirmation", ok: downTrend },
      { label: "Adequate volatility", ok: rangeNorm > thrVol },
    ];
    out.buyChecks = buy;
    out.sellChecks = sell;
  } else if (model === "Support / Resistance") {
    const swingSR = Math.max(maxH - minL, AI_EPS);
    const posSR = (last - minL) / swingSR;
    const band = 0.08;
    const nearSup = posSR <= band;
    const nearRes = posSR >= 1 - band;
    const bullish = last > prev && (last - prev) / denom > 0.002;
    const bearish = last < prev && (prev - last) / denom > 0.002;
    const thrR = 0.008;
    const buy = [
      { label: "Near support", ok: nearSup },
      { label: "Bullish reversal", ok: bullish },
      { label: "Sufficient range", ok: rangeNorm > thrR },
    ];
    const sell = [
      { label: "Near resistance", ok: nearRes },
      { label: "Bearish reversal", ok: bearish },
      { label: "Sufficient range", ok: rangeNorm > thrR },
    ];
    out.buyChecks = buy;
    out.sellChecks = sell;
  } else {
    // Fibonacci (default)
    const thrT = 0.01;
    const lowZone = 0.382;
    const highZone = 0.618;
    const buy = [
      { label: "Uptrend", ok: trendNorm > thrT },
      { label: "Retracement to lower zone", ok: pos <= lowZone },
      { label: "No strong down spikes", ok: !recentDown },
    ];
    const sell = [
      { label: "Downtrend", ok: trendNorm < -thrT },
      { label: "Retracement to upper zone", ok: pos >= highZone },
      { label: "No strong up spikes", ok: !recentUp },
    ];
    out.buyChecks = buy;
    out.sellChecks = sell;
  }
  out.buyScore =
    out.buyChecks.length > 0
      ? out.buyChecks.filter((x) => x.ok).length / out.buyChecks.length
      : 0;
  out.sellScore =
    out.sellChecks.length > 0
      ? out.sellChecks.filter((x) => x.ok).length / out.sellChecks.length
      : 0;
  return out;
}

/**
 * Build feature vector for a price chunk based on model type
 */
export function buildChunkVector(
  candles: Candle[],
  endIndex: number,
  chunkBars: number,
  chunkType: string,
  parseMode: ParseMode
): number[] {
  const n = candles.length;
  const bars = Math.max(1, chunkBars);
  const safeEnd = Math.min(n - 1, Math.max(0, endIndex));
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
    if (!c) {
      // Fallback to baseClose if candle is missing
      opens.push(baseClose);
      highs.push(baseClose);
      lows.push(baseClose);
      closes.push(baseClose);
      continue;
    }
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

  if (chunkType === "Momentum") {
    const vec: number[] = [];
    for (let i = 0; i < bars; i++) {
      const rc = (closes[i] - baseClose) / denom;
      const rh = (highs[i] - baseClose) / denom;
      const rl = (lows[i] - baseClose) / denom;
      vec.push(rc, rh, rl);
    }
    let bull = 0,
      bear = 0;
    for (let i = 0; i < bars; i++) {
      if (closes[i] > opens[i]) bull++;
      else if (closes[i] < opens[i]) bear++;
    }
    vec.push(rangeNorm, trendNorm, bull / bars, bear / bars);
    return vec;
  }

  if (chunkType === "Mean Reversion") {
    const m = sma(closes);
    const s = Math.max(std(closes), AI_EPS);
    const vec: number[] = [];
    for (let i = 0; i < bars; i++) vec.push((closes[i] - m) / s);
    const lastClose = closes[closes.length - 1];
    const dev = (lastClose - m) / s;
    const mid = closes[Math.floor(bars / 2)] ?? lastClose;
    const halfDev = (mid - m) / s;
    vec.push(dev, dev - halfDev);
    vec.push(rangeNorm, trendNorm);
    let wickScore = 0;
    for (let i = 0; i < bars; i++) {
      const body = Math.abs(closes[i] - opens[i]);
      const wicks =
        highs[i] -
        Math.max(closes[i], opens[i]) +
        (Math.min(closes[i], opens[i]) - lows[i]);
      wickScore += wicks / Math.max(body + AI_EPS, AI_EPS);
    }
    vec.push(wickScore / bars);
    return vec;
  }

  if (chunkType === "Seasons") {
    const vec: number[] = [];
    const tRaw = candles[safeEnd]?.time;
    const tod = timeOfDayUnit(tRaw, parseMode);
    const doy = dayOfYearUnit(tRaw, parseMode);
    const sinTod = Math.sin(tod * Math.PI * 2);
    const cosTod = Math.cos(tod * Math.PI * 2);
    const sinDoy = Math.sin(doy * Math.PI * 2);
    const cosDoy = Math.cos(doy * Math.PI * 2);
    vec.push(sinTod, cosTod, sinDoy, cosDoy, rangeNorm, trendNorm);
    const lastClose = closes[closes.length - 1];
    vec.push((lastClose - mMedian(closes)) / denom);
    return vec;
  }

  if (chunkType === "Time of Day") {
    const vec: number[] = [];
    const tRaw = candles[safeEnd]?.time;
    const tod = timeOfDayUnit(tRaw, parseMode);
    vec.push(Math.sin(tod * Math.PI * 2), Math.cos(tod * Math.PI * 2));
    vec.push(rangeNorm, trendNorm);
    for (let i = Math.max(1, bars - 4); i < bars; i++) {
      const r = (closes[i] - closes[i - 1]) / denom;
      vec.push(r);
    }
    return vec;
  }

  if (chunkType === "Support / Resistance") {
    const vec: number[] = [];
    const lastClose = closes[closes.length - 1];
    const swing = Math.max(maxH - minL, AI_EPS);
    const pos = (lastClose - minL) / swing;
    const dSup = (lastClose - minL) / swing;
    const dRes = (maxH - lastClose) / swing;
    let supTouches = 0;
    let resTouches = 0;
    const touchBand = 0.08;
    for (let i = 0; i < bars; i++) {
      const p = (closes[i] - minL) / swing;
      if (p <= touchBand) supTouches++;
      if (p >= 1 - touchBand) resTouches++;
    }
    const prevClose = closes[Math.max(0, closes.length - 2)] ?? lastClose;
    const lastRet = (lastClose - prevClose) / denom;
    const isBull = lastClose > prevClose;
    const isBear = lastClose < prevClose;
    vec.push(
      pos,
      dSup,
      dRes,
      supTouches / bars,
      resTouches / bars,
      rangeNorm,
      trendNorm,
      lastRet,
      isBull ? 1 : 0,
      isBear ? 1 : 0
    );
    return vec;
  }

  // Fibonacci (default)
  {
    const vec: number[] = [];
    const lastClose = closes[closes.length - 1];
    const swing = Math.max(maxH - minL, AI_EPS);
    const pos = (lastClose - minL) / swing;
    const levels = [0.236, 0.382, 0.5, 0.618, 0.786];
    for (const lv of levels) vec.push(pos - lv);
    vec.push(rangeNorm, trendNorm);
    let wickScore = 0;
    for (let i = 0; i < bars; i++) {
      const body = Math.abs(closes[i] - opens[i]);
      const wicks =
        highs[i] -
        Math.max(closes[i], opens[i]) +
        (Math.min(closes[i], opens[i]) - lows[i]);
      wickScore += wicks / Math.max(body + AI_EPS, AI_EPS);
    }
    vec.push(wickScore / bars);
    return vec;
  }
}

/**
 * Build feature vector for cluster map visualization
 */
export function buildMapVector(
  candles: Candle[],
  endIndex: number,
  chunkBars: number,
  chunkType: string,
  tradeLike: TradeLike,
  pnlScale: number,
  parseMode: ParseMode
): number[] {
  const vec = buildChunkVector(
    candles,
    endIndex,
    chunkBars,
    chunkType,
    parseMode
  );
  vec.push((tradeLike.direction ?? 1) * DIR_STRENGTH);
  const r = tradeLike.result ?? "MW";
  vec.push((r === "TP" ? 1 : 0) * RESULT_STRENGTH);
  vec.push((r === "SL" ? 1 : 0) * RESULT_STRENGTH);
  vec.push((r === "MW" ? 1 : 0) * RESULT_STRENGTH);
  vec.push((r === "ML" ? 1 : 0) * RESULT_STRENGTH);
  const scale = Math.max(1, pnlScale);
  const p = tradeLike.isOpen
    ? tradeLike.unrealizedPnl ?? 0
    : tradeLike.pnl ?? 0;
  vec.push(Math.tanh(p / scale) * PNL_STRENGTH);
  return vec;
}
