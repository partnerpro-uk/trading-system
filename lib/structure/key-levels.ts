/**
 * Key Level Grid Computation
 *
 * Computes PDH/PDL, PWH/PWL, PMH/PML, YH/YL from candle data.
 * These are the price levels the market watches — they give BOS events
 * their significance and act as support/resistance.
 */

import type { Candle, KeyLevelGrid, KeyLevelEntry } from "./types";

/** Significance scores for the key level hierarchy */
const SIGNIFICANCE: Record<string, number> = {
  YH: 5,
  YL: 5,
  PMH: 4,
  PML: 4,
  PWH: 3,
  PWL: 3,
  PDH: 2,
  PDL: 2,
};

/**
 * Get the last COMPLETED candle from an array.
 * The last candle might be the current (incomplete) one,
 * so we take the second-to-last if available.
 */
function getLastCompleted(candles: Candle[]): Candle | null {
  if (candles.length < 2) return null;
  return candles[candles.length - 2];
}

/**
 * Compute the key level grid from daily, weekly, and monthly candles.
 *
 * PDH/PDL: last completed daily candle's high/low
 * PWH/PWL: last completed weekly candle's high/low
 * PMH/PML: last completed monthly candle's high/low
 * YH/YL:   max high / min low of current calendar year daily candles
 */
export function computeKeyLevels(
  pair: string,
  dailyCandles: Candle[],
  weeklyCandles: Candle[],
  monthlyCandles: Candle[]
): KeyLevelGrid {
  const grid: KeyLevelGrid = {
    pdh: null,
    pdl: null,
    pwh: null,
    pwl: null,
    pmh: null,
    pml: null,
    yh: null,
    yl: null,
  };

  // PDH/PDL from last completed daily candle
  const lastDaily = getLastCompleted(dailyCandles);
  if (lastDaily) {
    grid.pdh = lastDaily.high;
    grid.pdl = lastDaily.low;
  }

  // PWH/PWL from last completed weekly candle
  const lastWeekly = getLastCompleted(weeklyCandles);
  if (lastWeekly) {
    grid.pwh = lastWeekly.high;
    grid.pwl = lastWeekly.low;
  }

  // PMH/PML from last completed monthly candle
  const lastMonthly = getLastCompleted(monthlyCandles);
  if (lastMonthly) {
    grid.pmh = lastMonthly.high;
    grid.pml = lastMonthly.low;
  }

  // YH/YL from current year daily candles
  const currentYear = new Date().getUTCFullYear();
  const yearCandles = dailyCandles.filter((c) => {
    const d = new Date(c.timestamp);
    return d.getUTCFullYear() === currentYear;
  });

  if (yearCandles.length > 0) {
    grid.yh = Math.max(...yearCandles.map((c) => c.high));
    grid.yl = Math.min(...yearCandles.map((c) => c.low));
  }

  return grid;
}

/**
 * Flatten a KeyLevelGrid into an array of KeyLevelEntry objects.
 * Filters out null values. Each entry has a label, price, and significance score.
 */
export function keyLevelGridToEntries(grid: KeyLevelGrid): KeyLevelEntry[] {
  const entries: KeyLevelEntry[] = [];

  const mapping: Array<[keyof KeyLevelGrid, string]> = [
    ["pdh", "PDH"],
    ["pdl", "PDL"],
    ["pwh", "PWH"],
    ["pwl", "PWL"],
    ["pmh", "PMH"],
    ["pml", "PML"],
    ["yh", "YH"],
    ["yl", "YL"],
  ];

  for (const [key, label] of mapping) {
    const price = grid[key];
    if (price !== null) {
      entries.push({
        label,
        price,
        significance: SIGNIFICANCE[label] ?? 1,
      });
    }
  }

  return entries;
}
