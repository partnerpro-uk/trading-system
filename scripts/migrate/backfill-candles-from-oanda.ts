#!/usr/bin/env npx tsx
/**
 * Backfill historical candles from OANDA directly to ClickHouse
 * Bypasses Convex 32K limit by going direct to source
 *
 * Features:
 * - Fetches all pairs and timeframes
 * - Progress tracking with resume capability
 * - Parallel fetching with rate limiting
 * - Direct insert to ClickHouse
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD",
  "XAU_USD", "XAG_USD", "SPX500_USD", // Commodities & indices
] as const;
const TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D", "W", "M"] as const;

// OANDA settings - granularity mapping
const OANDA_GRANULARITY: Record<string, string> = {
  M5: "M5",
  M15: "M15",
  M30: "M30",
  H1: "H1",
  H4: "H4",
  D: "D",
  W: "W",
  M: "M",  // Monthly
};
const MAX_CANDLES_PER_REQUEST = 5000;
const DELAY_BETWEEN_REQUESTS_MS = 100; // 10 requests/sec is safe

// How far back to fetch (OANDA has data from ~2005)
const START_YEAR = 2007;
const END_DATE = new Date(); // Now

const PROGRESS_FILE = join(__dirname, "../../data/oanda-backfill-progress.json");

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════════════════════════════

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS TRACKING
// ═══════════════════════════════════════════════════════════════════════════

interface Progress {
  started: string;
  completed: Record<string, Record<string, string | null>>; // pair -> timeframe -> lastTimestamp (ISO) or null if complete
  totalInserted: number;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return {
    started: new Date().toISOString(),
    completed: {},
    totalInserted: 0,
  };
}

function saveProgress(progress: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════
// OANDA FETCH
// ═══════════════════════════════════════════════════════════════════════════

interface OandaCandle {
  time: string;
  mid: { o: string; h: string; l: string; c: string };
  volume: number;
  complete: boolean;
}

async function fetchOandaCandles(
  pair: string,
  granularity: string,
  from: Date,
  to: Date,
  retries = 3
): Promise<{ success: boolean; candles?: OandaCandle[]; error?: string }> {
  // OANDA doesn't allow count with from/to, so we just use from/to
  const params = new URLSearchParams({
    granularity,
    from: from.toISOString(),
    to: to.toISOString(),
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
      // Retry on rate limit or server errors
      if ((response.status === 429 || response.status >= 500) && retries > 0) {
        await new Promise((r) => setTimeout(r, 2000 * (4 - retries)));
        return fetchOandaCandles(pair, granularity, from, to, retries - 1);
      }
      return { success: false, error: `${response.status}: ${text.slice(0, 200)}` };
    }

    const data = await response.json();
    return { success: true, candles: data.candles || [] };
  } catch (error) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1000));
      return fetchOandaCandles(pair, granularity, from, to, retries - 1);
    }
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLICKHOUSE INSERT
// ═══════════════════════════════════════════════════════════════════════════

async function insertToClickHouse(
  candles: Array<{
    time: string;
    pair: string;
    timeframe: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>
): Promise<void> {
  if (candles.length === 0) return;

  // Group candles by YYYYMM to respect partition limit (max 100 partitions per insert)
  const byMonth: Record<string, typeof candles> = {};
  for (const c of candles) {
    const yyyymm = c.time.slice(0, 7).replace("-", ""); // "2024-01-15" -> "202401"
    if (!byMonth[yyyymm]) byMonth[yyyymm] = [];
    byMonth[yyyymm].push(c);
  }

  // Insert each month's data separately to avoid partition limit
  for (const monthCandles of Object.values(byMonth)) {
    const rows = monthCandles.map((c) => ({
      time: c.time.replace("T", " ").replace("Z", "").split(".")[0], // ClickHouse datetime format
      pair: c.pair,
      timeframe: c.timeframe,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      // Velocity data defaults
      time_to_high_ms: 0,
      time_to_low_ms: 0,
      high_formed_first: 0,
      body_percent: 0,
      range_pips: 0,
      is_displacement: 0,
      displacement_score: 0,
    }));

    await clickhouse.insert({
      table: "candles",
      values: rows,
      format: "JSONEachRow",
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN BACKFILL LOGIC
// ═══════════════════════════════════════════════════════════════════════════

async function backfillPairTimeframe(
  pair: string,
  timeframe: string,
  progress: Progress
): Promise<number> {
  const granularity = OANDA_GRANULARITY[timeframe];

  // Determine start point
  let fromDate = new Date(`${START_YEAR}-01-01T00:00:00Z`);

  // Check if we have progress for this pair/timeframe
  if (progress.completed[pair]?.[timeframe]) {
    const lastTs = progress.completed[pair][timeframe];
    if (lastTs === null) {
      // Already complete
      return 0;
    }
    fromDate = new Date(lastTs);
  }

  let totalInserted = 0;
  let currentFrom = fromDate;

  while (currentFrom < END_DATE) {
    // Calculate "to" date based on timeframe
    // We want to fetch MAX_CANDLES_PER_REQUEST candles at a time
    const candleDurationMs = getTimeframeDurationMs(timeframe);
    const windowMs = MAX_CANDLES_PER_REQUEST * candleDurationMs;
    let currentTo = new Date(currentFrom.getTime() + windowMs);

    if (currentTo > END_DATE) {
      currentTo = END_DATE;
    }

    // Fetch from OANDA
    const result = await fetchOandaCandles(pair, granularity, currentFrom, currentTo);

    if (!result.success) {
      console.log(`\n    Error fetching ${pair} ${timeframe}: ${result.error}`);
      // Save progress and continue
      break;
    }

    if (result.candles && result.candles.length > 0) {
      // Transform and insert
      const candles = result.candles.map((c) => ({
        time: c.time,
        pair,
        timeframe,
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
        volume: c.volume,
      }));

      await insertToClickHouse(candles);
      totalInserted += candles.length;
      progress.totalInserted += candles.length;

      // Update progress with newest candle timestamp
      const newestTs = candles[candles.length - 1].time;
      if (!progress.completed[pair]) progress.completed[pair] = {};
      progress.completed[pair][timeframe] = newestTs;
      saveProgress(progress);

      // Move forward
      currentFrom = new Date(new Date(newestTs).getTime() + candleDurationMs);
    } else {
      // No candles returned, move forward
      currentFrom = currentTo;
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS));

    // Progress indicator
    process.stdout.write(
      `\r    ${pair} ${timeframe}: ${totalInserted} candles (${currentFrom.toISOString().split("T")[0]})    `
    );

    // If we got less than expected, we might be at the end
    if (result.candles && result.candles.length < MAX_CANDLES_PER_REQUEST) {
      // Check if we've reached the end
      if (currentTo >= END_DATE) {
        break;
      }
    }
  }

  // Mark as complete if we reached the end
  if (currentFrom >= END_DATE) {
    if (!progress.completed[pair]) progress.completed[pair] = {};
    progress.completed[pair][timeframe] = null; // null means complete
    saveProgress(progress);
  }

  console.log(); // New line after progress indicator
  return totalInserted;
}

function getTimeframeDurationMs(tf: string): number {
  switch (tf) {
    case "M5":
      return 5 * 60 * 1000;
    case "M15":
      return 15 * 60 * 1000;
    case "M30":
      return 30 * 60 * 1000;
    case "H1":
      return 60 * 60 * 1000;
    case "H4":
      return 4 * 60 * 60 * 1000;
    case "D":
      return 24 * 60 * 60 * 1000;
    case "W":
      return 7 * 24 * 60 * 60 * 1000;
    case "M":
      return 30 * 24 * 60 * 60 * 1000; // Approximate month
    default:
      return 5 * 60 * 1000;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═".repeat(70));
  console.log("  OANDA → CLICKHOUSE CANDLE BACKFILL");
  console.log("═".repeat(70));
  console.log();

  // Verify credentials
  if (!OANDA_API_KEY) {
    console.error("❌ OANDA_API_KEY not set in .env.local");
    process.exit(1);
  }

  // Test ClickHouse connection
  try {
    const version = await clickhouse.query({ query: "SELECT version()", format: "JSONEachRow" });
    const data = (await version.json()) as any[];
    console.log(`✓ Connected to ClickHouse v${data[0]["version()"]}`);
  } catch (err) {
    console.error(`❌ ClickHouse connection failed: ${err}`);
    process.exit(1);
  }

  // Test OANDA connection
  try {
    const result = await fetchOandaCandles("EUR_USD", "M5", new Date(Date.now() - 3600000), new Date());
    if (!result.success) {
      console.error(`❌ OANDA connection failed: ${result.error}`);
      process.exit(1);
    }
    console.log(`✓ Connected to OANDA API`);
  } catch (err) {
    console.error(`❌ OANDA connection failed: ${err}`);
    process.exit(1);
  }

  console.log();

  // Load progress
  const progress = loadProgress();
  console.log(`📊 Progress: ${progress.totalInserted.toLocaleString()} candles already inserted`);
  console.log();

  // Backfill each pair and timeframe
  const startTime = Date.now();
  let grandTotal = 0;

  for (const pair of PAIRS) {
    console.log(`\n${pair}:`);

    for (const tf of TIMEFRAMES) {
      // Check if already complete
      if (progress.completed[pair]?.[tf] === null) {
        console.log(`  ${tf}: ✓ complete`);
        continue;
      }

      const count = await backfillPairTimeframe(pair, tf, progress);
      grandTotal += count;
    }
  }

  // Summary
  const elapsed = (Date.now() - startTime) / 1000 / 60;

  console.log();
  console.log("═".repeat(70));
  console.log(`  BACKFILL COMPLETE (${elapsed.toFixed(1)} minutes)`);
  console.log("═".repeat(70));
  console.log(`  New candles inserted: ${grandTotal.toLocaleString()}`);
  console.log(`  Total in ClickHouse:  ${progress.totalInserted.toLocaleString()}`);
  console.log();

  // Verify counts
  console.log("Verifying ClickHouse counts...\n");
  const countResult = await clickhouse.query({
    query: `
      SELECT pair, timeframe, count(*) as count,
             min(time) as oldest, max(time) as newest
      FROM candles
      GROUP BY pair, timeframe
      ORDER BY pair, timeframe
    `,
    format: "JSONEachRow",
  });
  const counts = (await countResult.json()) as any[];

  let totalCandles = 0;
  for (const row of counts) {
    console.log(`  ${row.pair} ${row.timeframe}: ${parseInt(row.count).toLocaleString()} (${row.oldest} → ${row.newest})`);
    totalCandles += parseInt(row.count);
  }
  console.log(`\n  TOTAL: ${totalCandles.toLocaleString()} candles`);

  await clickhouse.close();
  console.log("\nDone!");
}

main().catch(console.error);
