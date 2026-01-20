/**
 * Candle queries with dual-database routing
 *
 * - TimescaleDB: Live streaming data + recent candles (continuous aggregates)
 * - ClickHouse: Historical candle data (all history)
 *
 * Query routing:
 * - Recent requests prioritize Timescale (fresher data)
 * - Historical requests use ClickHouse
 * - Spanning queries merge from both sources
 */

import { getClickHouseClient, getTimescalePool } from "./index";

export interface Candle {
  time: string; // ISO timestamp
  timestamp: number; // Unix milliseconds (for chart compatibility)
  pair: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ClickHouseCandle {
  time: string;
  pair: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// All timeframes are now stored directly in the 'candles' table
// No more continuous aggregates - OANDA worker fetches real OHLC for each timeframe

/**
 * Query candles from Timescale (live/recent data)
 * All timeframes stored in single 'candles' table with timeframe column
 */
async function getCandlesFromTimescale(
  pair: string,
  timeframe: string,
  limit: number,
  before?: Date
): Promise<Candle[]> {
  const pool = getTimescalePool();

  const beforeClause = before ? `AND time < $4` : "";
  const params = before
    ? [pair, timeframe, limit, before.toISOString()]
    : [pair, timeframe, limit];

  const query = `
    SELECT
      time,
      pair,
      timeframe,
      open,
      high,
      low,
      close,
      volume
    FROM candles
    WHERE pair = $1 AND timeframe = $2 ${beforeClause}
    ORDER BY time DESC
    LIMIT $3
  `;

  const result = await pool.query(query, params);

  return result.rows.map((row) => ({
    time: row.time instanceof Date ? row.time.toISOString() : String(row.time),
    timestamp: row.time instanceof Date ? row.time.getTime() : new Date(row.time).getTime(),
    pair: row.pair,
    timeframe: timeframe,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume || 0),
  }));
}

/**
 * Query candles from ClickHouse (historical data)
 */
async function getCandlesFromClickHouse(
  pair: string,
  timeframe: string,
  limit: number,
  before?: Date
): Promise<Candle[]> {
  const client = getClickHouseClient();

  const beforeClause = before
    ? `AND time < {before:DateTime}`
    : "";
  const query_params: Record<string, unknown> = { pair, timeframe, limit };
  if (before) {
    query_params.before = before.toISOString().replace("T", " ").slice(0, 19);
  }

  const query = `
    SELECT time, pair, timeframe, open, high, low, close, volume
    FROM candles
    WHERE pair = {pair:String} AND timeframe = {timeframe:String} ${beforeClause}
    ORDER BY time DESC
    LIMIT {limit:UInt32}
  `;

  const result = await client.query({
    query,
    query_params,
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as ClickHouseCandle[];

  return rows.map((row) => ({
    time: row.time,
    timestamp: new Date(row.time + "Z").getTime(),
    pair: row.pair,
    timeframe: row.timeframe,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

/**
 * Get candles for a pair and timeframe
 *
 * @param pair - Currency pair (e.g., "EUR_USD")
 * @param timeframe - Timeframe (e.g., "M15", "H1", "D")
 * @param limit - Maximum number of candles to return (default: 1000)
 */
export async function getCandles(
  pair: string,
  timeframe: string,
  limit: number = 1000
): Promise<Candle[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT time, pair, timeframe, open, high, low, close, volume
    FROM candles
    WHERE pair = {pair:String} AND timeframe = {timeframe:String}
    ORDER BY time ASC
    LIMIT {limit:UInt32}
  `;

  const result = await client.query({
    query,
    query_params: { pair, timeframe, limit },
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as ClickHouseCandle[];

  // Convert to chart-compatible format
  return rows.map((row: ClickHouseCandle) => ({
    time: row.time,
    timestamp: new Date(row.time + "Z").getTime(), // Ensure UTC interpretation
    pair: row.pair,
    timeframe: row.timeframe,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

/**
 * Get the latest N candles for a pair and timeframe
 * Uses dual-source routing: Timescale for recent, ClickHouse for historical
 * (Returns in ascending order for chart display)
 */
export async function getLatestCandles(
  pair: string,
  timeframe: string,
  limit: number = 500
): Promise<Candle[]> {
  // Strategy: Query Timescale first (has freshest data), then ClickHouse for older data
  let candles: Candle[] = [];

  try {
    // 1. Get recent candles from Timescale (includes live data)
    const timescaleCandles = await getCandlesFromTimescale(pair, timeframe, limit);
    candles = timescaleCandles;

    // 2. If we need more candles, get older ones from ClickHouse
    if (candles.length < limit) {
      const remaining = limit - candles.length;

      // Find the oldest timestamp we have from Timescale to avoid overlap
      const oldestTimescale = candles.length > 0
        ? new Date(Math.min(...candles.map((c) => c.timestamp)))
        : undefined;

      const clickhouseCandles = await getCandlesFromClickHouse(
        pair,
        timeframe,
        remaining,
        oldestTimescale
      );

      // Merge: ClickHouse (older) + Timescale (newer)
      candles = [...clickhouseCandles, ...candles];
    }
  } catch (timescaleError) {
    // Timescale unavailable, fall back to ClickHouse only
    console.warn("Timescale query failed, using ClickHouse only:", timescaleError);
    candles = await getCandlesFromClickHouse(pair, timeframe, limit);
  }

  // Dedupe by timestamp (in case of overlap at boundaries)
  const seen = new Set<number>();
  const deduped = candles.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });

  // Sort ascending by timestamp (oldest first) for chart
  deduped.sort((a, b) => a.timestamp - b.timestamp);

  return deduped;
}

/**
 * Get candle count for a pair and timeframe
 */
export async function getCandleCount(
  pair: string,
  timeframe: string
): Promise<number> {
  const client = getClickHouseClient();

  const query = `
    SELECT count() as count
    FROM candles
    WHERE pair = {pair:String} AND timeframe = {timeframe:String}
  `;

  const result = await client.query({
    query,
    query_params: { pair, timeframe },
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as Array<{ count: string }>;
  return rows.length > 0 ? parseInt(rows[0].count, 10) : 0;
}

/**
 * Get all available pairs
 */
export async function getAvailablePairs(): Promise<string[]> {
  const client = getClickHouseClient();

  const query = `
    SELECT DISTINCT pair
    FROM candles
    ORDER BY pair
  `;

  const result = await client.query({
    query,
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as Array<{ pair: string }>;
  return rows.map((r) => r.pair);
}

/**
 * Get candles before a specific timestamp (for scroll-back pagination)
 * Queries from both Timescale and ClickHouse, merging results
 * Returns in ascending order (oldest first)
 */
export async function getCandlesBefore(
  pair: string,
  timeframe: string,
  beforeTimestamp: number,
  limit: number = 500
): Promise<Candle[]> {
  const beforeDate = new Date(beforeTimestamp);
  let candles: Candle[] = [];

  try {
    // Try Timescale first (may have some older data)
    const timescaleCandles = await getCandlesFromTimescale(
      pair,
      timeframe,
      limit,
      beforeDate
    );
    candles = timescaleCandles;

    // If we need more, get from ClickHouse
    if (candles.length < limit) {
      const remaining = limit - candles.length;

      // Find the oldest timestamp from Timescale results
      const oldestFromTimescale = candles.length > 0
        ? new Date(Math.min(...candles.map((c) => c.timestamp)))
        : beforeDate;

      const clickhouseCandles = await getCandlesFromClickHouse(
        pair,
        timeframe,
        remaining,
        oldestFromTimescale
      );

      // Merge: ClickHouse (older) + Timescale (newer)
      candles = [...clickhouseCandles, ...candles];
    }
  } catch (timescaleError) {
    // Timescale unavailable, use ClickHouse only
    console.warn("Timescale query failed for getCandlesBefore, using ClickHouse only:", timescaleError);
    candles = await getCandlesFromClickHouse(pair, timeframe, limit, beforeDate);
  }

  // Dedupe by timestamp
  const seen = new Set<number>();
  const deduped = candles.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });

  // Sort ascending (oldest first) for chart
  deduped.sort((a, b) => a.timestamp - b.timestamp);

  return deduped;
}

/**
 * Get latest prices for all pairs (for sidebar display)
 * Queries the latest M1 candle close price for each pair from Timescale
 */
export interface PriceData {
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

export async function getLatestPrices(pairs: string[]): Promise<Record<string, PriceData>> {
  const pool = getTimescalePool();

  // Get the latest 2 M1 candles for each pair to calculate change
  // Using a lateral join for efficiency
  const query = `
    WITH ranked AS (
      SELECT
        pair,
        close,
        time,
        ROW_NUMBER() OVER (PARTITION BY pair ORDER BY time DESC) as rn
      FROM candles
      WHERE pair = ANY($1)
        AND time > NOW() - INTERVAL '1 day'
    )
    SELECT
      pair,
      MAX(CASE WHEN rn = 1 THEN close END) as latest_price,
      MAX(CASE WHEN rn = 1 THEN time END) as latest_time,
      MAX(CASE WHEN rn = 2 THEN close END) as prev_price
    FROM ranked
    WHERE rn <= 2
    GROUP BY pair
  `;

  try {
    const result = await pool.query(query, [pairs]);
    const prices: Record<string, PriceData> = {};

    for (const row of result.rows) {
      const latestPrice = Number(row.latest_price);
      const prevPrice = row.prev_price ? Number(row.prev_price) : latestPrice;
      const change = latestPrice - prevPrice;
      const changePercent = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;

      prices[row.pair] = {
        price: latestPrice,
        change,
        changePercent,
        timestamp: row.latest_time instanceof Date ? row.latest_time.getTime() : new Date(row.latest_time).getTime(),
      };
    }

    return prices;
  } catch (error) {
    console.error("Error fetching latest prices from Timescale:", error);
    return {};
  }
}

/**
 * Get data range (earliest and latest timestamps) for a pair
 */
export async function getDataRange(
  pair: string,
  timeframe: string
): Promise<{ earliest: Date; latest: Date } | null> {
  const client = getClickHouseClient();

  const query = `
    SELECT
      min(time) as earliest,
      max(time) as latest
    FROM candles
    WHERE pair = {pair:String} AND timeframe = {timeframe:String}
  `;

  const result = await client.query({
    query,
    query_params: { pair, timeframe },
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as Array<{ earliest: string; latest: string }>;

  if (rows.length === 0 || !rows[0].earliest) {
    return null;
  }

  return {
    earliest: new Date(rows[0].earliest + "Z"),
    latest: new Date(rows[0].latest + "Z"),
  };
}
