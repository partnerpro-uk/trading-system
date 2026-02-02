/**
 * FCR Detector - First Candle Range Strategy Custom Indicator
 *
 * Detects FCR (First Candle Range) setups:
 * 1. FCR Range - First 5 M1 candles (9:30-9:35 AM ET) aggregated high/low
 * 2. Breakout - Candle closing beyond FCR high/low
 * 3. FVG (Fair Value Gap) - 3-candle imbalance pattern
 * 4. Retest - Price returning to FVG zone
 * 5. Entry - Bullish/bearish engulfing at FVG
 *
 * All detection runs on M1 timeframe.
 */

import { CandleInput, IndicatorValue } from "@/lib/indicators/types";

export interface FCRDetectorParams {
  marketOpenHour: number;       // Default: 9
  marketOpenMinute: number;     // Default: 30
  timezone: string;             // Default: "America/New_York"
  fcrCandleCount: number;       // Default: 5 (first 5 M1 candles)
  riskRewardRatio: number;      // Default: 3
  timeframeMinutes?: number;    // Auto-detected if not provided
}

export const FCR_DETECTOR_DEFAULTS: FCRDetectorParams = {
  marketOpenHour: 9,
  marketOpenMinute: 30,
  timezone: "America/New_York",
  fcrCandleCount: 5,
  riskRewardRatio: 3,
};

export interface FCRDetectorOutput {
  // FCR Range levels (constant after 9:35 AM)
  fcrHigh: IndicatorValue[];
  fcrLow: IndicatorValue[];

  // Window flag
  inFcrWindow: IndicatorValue[];   // 1 during 9:30-10:30 window

  // Breakout signals (one-shot)
  breakoutUp: IndicatorValue[];    // 1 on bullish breakout candle
  breakoutDown: IndicatorValue[];  // 1 on bearish breakout candle

  // FVG detection
  fvgFormed: IndicatorValue[];     // 1 when FVG forms
  fvgTop: IndicatorValue[];        // Upper boundary of FVG
  fvgBottom: IndicatorValue[];     // Lower boundary of FVG

  // Retest & Entry
  retest: IndicatorValue[];        // 1 when price enters FVG
  entryLong: IndicatorValue[];     // 1 on bullish engulfing at FVG
  entryShort: IndicatorValue[];    // 1 on bearish engulfing at FVG

  // Trade levels (set at entry)
  entryPrice: IndicatorValue[];
  stopLoss: IndicatorValue[];
  takeProfit: IndicatorValue[];
}

// State machine for FCR detection
type FCRState =
  | "waiting_for_open"     // Before 9:30
  | "building_fcr"         // 9:30-9:35, accumulating FCR candles
  | "watching_breakout"    // FCR complete, waiting for breakout
  | "breakout_occurred"    // Breakout detected, looking for FVG
  | "fvg_formed"           // FVG detected, waiting for retest
  | "in_retest"            // Price in FVG zone, waiting for entry
  | "entry_triggered"      // Trade entered
  | "session_done";        // No more setups today

interface DayState {
  date: string;                    // YYYY-MM-DD
  state: FCRState;
  fcrHigh: number | null;
  fcrLow: number | null;
  fcrCandles: CandleInput[];       // First 5 M1 candles
  breakoutDirection: "long" | "short" | null;
  breakoutCandle: CandleInput | null;
  fvgTop: number | null;
  fvgBottom: number | null;
  fvgCandleA: CandleInput | null;
  fvgCandleC: CandleInput | null;
  retestLow: number | null;        // Lowest low during retest (for long)
  retestHigh: number | null;       // Highest high during retest (for short)
  entryCandle: CandleInput | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}

/**
 * Detect timeframe from candle spacing (in minutes)
 */
function detectTimeframeMinutes(candles: CandleInput[]): number {
  if (candles.length < 2) return 1; // Default to M1

  // Check spacing between first few candles
  const diffs: number[] = [];
  for (let i = 1; i < Math.min(5, candles.length); i++) {
    const diff = (candles[i].timestamp - candles[i - 1].timestamp) / 60000; // ms to minutes
    if (diff > 0 && diff < 50000) { // Sanity check (< 1 month)
      diffs.push(diff);
    }
  }

  if (diffs.length === 0) return 1;

  // Use median to avoid gaps
  diffs.sort((a, b) => a - b);
  return Math.round(diffs[Math.floor(diffs.length / 2)]);
}

