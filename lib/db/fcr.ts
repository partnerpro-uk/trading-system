/**
 * FCR (First Candle Range) Data Access Layer
 *
 * Dual-database routing:
 * - TimescaleDB: Recent M1 candles (last 30 days) for FCR window
 * - ClickHouse: Historical FCR windows (pre-computed with M1 arrays)
 *
 * This module provides functions to:
 * - Get FCR window data for a specific date
 * - Get M1 candles for the FCR window (9:30-10:30 AM ET)
 * - Query historical FCR statistics
 */

import { getClickHouseClient, getTimescalePool } from "./index";
import type { CandleInput } from "@/lib/indicators/types";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface FCRWindowData {
  date: string;           // YYYY-MM-DD
  pair: string;

  // FCR candle (first 5 M1 candles aggregated)
  fcrOpen: number;
  fcrHigh: number;
  fcrLow: number;
  fcrClose: number;
  fcrTime: Date;

  // M1 candles after FCR (for analysis)
  candles: CandleInput[];

  // Pre-computed setup (if available)
  breakoutDirection: "long" | "short" | null;
  fvg: { top: number; bottom: number } | null;
  entry: { time: Date; price: number } | null;
  stopLoss: number | null;
  takeProfit: number | null;
  outcome: "TP" | "SL" | "MANUAL" | "NO_SETUP" | "PENDING" | null;
}

