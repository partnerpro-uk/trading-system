#!/usr/bin/env npx tsx
/**
 * Backfill FCR Candle Windows to ClickHouse
 *
 * Fetches M1 candles for the FCR window (9:30-10:30 AM ET) from OANDA,
 * aggregates first 5 candles to FCR range, stores to ClickHouse fcr_candle_windows.
 *
 * FCR Window:
 *   - 9:30-9:35 AM ET: FCR candle (aggregated from 5 x M1)
 *   - 9:35-10:30 AM ET: M1 candles for analysis (~55 candles)
 *
 * Only runs for US trading days (weekdays, excluding major holidays).
 *
 * Usage:
 *   npx tsx src/historical-backfill/backfill-fcr-windows.ts
 *   npx tsx src/historical-backfill/backfill-fcr-windows.ts --from 2023 --to 2025
 *   npx tsx src/historical-backfill/backfill-fcr-windows.ts --pair SPX500_USD
 *   npx tsx src/historical-backfill/backfill-fcr-windows.ts --date 2024-01-15
 */

import { config } from "dotenv";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../../../.env.local") });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

// US index pairs suitable for FCR strategy
const FCR_PAIRS = [
  "SPX500_USD",
  "NAS100_USD",
  "US30_USD",
  "US2000_USD",
] as const;

// FCR window: 9:30-10:30 AM ET (60 minutes, 60 M1 candles)
const FCR_START_HOUR_ET = 9;
const FCR_START_MINUTE_ET = 30;
const FCR_WINDOW_MINUTES = 60;
const FCR_CANDLE_MINUTES = 5; // First 5 M1 candles form FCR

// US holidays (markets closed) - simplified list, can expand
const US_HOLIDAYS: Set<string> = new Set([
  // 2023
  "2023-01-02", "2023-01-16", "2023-02-20", "2023-04-07", "2023-05-29",
  "2023-06-19", "2023-07-04", "2023-09-04", "2023-11-23", "2023-12-25",
  // 2024
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
  "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
]);

const OANDA_DELAY_MS = 50; // 20 requests/sec max
const BATCH_SIZE = 50; // Days per batch insert

let PROGRESS_FILE = join(__dirname, "fcr-windows-progress.json");

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════════════════════════════

let clickhouse: ClickHouseClient;

function initClickHouse(): ClickHouseClient {
  if (!process.env.CLICKHOUSE_HOST) {
    throw new Error("CLICKHOUSE_HOST environment variable is not set");
  }

  return createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    request_timeout: 60000,
  });
}

const OANDA_API_KEY = process.env.OANDA_API_KEY;
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS TRACKING
// ═══════════════════════════════════════════════════════════════════════════

interface Progress {
  started: string;
  lastDate: string | null;
  totalDaysProcessed: number;
  totalWindowsInserted: number;
  totalErrors: number;
  lastUpdated: string;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
    } catch {
      console.warn("[Progress] Could not load progress file, starting fresh");
    }
  }
  return {
    started: new Date().toISOString(),
    lastDate: null,
    totalDaysProcessed: 0,
    totalWindowsInserted: 0,
    totalErrors: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function saveProgress(progress: Progress): void {
  progress.lastUpdated = new Date().toISOString();
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // Not Sunday or Saturday
}

function isHoliday(dateStr: string): boolean {
  return US_HOLIDAYS.has(dateStr);
}

function isTradingDay(date: Date): boolean {
  const dateStr = date.toISOString().slice(0, 10);
  return isWeekday(date) && !isHoliday(dateStr);
}

function getTradingDays(fromYear: number, toYear: number, afterDate?: string | null): string[] {
  const days: string[] = [];
  const start = new Date(`${fromYear}-01-01T00:00:00Z`);
  const end = new Date(`${toYear + 1}-01-01T00:00:00Z`);
  const today = new Date();

  for (let d = new Date(start); d < end && d <= today; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);

    // Skip if before afterDate
    if (afterDate && dateStr <= afterDate) {
      continue;
    }

    if (isTradingDay(d)) {
      days.push(dateStr);
    }
  }

  return days;
}

/**
 * Convert ET time to UTC timestamp for a given date
 * Handles DST automatically
 */
function etToUtc(dateStr: string, hourET: number, minuteET: number): number {
  // Create date in ET timezone
  const etDate = new Date(`${dateStr}T${String(hourET).padStart(2, "0")}:${String(minuteET).padStart(2, "0")}:00`);

  // Get UTC offset for this date (handles DST)
  // EDT (summer): UTC-4, EST (winter): UTC-5
  const month = parseInt(dateStr.slice(5, 7), 10);
  const isEDT = month >= 3 && month <= 11; // Simplified DST check
  const offsetHours = isEDT ? 4 : 5;

  // Add offset to get UTC
  return etDate.getTime() + offsetHours * 60 * 60 * 1000;
}