/**
 * Check if candle is the FCR candle (first candle at/after 9:30 AM ET)
 * For M1: checks 9:30-9:34 (5 candles)
 * For M5: checks 9:30 (1 candle)
 * For M15: checks 9:30 (1 candle, but covers 9:30-9:45)
 */
function isInFCRFormationWindow(timestamp: number, params: FCRDetectorParams, tfMinutes: number): boolean {
  const date = new Date(timestamp);
  // Approximate ET offset (EDT: UTC-4, EST: UTC-5)
  const month = date.getUTCMonth();
  const isDST = month >= 2 && month <= 10; // March-November
  const offsetHours = isDST ? 4 : 5;

  const etHour = (date.getUTCHours() - offsetHours + 24) % 24;
  const etMinute = date.getUTCMinutes();

  // For M1: 9:30-9:34 (first 5 minutes)
  // For M5+: 9:30 candle only (covers the FCR window)
  if (tfMinutes === 1) {
    return (
      etHour === params.marketOpenHour &&
      etMinute >= params.marketOpenMinute &&
      etMinute < params.marketOpenMinute + params.fcrCandleCount
    );
  } else {
    // For M5, M15, etc: the candle starting at 9:30 is the FCR candle
    return etHour === params.marketOpenHour && etMinute === params.marketOpenMinute;
  }
}

/**
 * Check if candle is within the FCR trading window (9:30-10:30 AM ET)
 */
function isInFCRWindow(timestamp: number, params: FCRDetectorParams): boolean {
  const date = new Date(timestamp);
  const month = date.getUTCMonth();
  const isDST = month >= 2 && month <= 10;
  const offsetHours = isDST ? 4 : 5;

  const etHour = (date.getUTCHours() - offsetHours + 24) % 24;
  const etMinute = date.getUTCMinutes();

  // 9:30-10:30 AM ET
  if (etHour === params.marketOpenHour && etMinute >= params.marketOpenMinute) {
    return true;
  }
  if (etHour === params.marketOpenHour + 1 && etMinute <= 30) {
    return true;
  }
  return false;
}

/**
 * Get the date string (YYYY-MM-DD) in ET timezone
 */
function getETDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.getUTCMonth();
  const isDST = month >= 2 && month <= 10;
  const offsetHours = isDST ? 4 : 5;

  // Adjust to ET
  const etDate = new Date(timestamp - offsetHours * 60 * 60 * 1000);
  return etDate.toISOString().slice(0, 10);
}

/**
 * Detect bullish FVG in 3-candle sequence
 * Returns gap zone or null
 */
function detectBullishFVG(
  candleA: CandleInput,
  candleB: CandleInput,
  candleC: CandleInput
): { top: number; bottom: number } | null {
  // Bullish FVG: Candle C's low > Candle A's high
  if (candleC.low > candleA.high) {
    return {
      bottom: candleA.high,  // Bottom of gap
      top: candleC.low,      // Top of gap
    };
  }
  return null;
}

/**
 * Detect bearish FVG in 3-candle sequence
 * Returns gap zone or null
 */
function detectBearishFVG(
  candleA: CandleInput,
  candleB: CandleInput,
  candleC: CandleInput
): { top: number; bottom: number } | null {
  // Bearish FVG: Candle C's high < Candle A's low
  if (candleC.high < candleA.low) {
    return {
      top: candleA.low,      // Top of gap
      bottom: candleC.high,  // Bottom of gap
    };
  }
  return null;
}

/**
 * Check for bullish engulfing pattern
 */
function isBullishEngulfing(prev: CandleInput, curr: CandleInput): boolean {
  // Current candle is bullish (close > open)
  if (curr.close <= curr.open) return false;
  // Current candle's body engulfs previous candle's body
  return curr.close > prev.open && curr.open <= prev.close;
}