export interface FCRStatistics {
  pair: string;
  yearMonth: number;      // YYYYMM format
  totalTradingDays: number;
  daysWithSetup: number;
  setupRate: number;      // Percentage
  longSetups: number;
  shortSetups: number;
  tpHits: number;
  slHits: number;
  winRate: number;        // Percentage
  totalPips: number;
  profitFactor: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert date string and ET time to UTC timestamp
 */
function etToUtc(dateStr: string, hourET: number, minuteET: number): Date {
  // Parse the date
  const [year, month, day] = dateStr.split("-").map(Number);

  // Approximate DST check (March-November)
  const isDST = month >= 3 && month <= 11;
  const offsetHours = isDST ? 4 : 5;

  // Create UTC date by adding offset
  const utc = new Date(Date.UTC(year, month - 1, day, hourET + offsetHours, minuteET, 0, 0));
  return utc;
}

/**
 * Get FCR window times for a date (9:30-10:30 AM ET)
 */
function getFCRWindowTimes(dateStr: string): { start: Date; end: Date } {
  return {
    start: etToUtc(dateStr, 9, 30),
    end: etToUtc(dateStr, 10, 30),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMESCALE QUERIES (Recent Data)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get M1 candles for FCR window from TimescaleDB (recent data)
 */
async function getFCRCandlesFromTimescale(
  pair: string,
  dateStr: string
): Promise<CandleInput[]> {
  const pool = getTimescalePool();
  const { start, end } = getFCRWindowTimes(dateStr);

  const query = `
    SELECT time, open, high, low, close, volume
    FROM candles
    WHERE pair = $1
      AND timeframe = 'M1'
      AND time >= $2
      AND time < $3
    ORDER BY time ASC
  `;

  const result = await pool.query(query, [pair, start.toISOString(), end.toISOString()]);

  return result.rows.map((row) => ({
    timestamp: row.time instanceof Date ? row.time.getTime() : new Date(row.time).getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// CLICKHOUSE QUERIES (Historical Data)
// ═══════════════════════════════════════════════════════════════════════════

interface ClickHouseFCRWindow {
  date: string;
  pair: string;
  fcr_open: number;
  fcr_high: number;
  fcr_low: number;
  fcr_close: number;
  fcr_time: string;
  candle_times: string[];
  candle_opens: number[];
  candle_highs: number[];
  candle_lows: number[];
  candle_closes: number[];
  candle_volumes: number[];
  candle_count: number;
  breakout_direction: string | null;
  fvg_top: number | null;
  fvg_bottom: number | null;
  entry_time: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  outcome: string | null;
}

/**
 * Get FCR window from ClickHouse (historical data)
 */
async function getFCRWindowFromClickHouse(
  pair: string,
  dateStr: string
): Promise<FCRWindowData | null> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      date,
      pair,
      fcr_open,
      fcr_high,
      fcr_low,
      fcr_close,
      fcr_time,
      candle_times,
      candle_opens,
      candle_highs,
      candle_lows,
      candle_closes,
      candle_volumes,
      candle_count,
      breakout_direction,
      fvg_top,
      fvg_bottom,
      entry_time,
      entry_price,
      stop_loss,
      take_profit,
      outcome
    FROM fcr_candle_windows
    WHERE pair = {pair:String} AND date = {date:Date}
  `;

  const result = await client.query({
    query,
    query_params: { pair, date: dateStr },
    format: "JSONEachRow",
  });

  const rows = await result.json<ClickHouseFCRWindow>();
  if (rows.length === 0) return null;

  const row = rows[0];

  // Convert parallel arrays to CandleInput[]
  const candles: CandleInput[] = [];
  for (let i = 0; i < row.candle_count; i++) {
    candles.push({
      timestamp: new Date(row.candle_times[i] + "Z").getTime(),
      open: row.candle_opens[i],
      high: row.candle_highs[i],
      low: row.candle_lows[i],
      close: row.candle_closes[i],
      volume: row.candle_volumes[i],
    });
  }

  return {
    date: row.date,
    pair: row.pair,
    fcrOpen: row.fcr_open,
    fcrHigh: row.fcr_high,
    fcrLow: row.fcr_low,
    fcrClose: row.fcr_close,
    fcrTime: new Date(row.fcr_time + "Z"),
    candles,
    breakoutDirection: row.breakout_direction as "long" | "short" | null,
    fvg:
      row.fvg_top !== null && row.fvg_bottom !== null
        ? { top: row.fvg_top, bottom: row.fvg_bottom }
        : null,
    entry:
      row.entry_time !== null && row.entry_price !== null
        ? { time: new Date(row.entry_time + "Z"), price: row.entry_price }
        : null,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    outcome: row.outcome as FCRWindowData["outcome"],
  };
}

/**
 * Get multiple FCR windows from ClickHouse
 */
async function getFCRWindowsFromClickHouse(
  pair: string,
  fromDate: string,
  toDate: string
): Promise<FCRWindowData[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      date,
      pair,
      fcr_open,
      fcr_high,
      fcr_low,
      fcr_close,
      fcr_time,
      candle_times,
      candle_opens,
      candle_highs,
      candle_lows,
      candle_closes,
      candle_volumes,
      candle_count,
      breakout_direction,
      fvg_top,
      fvg_bottom,
      entry_time,
      entry_price,
      stop_loss,
      take_profit,
      outcome
    FROM fcr_candle_windows
    WHERE pair = {pair:String}
      AND date >= {from:Date}
      AND date <= {to:Date}
    ORDER BY date ASC
  `;

  const result = await client.query({
    query,
    query_params: { pair, from: fromDate, to: toDate },
    format: "JSONEachRow",
  });

  const rows = await result.json<ClickHouseFCRWindow>();

  return rows.map((row) => {
    const candles: CandleInput[] = [];
    for (let i = 0; i < row.candle_count; i++) {
      candles.push({
        timestamp: new Date(row.candle_times[i] + "Z").getTime(),
        open: row.candle_opens[i],
        high: row.candle_highs[i],
        low: row.candle_lows[i],
        close: row.candle_closes[i],
        volume: row.candle_volumes[i],
      });
    }

    return {
      date: row.date,
      pair: row.pair,
      fcrOpen: row.fcr_open,
      fcrHigh: row.fcr_high,
      fcrLow: row.fcr_low,
      fcrClose: row.fcr_close,
      fcrTime: new Date(row.fcr_time + "Z"),
      candles,
      breakoutDirection: row.breakout_direction as "long" | "short" | null,
      fvg:
        row.fvg_top !== null && row.fvg_bottom !== null
          ? { top: row.fvg_top, bottom: row.fvg_bottom }
          : null,
      entry:
        row.entry_time !== null && row.entry_price !== null
          ? { time: new Date(row.entry_time + "Z"), price: row.entry_price }
          : null,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      outcome: row.outcome as FCRWindowData["outcome"],
    };
  });
}

/**
 * Get FCR statistics from ClickHouse
 */
async function getFCRStatisticsFromClickHouse(
  pair: string,
  yearMonth?: number
): Promise<FCRStatistics[]> {
  const client = getClickHouseClient();

  const conditions = ["pair = {pair:String}"];
  const params: Record<string, unknown> = { pair };

  if (yearMonth) {
    conditions.push("year_month = {ym:UInt32}");
    params.ym = yearMonth;
  }

  const query = `
    SELECT
      pair,
      year_month,
      total_trading_days,
      days_with_setup,
      setup_rate,
      long_setups,
      short_setups,
      tp_hits,
      sl_hits,
      win_rate,
      total_pips,
      profit_factor
    FROM fcr_statistics
    WHERE ${conditions.join(" AND ")}
    ORDER BY year_month DESC
  `;

  const result = await client.query({
    query,
    query_params: params,
    format: "JSONEachRow",
  });

  interface CHStats {
    pair: string;
    year_month: number;
    total_trading_days: number;
    days_with_setup: number;
    setup_rate: number;
    long_setups: number;
    short_setups: number;
    tp_hits: number;
    sl_hits: number;
    win_rate: number;
    total_pips: number;
    profit_factor: number;
  }

  const rows = await result.json<CHStats>();

  return rows.map((row) => ({
    pair: row.pair,
    yearMonth: row.year_month,
    totalTradingDays: row.total_trading_days,
    daysWithSetup: row.days_with_setup,
    setupRate: row.setup_rate,
    longSetups: row.long_setups,
    shortSetups: row.short_setups,
    tpHits: row.tp_hits,
    slHits: row.sl_hits,
    winRate: row.win_rate,
    totalPips: row.total_pips,
    profitFactor: row.profit_factor,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get FCR window data for a specific date
 *
 * Routes to Timescale for recent dates, ClickHouse for historical
 *
 * @param pair - Trading pair (e.g., "SPX500_USD")
 * @param dateStr - Date string (YYYY-MM-DD)
 * @returns FCR window data or null if not available
 */
export async function getFCRWindow(
  pair: string,
  dateStr: string
): Promise<FCRWindowData | null> {
  // Check if date is recent (within last 30 days)
  const date = new Date(dateStr);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  if (date >= thirtyDaysAgo) {
    // Try Timescale first for recent data
    try {
      const candles = await getFCRCandlesFromTimescale(pair, dateStr);
      if (candles.length >= 5) {
        // Aggregate first 5 candles to FCR
        const fcrCandles = candles.slice(0, 5);
        const remainingCandles = candles.slice(5);

        return {
          date: dateStr,
          pair,
          fcrOpen: fcrCandles[0].open,
          fcrHigh: Math.max(...fcrCandles.map((c) => c.high)),
          fcrLow: Math.min(...fcrCandles.map((c) => c.low)),
          fcrClose: fcrCandles[fcrCandles.length - 1].close,
          fcrTime: new Date(fcrCandles[0].timestamp),
          candles: remainingCandles,
          breakoutDirection: null, // Not pre-computed
          fvg: null,
          entry: null,
          stopLoss: null,
          takeProfit: null,
          outcome: null,
        };
      }
    } catch (error) {
      console.warn("Timescale query failed for FCR window:", error);
    }
  }

  // Fall back to ClickHouse for historical data
  return getFCRWindowFromClickHouse(pair, dateStr);
}

/**
 * Get M1 candles for FCR analysis (full 60 minutes)
 *
 * @param pair - Trading pair
 * @param dateStr - Date string (YYYY-MM-DD)
 * @returns Array of M1 candles for 9:30-10:30 AM ET
 */
export async function getFCRCandles(
  pair: string,
  dateStr: string
): Promise<CandleInput[]> {
  // Check if date is recent
  const date = new Date(dateStr);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  if (date >= thirtyDaysAgo) {
    try {
      const candles = await getFCRCandlesFromTimescale(pair, dateStr);
      if (candles.length > 0) return candles;
    } catch (error) {
      console.warn("Timescale query failed:", error);
    }
  }

  // Fall back to ClickHouse
  const window = await getFCRWindowFromClickHouse(pair, dateStr);
  if (!window) return [];

  // Reconstruct full candle array (FCR + remaining)
  const fcrCandle: CandleInput = {
    timestamp: window.fcrTime.getTime(),
    open: window.fcrOpen,
    high: window.fcrHigh,
    low: window.fcrLow,
    close: window.fcrClose,
    volume: 0,
  };

  return [fcrCandle, ...window.candles];
}

/**
 * Get FCR windows for a date range
 *
 * @param pair - Trading pair
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @returns Array of FCR window data
 */
export async function getFCRWindows(
  pair: string,
  fromDate: string,
  toDate: string
): Promise<FCRWindowData[]> {
  return getFCRWindowsFromClickHouse(pair, fromDate, toDate);
}

/**
 * Get FCR performance statistics
 *
 * @param pair - Trading pair
 * @param yearMonth - Optional YYYYMM filter
 * @returns Array of monthly statistics
 */
export async function getFCRStatistics(
  pair: string,
  yearMonth?: number
): Promise<FCRStatistics[]> {
  return getFCRStatisticsFromClickHouse(pair, yearMonth);
}

/**
 * Get available dates with FCR data
 */
export async function getAvailableFCRDates(
  pair: string
): Promise<{ earliest: Date; latest: Date } | null> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      min(date) as earliest,
      max(date) as latest
    FROM fcr_candle_windows
    WHERE pair = {pair:String}
  `;

  const result = await client.query({
    query,
    query_params: { pair },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ earliest: string; latest: string }>();
  if (rows.length === 0 || !rows[0].earliest) return null;

  return {
    earliest: new Date(rows[0].earliest),
    latest: new Date(rows[0].latest),
  };
}

/**
 * Get FCR pairs available in the database
 */
export async function getAvailableFCRPairs(): Promise<string[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT DISTINCT pair
    FROM fcr_candle_windows
    ORDER BY pair
  `;

  const result = await client.query({
    query,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ pair: string }>();
  return rows.map((r) => r.pair);
}