// ═══════════════════════════════════════════════════════════════════════════
// OANDA FETCH
// ═══════════════════════════════════════════════════════════════════════════

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchOandaWindow(
  pair: string,
  dateStr: string,
  retries = 3
): Promise<{ success: boolean; candles?: Candle[]; error?: string }> {
  if (!OANDA_API_KEY) {
    return { success: false, error: "OANDA_API_KEY not set" };
  }

  // FCR window: 9:30-10:30 AM ET
  const windowStart = etToUtc(dateStr, FCR_START_HOUR_ET, FCR_START_MINUTE_ET);
  const windowEnd = windowStart + FCR_WINDOW_MINUTES * 60 * 1000;

  const params = new URLSearchParams({
    granularity: "M1",
    from: new Date(windowStart).toISOString(),
    to: new Date(windowEnd).toISOString(),
    price: "M",
  });

  try {
    const response = await fetch(`${OANDA_API_URL}/v3/instruments/${pair}/candles?${params}`, {
      headers: {
        Authorization: `Bearer ${OANDA_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      // Retry on rate limit (429) or server errors (5xx)
      if ((response.status === 429 || response.status >= 500) && retries > 0) {
        await new Promise((r) => setTimeout(r, 1000 * (4 - retries)));
        return fetchOandaWindow(pair, dateStr, retries - 1);
      }
      return { success: false, error: `${response.status}: ${text.slice(0, 100)}` };
    }

    const data = await response.json();

    if (!data.candles || data.candles.length === 0) {
      return { success: false, error: "No candles returned" };
    }

    const candles: Candle[] = data.candles.map((c: any) => ({
      time: new Date(c.time).getTime(),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume || 0,
    }));

    return { success: true, candles };
  } catch (error) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 500));
      return fetchOandaWindow(pair, dateStr, retries - 1);
    }
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FCR AGGREGATION
// ═══════════════════════════════════════════════════════════════════════════

interface FCRData {
  fcrOpen: number;
  fcrHigh: number;
  fcrLow: number;
  fcrClose: number;
  fcrTime: number;
  remainingCandles: Candle[];
}

function aggregateFCR(candles: Candle[]): FCRData | null {
  if (candles.length < FCR_CANDLE_MINUTES) {
    return null;
  }

  // First 5 candles (9:30-9:35) form the FCR
  const fcrCandles = candles.slice(0, FCR_CANDLE_MINUTES);
  const remainingCandles = candles.slice(FCR_CANDLE_MINUTES);

  return {
    fcrOpen: fcrCandles[0].open,
    fcrHigh: Math.max(...fcrCandles.map((c) => c.high)),
    fcrLow: Math.min(...fcrCandles.map((c) => c.low)),
    fcrClose: fcrCandles[fcrCandles.length - 1].close,
    fcrTime: fcrCandles[0].time,
    remainingCandles,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLICKHOUSE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

interface FCRWindowRecord {
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
}

async function insertWindowBatch(windows: FCRWindowRecord[]): Promise<number> {
  if (windows.length === 0) return 0;

  await clickhouse.insert({
    table: "fcr_candle_windows",
    values: windows,
    format: "JSONEachRow",
  });

  return windows.length;
}

async function getExistingDatesForPair(pair: string, fromYear: number, toYear: number): Promise<Set<string>> {
  const result = await clickhouse.query({
    query: `
      SELECT toString(date) as date
      FROM fcr_candle_windows
      WHERE pair = '${pair}'
        AND date >= '${fromYear}-01-01'
        AND date < '${toYear + 1}-01-01'
    `,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ date: string }>();
  return new Set(rows.map((r) => r.date));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let fromYear = 2020;
  let toYear = new Date().getFullYear();
  let pairFilter: string | undefined;
  let dateFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) fromYear = parseInt(args[++i], 10);
    else if (args[i] === "--to" && args[i + 1]) toYear = parseInt(args[++i], 10);
    else if (args[i] === "--pair" && args[i + 1]) pairFilter = args[++i];
    else if (args[i] === "--date" && args[i + 1]) dateFilter = args[++i];
    else if (args[i] === "--reset") {
      if (existsSync(PROGRESS_FILE)) {
        const fs = await import("fs");
        fs.unlinkSync(PROGRESS_FILE);
        console.log("Progress file reset");
      }
      return;
    }
  }

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║               FCR CANDLE WINDOW BACKFILL                          ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  console.log("Configuration:");
  console.log(`  Year range:     ${fromYear}-${toYear}`);
  console.log(`  Pair filter:    ${pairFilter || "all"}`);
  console.log(`  Date filter:    ${dateFilter || "none"}`);
  console.log(`  FCR Window:     9:30-10:30 AM ET (${FCR_WINDOW_MINUTES} M1 candles)`);
  console.log(`  FCR Candle:     First ${FCR_CANDLE_MINUTES} M1 candles aggregated\n`);

  // Initialize ClickHouse
  clickhouse = initClickHouse();

  // Test connection
  try {
    await clickhouse.query({ query: "SELECT 1", format: "JSON" });
    console.log("[DB] ClickHouse connection OK\n");
  } catch (error) {
    console.error("[DB] ClickHouse connection failed:", error);
    process.exit(1);
  }

  // Load progress
  const progress = loadProgress();
  console.log(`[Progress] Resuming from: ${progress.lastDate || "beginning"}`);
  console.log(`[Progress] Already processed: ${progress.totalDaysProcessed} days, ${progress.totalWindowsInserted} windows\n`);

  // Determine pairs to process
  const pairs = pairFilter ? [pairFilter] : [...FCR_PAIRS];

  // Get trading days
  let tradingDays: string[];
  if (dateFilter) {
    tradingDays = [dateFilter];
  } else {
    tradingDays = getTradingDays(fromYear, toYear, progress.lastDate);
  }

  console.log(`Found ${tradingDays.length} trading days to process\n`);

  if (tradingDays.length === 0) {
    console.log("All trading days already processed. Done!");
    await clickhouse.close();
    return;
  }

  // Process each pair
  console.log("━━━ Fetching FCR windows from OANDA ━━━\n");

  const startTime = Date.now();
  let processedInSession = 0;
  let windowsInSession = 0;
  let errorsInSession = 0;
  const windowBatch: FCRWindowRecord[] = [];

  for (const pair of pairs) {
    console.log(`\n─── Processing ${pair} ───\n`);

    // Get existing dates for this pair
    const existingDates = await getExistingDatesForPair(pair, fromYear, toYear);
    const daysToFetch = tradingDays.filter((d) => !existingDates.has(d));

    console.log(`  ${daysToFetch.length} days to fetch (${existingDates.size} already exist)\n`);

    for (const dateStr of daysToFetch) {
      process.stdout.write(`  [${dateStr}] `);

      const result = await fetchOandaWindow(pair, dateStr);

      if (!result.success || !result.candles) {
        console.log(`✗ ${result.error || "No candles"}`);
        errorsInSession++;
        progress.totalErrors++;
        continue;
      }

      // Aggregate FCR from first 5 candles
      const fcrData = aggregateFCR(result.candles);
      if (!fcrData) {
        console.log(`✗ Not enough candles (${result.candles.length})`);
        errorsInSession++;
        progress.totalErrors++;
        continue;
      }

      // Build window record
      const windowRecord: FCRWindowRecord = {
        date: dateStr,
        pair,
        fcr_open: fcrData.fcrOpen,
        fcr_high: fcrData.fcrHigh,
        fcr_low: fcrData.fcrLow,
        fcr_close: fcrData.fcrClose,
        fcr_time: new Date(fcrData.fcrTime).toISOString().replace("T", " ").replace("Z", ""),
        candle_times: fcrData.remainingCandles.map((c) =>
          new Date(c.time).toISOString().replace("T", " ").replace("Z", "")
        ),
        candle_opens: fcrData.remainingCandles.map((c) => c.open),
        candle_highs: fcrData.remainingCandles.map((c) => c.high),
        candle_lows: fcrData.remainingCandles.map((c) => c.low),
        candle_closes: fcrData.remainingCandles.map((c) => c.close),
        candle_volumes: fcrData.remainingCandles.map((c) => c.volume),
        candle_count: fcrData.remainingCandles.length,
      };

      windowBatch.push(windowRecord);
      windowsInSession++;
      progress.totalWindowsInserted++;

      const fcrRange = (fcrData.fcrHigh - fcrData.fcrLow).toFixed(2);
      console.log(`✓ FCR: ${fcrData.fcrLow.toFixed(2)}-${fcrData.fcrHigh.toFixed(2)} (${fcrRange}), ${fcrData.remainingCandles.length} M1 candles`);

      // Batch insert
      if (windowBatch.length >= BATCH_SIZE) {
        await insertWindowBatch(windowBatch);
        windowBatch.length = 0;
        saveProgress(progress);
      }

      // Rate limiting
      await new Promise((r) => setTimeout(r, OANDA_DELAY_MS));

      processedInSession++;
      progress.totalDaysProcessed++;
      progress.lastDate = dateStr;

      // Progress update every 25 days
      if (processedInSession % 25 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = processedInSession / elapsed;
        console.log(
          `\n  ⏱ Session: ${processedInSession} days | ${windowsInSession} windows | ${errorsInSession} errors | ${rate.toFixed(1)}/s\n`
        );
      }
    }
  }

  // Flush remaining batch
  if (windowBatch.length > 0) {
    await insertWindowBatch(windowBatch);
  }
  saveProgress(progress);

  // Final summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log("\n" + "═".repeat(70));
  console.log("                        FINAL SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Days processed (session):   ${processedInSession.toLocaleString()}`);
  console.log(`  Windows inserted (session): ${windowsInSession.toLocaleString()}`);
  console.log(`  Errors (session):           ${errorsInSession.toLocaleString()}`);
  console.log(`  Time:                       ${(totalTime / 60).toFixed(1)} minutes`);
  console.log(`  Rate:                       ${(processedInSession / totalTime).toFixed(2)} days/sec`);
  console.log("─".repeat(70));
  console.log(`  Total days (all time):      ${progress.totalDaysProcessed.toLocaleString()}`);
  console.log(`  Total windows (all time):   ${progress.totalWindowsInserted.toLocaleString()}`);
  console.log(`  Total errors (all time):    ${progress.totalErrors.toLocaleString()}`);
  console.log("═".repeat(70));
  console.log("\nDone!");

  await clickhouse.close();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