/**
 * Check for bearish engulfing pattern
 */
function isBearishEngulfing(prev: CandleInput, curr: CandleInput): boolean {
  // Current candle is bearish (close < open)
  if (curr.close >= curr.open) return false;
  // Current candle's body engulfs previous candle's body
  return curr.close < prev.open && curr.open >= prev.close;
}

/**
 * Create empty output arrays for the given candles
 */
function createEmptyOutputs(candles: CandleInput[]): FCRDetectorOutput {
  const empty = (v = 0): IndicatorValue[] =>
    candles.map((c) => ({ timestamp: c.timestamp, value: v }));

  return {
    fcrHigh: empty(NaN),
    fcrLow: empty(NaN),
    inFcrWindow: empty(0),
    breakoutUp: empty(0),
    breakoutDown: empty(0),
    fvgFormed: empty(0),
    fvgTop: empty(NaN),
    fvgBottom: empty(NaN),
    retest: empty(0),
    entryLong: empty(0),
    entryShort: empty(0),
    entryPrice: empty(NaN),
    stopLoss: empty(NaN),
    takeProfit: empty(NaN),
  };
}

/**
 * Compute FCR detector values
 *
 * @param candles - Array of candle data (M1, M5, M15, etc.)
 * @param params - Detection parameters
 * @returns Object containing all FCR signals and levels
 */
