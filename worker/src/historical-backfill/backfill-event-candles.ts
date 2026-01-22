#!/usr/bin/env npx tsx
/**
 * Backfill Event Candle Windows to ClickHouse
 *
 * Reads events from ClickHouse news_events table,
 * fetches 1-minute candles from OANDA,
 * stores to ClickHouse event_candle_windows table.
 *
 * Time windows by impact:
 *   - FOMC/ECB Press Conferences: T-15 to T+90 (105 candles)
 *   - High impact: T-15 to T+60 (75 candles)
 *   - Medium/Low: T-15 to T+15 (30 candles)
 *   - Non-economic: Skip
 *
 * Usage:
 *   npx tsx src/historical-backfill/backfill-event-candles.ts
 *   npx tsx src/historical-backfill/backfill-event-candles.ts --impact high
 *   npx tsx src/historical-backfill/backfill-event-candles.ts --from 2020 --to 2025
 *   npx tsx src/historical-backfill/backfill-event-candles.ts --limit 1000
 *   npx tsx src/historical-backfill/backfill-event-candles.ts --parallel 10
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

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "XAU_USD",
  "SPX500_USD",
] as const;

const EXTENDED_WINDOW_EVENTS = ["FOMC_PRESSER", "ECB_PRESSER", "FOMC_PRESS_CONFERENCE", "ECB_PRESS_CONFERENCE"];

function getWindowMinutes(eventType: string, impact: string): number {
  // Check if this is a press conference event
  const upperEventType = eventType.toUpperCase();
  for (const ext of EXTENDED_WINDOW_EVENTS) {
    if (upperEventType.includes(ext) || upperEventType.includes(ext.replace("_", " "))) {
      return 90;
    }
  }
  if (impact === "high") return 60;
  return 15;
}

const OANDA_DELAY_MS = 50; // 20 requests/sec max
const BATCH_SIZE = 100; // Events per batch insert

// Progress file will be set based on year range
let PROGRESS_FILE = join(__dirname, "event-candles-progress.json");
let rangeId = "default";

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
  lastEventId: string | null;
  totalEventsProcessed: number;
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
    lastEventId: null,
    totalEventsProcessed: 0,
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
  eventTimestamp: number,
  windowMinutes: number,
  retries = 3
): Promise<{ success: boolean; candles?: Candle[]; error?: string }> {
  if (!OANDA_API_KEY) {
    return { success: false, error: "OANDA_API_KEY not set" };
  }

  const windowStart = eventTimestamp - 15 * 60 * 1000; // T-15
  const windowEnd = eventTimestamp + windowMinutes * 60 * 1000;

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
        return fetchOandaWindow(pair, eventTimestamp, windowMinutes, retries - 1);
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
      return fetchOandaWindow(pair, eventTimestamp, windowMinutes, retries - 1);
    }
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLICKHOUSE QUERIES
// ═══════════════════════════════════════════════════════════════════════════

interface NewsEvent {
  event_id: string;
  event_type: string;
  name: string;
  timestamp: number;
  impact: string;
}

async function getEventsNeedingWindows(options: {
  impact?: string;
  fromYear?: number;
  toYear?: number;
  limit?: number;
  afterEventId?: string | null;
}): Promise<NewsEvent[]> {
  const conditions: string[] = ["n.impact != 'non_economic'"];

  if (options.impact) {
    conditions.push(`n.impact = '${options.impact}'`);
  }
  if (options.fromYear) {
    conditions.push(`n.timestamp >= toDateTime('${options.fromYear}-01-01 00:00:00')`);
  }
  if (options.toYear) {
    conditions.push(`n.timestamp < toDateTime('${options.toYear + 1}-01-01 00:00:00')`);
  }
  if (options.afterEventId) {
    conditions.push(`n.event_id > '${options.afterEventId}'`);
  }

  // Find events that don't have all 9 pairs in event_candle_windows
  // Note: ClickHouse LEFT JOIN returns 0 (not NULL) for non-matching aggregates
  const query = `
    SELECT
      n.event_id,
      n.event_type,
      n.name,
      toUnixTimestamp64Milli(n.timestamp) as timestamp,
      n.impact
    FROM news_events n
    LEFT JOIN (
      SELECT event_id, count() as window_count
      FROM event_candle_windows
      GROUP BY event_id
    ) w ON n.event_id = w.event_id
    WHERE ${conditions.join(" AND ")}
      AND w.window_count < 9
    ORDER BY n.event_id
    ${options.limit ? `LIMIT ${options.limit}` : ""}
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
  });

  const rows = await result.json<NewsEvent>();
  return rows;
}

interface WindowRecord {
  event_id: string;
  pair: string;
  window_start: string;
  window_end: string;
  candle_times: number[];
  candle_opens: number[];
  candle_highs: number[];
  candle_lows: number[];
  candle_closes: number[];
  candle_volumes: number[];
  candle_count: number;
}

async function insertWindowBatch(windows: WindowRecord[]): Promise<number> {
  if (windows.length === 0) return 0;

  const rows = windows.map((w) => ({
    event_id: w.event_id,
    pair: w.pair,
    window_start: w.window_start,
    window_end: w.window_end,
    candle_times: w.candle_times.map((t) => new Date(t).toISOString().replace("T", " ").replace("Z", "")),
    candle_opens: w.candle_opens,
    candle_highs: w.candle_highs,
    candle_lows: w.candle_lows,
    candle_closes: w.candle_closes,
    candle_volumes: w.candle_volumes,
    candle_count: w.candle_count,
  }));

  await clickhouse.insert({
    table: "event_candle_windows",
    values: rows,
    format: "JSONEachRow",
  });

  return windows.length;
}

async function getExistingWindowsForEvent(eventId: string): Promise<Set<string>> {
  const result = await clickhouse.query({
    query: `SELECT pair FROM event_candle_windows WHERE event_id = '${eventId}'`,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ pair: string }>();
  return new Set(rows.map((r) => r.pair));
}

// ═══════════════════════════════════════════════════════════════════════════
// PARALLEL FETCH
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  delayMs = OANDA_DELAY_MS
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let impactFilter: string | undefined;
  let fromYear: number | undefined;
  let toYear: number | undefined;
  let limit: number | undefined;
  let parallel = 15;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--impact" && args[i + 1]) impactFilter = args[++i];
    else if (args[i] === "--from" && args[i + 1]) fromYear = parseInt(args[++i], 10);
    else if (args[i] === "--to" && args[i + 1]) toYear = parseInt(args[++i], 10);
    else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    else if (args[i] === "--parallel" && args[i + 1]) parallel = parseInt(args[++i], 10);
  }

  // Set range-specific progress file to avoid conflicts between parallel instances
  rangeId = `${fromYear || 2007}-${toYear || 2026}`;
  PROGRESS_FILE = join(__dirname, `event-candles-progress-${rangeId}.json`);

  // Handle reset after setting progress file
  if (args.includes("--reset")) {
    if (existsSync(PROGRESS_FILE)) {
      const fs = await import("fs");
      fs.unlinkSync(PROGRESS_FILE);
      console.log(`[${rangeId}] Progress file reset`);
    }
    return;
  }

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log(`║     EVENT CANDLE BACKFILL [${rangeId}]`.padEnd(68) + "║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  console.log("Configuration:");
  console.log(`  Range ID:       ${rangeId}`);
  console.log(`  Impact filter:  ${impactFilter || "all (high, medium, low)"}`);
  console.log(`  Year range:     ${fromYear || 2007}-${toYear || 2026}`);
  console.log(`  Limit:          ${limit || "none"}`);
  console.log(`  Parallelism:    ${parallel}`);
  console.log(`  Pairs:          ${PAIRS.length} (${PAIRS.join(", ")})`);
  console.log(`  Progress file:  ${PROGRESS_FILE}\n`);

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
  console.log(`[Progress] Resuming from: ${progress.lastEventId || "beginning"}`);
  console.log(`[Progress] Already processed: ${progress.totalEventsProcessed} events, ${progress.totalWindowsInserted} windows\n`);

  // Get events needing windows
  console.log("━━━ Fetching events from ClickHouse ━━━\n");

  const events = await getEventsNeedingWindows({
    impact: impactFilter,
    fromYear,
    toYear,
    limit,
    afterEventId: progress.lastEventId,
  });

  console.log(`Found ${events.length} events needing candle windows\n`);

  if (events.length === 0) {
    console.log("All events have complete candle windows. Done!");
    await clickhouse.close();
    return;
  }

  // Process events
  console.log("━━━ Fetching candle windows from OANDA ━━━\n");

  const startTime = Date.now();
  let processedInSession = 0;
  let windowsInSession = 0;
  let errorsInSession = 0;
  const windowBatch: WindowRecord[] = [];

  for (const event of events) {
    const windowMinutes = getWindowMinutes(event.event_type, event.impact);
    const windowType = windowMinutes === 90 ? "T+90" : windowMinutes === 60 ? "T+60" : "T+15";
    const eventDate = new Date(event.timestamp).toISOString().slice(0, 16);

    // Check which pairs already exist for this event
    const existingPairs = await getExistingWindowsForEvent(event.event_id);
    const pairsToFetch = PAIRS.filter((p) => !existingPairs.has(p));

    if (pairsToFetch.length === 0) {
      // All pairs already fetched, skip
      progress.lastEventId = event.event_id;
      progress.totalEventsProcessed++;
      processedInSession++;
      continue;
    }

    process.stdout.write(
      `[${progress.totalEventsProcessed + 1}] ${eventDate} | ${event.event_type.slice(0, 25).padEnd(25)} | ${windowType} | `
    );

    // Fetch candles for all pairs in parallel
    const results = await fetchWithConcurrency(
      pairsToFetch,
      parallel,
      async (pair) => {
        const result = await fetchOandaWindow(pair, event.timestamp, windowMinutes);
        return { pair, result };
      }
    );

    let successes = 0;
    let errors = 0;

    for (const { pair, result } of results) {
      if (result.success && result.candles && result.candles.length > 0) {
        const windowStart = event.timestamp - 15 * 60 * 1000;
        const windowEnd = event.timestamp + windowMinutes * 60 * 1000;

        windowBatch.push({
          event_id: event.event_id,
          pair,
          window_start: new Date(windowStart).toISOString().replace("T", " ").replace("Z", ""),
          window_end: new Date(windowEnd).toISOString().replace("T", " ").replace("Z", ""),
          candle_times: result.candles.map((c) => c.time),
          candle_opens: result.candles.map((c) => c.open),
          candle_highs: result.candles.map((c) => c.high),
          candle_lows: result.candles.map((c) => c.low),
          candle_closes: result.candles.map((c) => c.close),
          candle_volumes: result.candles.map((c) => c.volume),
          candle_count: result.candles.length,
        });
        successes++;
      } else {
        errors++;
        errorsInSession++;
      }
    }

    console.log(`${successes}/${pairsToFetch.length} pairs ✓`);

    windowsInSession += successes;
    progress.totalWindowsInserted += successes;
    progress.totalErrors += errors;
    progress.lastEventId = event.event_id;
    progress.totalEventsProcessed++;
    processedInSession++;

    // Batch insert every BATCH_SIZE events
    if (windowBatch.length >= BATCH_SIZE * PAIRS.length) {
      await insertWindowBatch(windowBatch);
      windowBatch.length = 0;
      saveProgress(progress);
    }

    // Progress update every 25 events
    if (processedInSession % 25 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedInSession / elapsed;
      const remaining = events.length - processedInSession;
      const eta = remaining / rate / 60;
      console.log(
        `\n  ⏱ Session: ${processedInSession} events | ${windowsInSession} windows | ${errorsInSession} errors | ${rate.toFixed(1)}/s | ETA: ${eta.toFixed(1)}m\n`
      );
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
  console.log(`  Events processed (session): ${processedInSession.toLocaleString()}`);
  console.log(`  Windows inserted (session): ${windowsInSession.toLocaleString()}`);
  console.log(`  Errors (session):           ${errorsInSession.toLocaleString()}`);
  console.log(`  Time:                       ${(totalTime / 60).toFixed(1)} minutes`);
  console.log(`  Rate:                       ${(processedInSession / totalTime).toFixed(2)} events/sec`);
  console.log("─".repeat(70));
  console.log(`  Total events (all time):    ${progress.totalEventsProcessed.toLocaleString()}`);
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
