#!/usr/bin/env npx tsx
/**
 * Backfill BTC data from Binance to ClickHouse
 *
 * Usage: npx tsx scripts/migrate/backfill-btc-binance.ts [timeframe]
 * Example: npx tsx scripts/migrate/backfill-btc-binance.ts M15
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Binance interval mapping
const TIMEFRAMES: Record<string, string> = {
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D: "1d",
  W: "1w",
  M: "1M",
};

const MAX_CANDLES = 1000; // Binance limit per request
const DELAY_MS = 100; // Rate limit protection

interface BinanceKline {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchBinanceCandles(
  interval: string,
  startTime: number,
  endTime: number
): Promise<BinanceKline[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${MAX_CANDLES}`;

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Binance error: ${response.status} - ${text}`);
  }

  const data = await response.json();

  return data.map((k: any[]) => ({
    time: new Date(k[0]).toISOString().replace("T", " ").replace("Z", "").split(".")[0],
    open: parseFloat(parseFloat(k[1]).toFixed(5)),
    high: parseFloat(parseFloat(k[2]).toFixed(5)),
    low: parseFloat(parseFloat(k[3]).toFixed(5)),
    close: parseFloat(parseFloat(k[4]).toFixed(5)),
    volume: Math.round(parseFloat(k[5])), // UInt32 - must be integer
  }));
}

async function insertToClickHouse(
  candles: BinanceKline[],
  timeframe: string
): Promise<number> {
  if (candles.length === 0) return 0;

  // Group by month for partitions
  const byMonth: Record<string, BinanceKline[]> = {};
  for (const c of candles) {
    const yyyymm = c.time.slice(0, 7).replace("-", "");
    if (!byMonth[yyyymm]) byMonth[yyyymm] = [];
    byMonth[yyyymm].push(c);
  }

  let inserted = 0;
  for (const monthCandles of Object.values(byMonth)) {
    const rows = monthCandles.map((c) => ({
      time: c.time,
      pair: "BTC_USD",
      timeframe,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    await clickhouse.insert({
      table: "candles",
      values: rows,
      format: "JSONEachRow",
    });

    inserted += rows.length;
  }

  return inserted;
}

// Get interval duration in milliseconds
function getIntervalMs(interval: string): number {
  const map: Record<string, number> = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "1M": 30 * 24 * 60 * 60 * 1000, // Approximate
  };
  return map[interval] || 60000;
}

async function backfillTimeframe(timeframe: string): Promise<number> {
  const interval = TIMEFRAMES[timeframe];
  if (!interval) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  console.log(`\n=== BTC_USD ${timeframe} ===`);

  // BTC on Binance started Aug 17, 2017
  const startTime = new Date("2017-08-17T00:00:00Z").getTime();
  const endTime = Date.now();
  const intervalMs = getIntervalMs(interval);

  let currentStart = startTime;
  let totalInserted = 0;

  while (currentStart < endTime) {
    try {
      const candles = await fetchBinanceCandles(interval, currentStart, endTime);

      if (candles.length === 0) break;

      const inserted = await insertToClickHouse(candles, timeframe);
      totalInserted += inserted;

      const lastTime = candles[candles.length - 1].time;
      process.stdout.write(`\r  BTC_USD ${timeframe}: ${totalInserted.toLocaleString()} candles (${lastTime.slice(0, 10)})    `);

      // Move to next batch
      const lastTimestamp = new Date(candles[candles.length - 1].time + "Z").getTime();
      currentStart = lastTimestamp + intervalMs;

      if (candles.length < MAX_CANDLES) break;

      await new Promise((r) => setTimeout(r, DELAY_MS));
    } catch (err: any) {
      console.error(`\n  Error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log(`\n  BTC_USD ${timeframe}: Complete (${totalInserted.toLocaleString()} candles)`);
  return totalInserted;
}

async function main(): Promise<void> {
  console.log("═".repeat(50));
  console.log("  BTC BACKFILL (Binance → ClickHouse)");
  console.log("═".repeat(50));

  // Test ClickHouse connection
  const result = await clickhouse.query({
    query: "SELECT version()",
    format: "JSONEachRow",
  });
  const version = await result.json();
  console.log(`Connected to ClickHouse v${(version as any)[0]["version()"]}\n`);

  const timeframe = process.argv[2];

  let grandTotal = 0;

  if (timeframe) {
    if (!TIMEFRAMES[timeframe]) {
      console.error(`Invalid timeframe: ${timeframe}`);
      console.error(`Valid: ${Object.keys(TIMEFRAMES).join(", ")}`);
      process.exit(1);
    }
    grandTotal = await backfillTimeframe(timeframe);
  } else {
    // All timeframes (larger first for speed)
    const order = ["M", "W", "D", "H4", "H1", "M30", "M15", "M5"];

    for (const tf of order) {
      grandTotal += await backfillTimeframe(tf);
    }
  }

  console.log("\n" + "═".repeat(50));
  console.log(`  BTC COMPLETE: ${grandTotal.toLocaleString()} candles`);
  console.log("═".repeat(50));

  await clickhouse.close();
}

main().catch(console.error);