export function computeFCRDetector(
  candles: CandleInput[],
  params: Partial<FCRDetectorParams> = {}
): FCRDetectorOutput {
  const fullParams = { ...FCR_DETECTOR_DEFAULTS, ...params };
  const output = createEmptyOutputs(candles);

  if (candles.length === 0) return output;

  // Detect timeframe from candle spacing
  const tfMinutes = params.timeframeMinutes ?? detectTimeframeMinutes(candles);

  // FCR strategy only works on M1 and M5 timeframes
  // On higher timeframes, return empty outputs (no signals)
  // Taken trades persist via the drawing store regardless
  if (tfMinutes > 5) {
    return output;
  }

  // For M5, we use 1 candle as FCR instead of 5 (for M1)
  const fcrCandlesNeeded = tfMinutes >= 5 ? 1 : fullParams.fcrCandleCount;

  // Track state per trading day
  const dayStates = new Map<string, DayState>();

  function getOrCreateDayState(dateStr: string): DayState {
    if (!dayStates.has(dateStr)) {
      dayStates.set(dateStr, {
        date: dateStr,
        state: "waiting_for_open",
        fcrHigh: null,
        fcrLow: null,
        fcrCandles: [],
        breakoutDirection: null,
        breakoutCandle: null,
        fvgTop: null,
        fvgBottom: null,
        fvgCandleA: null,
        fvgCandleC: null,
        retestLow: null,
        retestHigh: null,
        entryCandle: null,
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
      });
    }
    return dayStates.get(dateStr)!;
  }

  // Process each candle
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const dateStr = getETDate(candle.timestamp);
    const day = getOrCreateDayState(dateStr);

    // Check if in FCR window
    const inWindow = isInFCRWindow(candle.timestamp, fullParams);
    output.inFcrWindow[i].value = inWindow ? 1 : 0;

    // State machine processing
    switch (day.state) {
      case "waiting_for_open":
        if (isInFCRFormationWindow(candle.timestamp, fullParams, tfMinutes)) {
          day.state = "building_fcr";
          day.fcrCandles = [candle];
          // For M5+, FCR is complete with 1 candle
          if (fcrCandlesNeeded === 1) {
            day.fcrHigh = candle.high;
            day.fcrLow = candle.low;
            day.state = "watching_breakout";
          }
        }
        break;

      case "building_fcr":
        if (isInFCRFormationWindow(candle.timestamp, fullParams, tfMinutes)) {
          day.fcrCandles.push(candle);

          // Check if FCR is complete
          if (day.fcrCandles.length >= fcrCandlesNeeded) {
            day.fcrHigh = Math.max(...day.fcrCandles.map((c) => c.high));
            day.fcrLow = Math.min(...day.fcrCandles.map((c) => c.low));
            day.state = "watching_breakout";
          }
        } else {
          // FCR window passed, compute from what we have
          if (day.fcrCandles.length > 0) {
            day.fcrHigh = Math.max(...day.fcrCandles.map((c) => c.high));
            day.fcrLow = Math.min(...day.fcrCandles.map((c) => c.low));
            day.state = "watching_breakout";
          } else {
            day.state = "session_done";
          }
        }
        break;

      case "watching_breakout":
        // Check for breakout
        if (day.fcrHigh !== null && day.fcrLow !== null) {
          // Bullish breakout: close above FCR high
          if (candle.close > day.fcrHigh) {
            output.breakoutUp[i].value = 1;
            day.breakoutDirection = "long";
            day.breakoutCandle = candle;
            day.state = "breakout_occurred";
          }
          // Bearish breakout: close below FCR low
          else if (candle.close < day.fcrLow) {
            output.breakoutDown[i].value = 1;
            day.breakoutDirection = "short";
            day.breakoutCandle = candle;
            day.state = "breakout_occurred";
          }
        }
        break;

      case "breakout_occurred":
        // Look for FVG in last 3 candles
        if (i >= 2) {
          const candleA = candles[i - 2];
          const candleB = candles[i - 1];
          const candleC = candle;

          if (day.breakoutDirection === "long") {
            const fvg = detectBullishFVG(candleA, candleB, candleC);
            if (fvg) {
              output.fvgFormed[i].value = 1;
              day.fvgTop = fvg.top;
              day.fvgBottom = fvg.bottom;
              day.fvgCandleA = candleA;
              day.fvgCandleC = candleC;
              day.state = "fvg_formed";
            }
          } else if (day.breakoutDirection === "short") {
            const fvg = detectBearishFVG(candleA, candleB, candleC);
            if (fvg) {
              output.fvgFormed[i].value = 1;
              day.fvgTop = fvg.top;
              day.fvgBottom = fvg.bottom;
              day.fvgCandleA = candleA;
              day.fvgCandleC = candleC;
              day.state = "fvg_formed";
            }
          }
        }
        break;

      case "fvg_formed":
        // Wait for retest (price enters FVG zone)
        if (day.fvgTop !== null && day.fvgBottom !== null) {
          if (day.breakoutDirection === "long") {
            // Bullish: candle low enters FVG zone
            if (candle.low <= day.fvgTop && candle.low >= day.fvgBottom) {
              output.retest[i].value = 1;
              day.retestLow = candle.low;
              day.state = "in_retest";
            }
          } else if (day.breakoutDirection === "short") {
            // Bearish: candle high enters FVG zone
            if (candle.high >= day.fvgBottom && candle.high <= day.fvgTop) {
              output.retest[i].value = 1;
              day.retestHigh = candle.high;
              day.state = "in_retest";
            }
          }
        }
        break;

      case "in_retest":
        // Track extremes during retest and look for engulfing entry
        if (day.breakoutDirection === "long") {
          // Track lowest low during retest
          if (day.retestLow === null || candle.low < day.retestLow) {
            day.retestLow = candle.low;
          }

          // Check for bullish engulfing
          if (i >= 1) {
            const prevCandle = candles[i - 1];
            if (isBullishEngulfing(prevCandle, candle)) {
              output.entryLong[i].value = 1;
              day.entryCandle = candle;
              day.entryPrice = candle.close;

              // Calculate SL and TP
              // Use price-based buffer (0.1% of price for indices, smaller for forex)
              const priceLevel = candle.close;
              const tickSize = priceLevel > 100 ? priceLevel * 0.0002 : 0.0001;
              day.stopLoss = day.retestLow - tickSize;
              const risk = day.entryPrice - day.stopLoss;
              day.takeProfit = day.entryPrice + risk * fullParams.riskRewardRatio;

              day.state = "entry_triggered";
            }
          }
        } else if (day.breakoutDirection === "short") {
          // Track highest high during retest
          if (day.retestHigh === null || candle.high > day.retestHigh) {
            day.retestHigh = candle.high;
          }

          // Check for bearish engulfing
          if (i >= 1) {
            const prevCandle = candles[i - 1];
            if (isBearishEngulfing(prevCandle, candle)) {
              output.entryShort[i].value = 1;
              day.entryCandle = candle;
              day.entryPrice = candle.close;

              // Calculate SL and TP
              // Use price-based buffer (0.1% of price for indices, smaller for forex)
              const priceLevel = candle.close;
              const tickSize = priceLevel > 100 ? priceLevel * 0.0002 : 0.0001;
              day.stopLoss = day.retestHigh + tickSize;
              const risk = day.stopLoss - day.entryPrice;
              day.takeProfit = day.entryPrice - risk * fullParams.riskRewardRatio;

              day.state = "entry_triggered";
            }
          }
        }
        break;

      case "entry_triggered":
      case "session_done":
        // No more processing for this day
        break;
    }

    // Update FCR levels (persist after formation)
    if (day.fcrHigh !== null) {
      output.fcrHigh[i].value = day.fcrHigh;
    }
    if (day.fcrLow !== null) {
      output.fcrLow[i].value = day.fcrLow;
    }

    // Update FVG levels (persist after detection)
    if (day.fvgTop !== null) {
      output.fvgTop[i].value = day.fvgTop;
    }
    if (day.fvgBottom !== null) {
      output.fvgBottom[i].value = day.fvgBottom;
    }

    // Update trade levels (persist after entry)
    if (day.entryPrice !== null) {
      output.entryPrice[i].value = day.entryPrice;
    }
    if (day.stopLoss !== null) {
      output.stopLoss[i].value = day.stopLoss;
    }
    if (day.takeProfit !== null) {
      output.takeProfit[i].value = day.takeProfit;
    }
  }

  return output;
}

/**
 * Get FCR setup info for a specific date
 */
export function getFCRSetupForDate(
  output: FCRDetectorOutput,
  dateStr: string,
  candles: CandleInput[]
): {
  fcrHigh: number | null;
  fcrLow: number | null;
  breakoutDirection: "long" | "short" | null;
  fvg: { top: number; bottom: number } | null;
  entry: { price: number; sl: number; tp: number } | null;
} {
  // Find candles for this date
  const dateCandles = candles.filter((c) => getETDate(c.timestamp) === dateStr);
  if (dateCandles.length === 0) {
    return {
      fcrHigh: null,
      fcrLow: null,
      breakoutDirection: null,
      fvg: null,
      entry: null,
    };
  }

  // Get the last candle's values (they persist throughout the day)
  const lastCandle = dateCandles[dateCandles.length - 1];
  const idx = candles.findIndex((c) => c.timestamp === lastCandle.timestamp);
  if (idx === -1) {
    return {
      fcrHigh: null,
      fcrLow: null,
      breakoutDirection: null,
      fvg: null,
      entry: null,
    };
  }

  const fcrHigh = output.fcrHigh[idx].value;
  const fcrLow = output.fcrLow[idx].value;

  // Check for breakout
  let breakoutDirection: "long" | "short" | null = null;
  for (const c of dateCandles) {
    const i = candles.findIndex((x) => x.timestamp === c.timestamp);
    if (i !== -1) {
      if (output.breakoutUp[i].value === 1) breakoutDirection = "long";
      if (output.breakoutDown[i].value === 1) breakoutDirection = "short";
    }
  }

  // Get FVG
  const fvgTop = output.fvgTop[idx].value;
  const fvgBottom = output.fvgBottom[idx].value;
  const fvg =
    !isNaN(fvgTop) && !isNaN(fvgBottom)
      ? { top: fvgTop, bottom: fvgBottom }
      : null;

  // Get entry
  const entryPrice = output.entryPrice[idx].value;
  const sl = output.stopLoss[idx].value;
  const tp = output.takeProfit[idx].value;
  const entry =
    !isNaN(entryPrice) && !isNaN(sl) && !isNaN(tp)
      ? { price: entryPrice, sl, tp }
      : null;

  return {
    fcrHigh: isNaN(fcrHigh) ? null : fcrHigh,
    fcrLow: isNaN(fcrLow) ? null : fcrLow,
    breakoutDirection,
    fvg,
    entry,
  };
}
