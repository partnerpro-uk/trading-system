/**
 * Gap Caretaker Agent
 *
 * Automatically detects and fills gaps in candle data across all pairs and timeframes.
 * - Scans ClickHouse for historical gaps
 * - Checks TimescaleDB for recent data continuity
 * - Auto-pulls from OANDA to fill detected gaps
 *
 * Usage: npx ts-node src/gap-caretaker.ts
 * Or run on a schedule (e.g., every hour via cron)
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { createClient } from "@clickhouse/client";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";
const TIMESCALE_URL = process.env.TIMESCALE_URL!;
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST!;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER!;
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD!;
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE!;

// All pairs and timeframes to monitor
const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD", "SPX500_USD"
];

const TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D", "W", "M"];

// Expected candle intervals in minutes
const TIMEFRAME_MINUTES: Record<string, number> = {
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D: 1440,
  W: 10080,
  M: 43200, // ~30 days
};

// Gap thresholds - gaps larger than 2x the interval are considered significant
const GAP_THRESHOLD_MULTIPLIER = 2;

// Skip weekend gaps (Friday 21:00 UTC to Sunday 22:00 UTC) and major holidays
function isWeekendOrHolidayGap(fromTime: Date, toTime: Date): boolean {
  const fromDay = fromTime.getUTCDay();
  const fromHour = fromTime.getUTCHours();
  const toDay = toTime.getUTCDay();

  // Friday after 21:00 to Sunday/Monday morning
  if (fromDay === 5 && fromHour >= 20) {
    if (toDay === 0 || toDay === 1) {
      return true;
    }
  }

  // Any gap starting Saturday
  if (fromDay === 6) {
    return true;
  }

  // Any gap starting Sunday before market open
  if (fromDay === 0 && toDay <= 1) {
    return true;
  }

  // Check for major holidays (Christmas, New Year's)
  const fromMonth = fromTime.getUTCMonth();
  const fromDate = fromTime.getUTCDate();

  // Christmas Eve/Day (Dec 24-25)
  if (fromMonth === 11 && (fromDate === 24 || fromDate === 25)) {
    return true;
  }

  // New Year's Eve/Day (Dec 31, Jan 1)
  if ((fromMonth === 11 && fromDate === 31) || (fromMonth === 0 && fromDate === 1)) {
    return true;
  }

  return false;
}

interface Gap {
  pair: string;
  timeframe: string;
  from: Date;
  to: Date;
  missingMinutes: number;
  expectedCandles: number;
}

interface OandaCandle {
  complete: boolean;
  volume: number;
  time: string;
  mid: { o: string; h: string; l: string; c: string };
}

// ClickHouse client
let clickhouse: ReturnType<typeof createClient>;
let timescale: Pool;

async function initConnections(): Promise<void> {
  // ClickHouse
  clickhouse = createClient({
    url: CLICKHOUSE_HOST,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
    database: CLICKHOUSE_DATABASE,
  });

  // TimescaleDB
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  timescale = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

  // Test connections
  await clickhouse.query({ query: "SELECT 1", format: "JSON" });
  console.log("✓ Connected to ClickHouse");

  await timescale.query("SELECT NOW()");
  console.log("✓ Connected to TimescaleDB");
}

/**
 * Find gaps in ClickHouse data for a pair/timeframe
 */
async function findGapsInClickHouse(pair: string, timeframe: string): Promise<Gap[]> {
  const intervalMinutes = TIMEFRAME_MINUTES[timeframe];
  const thresholdMinutes = intervalMinutes * GAP_THRESHOLD_MULTIPLIER;

  // Query consecutive candles and find gaps
  const query = `
    WITH ordered AS (
      SELECT time,
             lagInFrame(time) OVER (ORDER BY time) as prev_time
      FROM candles
      WHERE pair = {pair:String} AND timeframe = {timeframe:String}
      ORDER BY time
    )
    SELECT
      prev_time as gap_start,
      time as gap_end,
      dateDiff('minute', prev_time, time) as gap_minutes
    FROM ordered
    WHERE prev_time IS NOT NULL
      AND dateDiff('minute', prev_time, time) > {threshold:UInt32}
    ORDER BY gap_start DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({
    query,
    query_params: { pair, timeframe, threshold: thresholdMinutes },
    format: "JSONEachRow",
  });

  const rows = await result.json() as Array<{
    gap_start: string;
    gap_end: string;
    gap_minutes: number;
  }>;

  const gaps: Gap[] = [];

  for (const row of rows) {
    const from = new Date(row.gap_start + "Z");
    const to = new Date(row.gap_end + "Z");

    // Skip weekend gaps
    if (isWeekendOrHolidayGap(from, to)) {
      continue;
    }

    gaps.push({
      pair,
      timeframe,
      from,
      to,
      missingMinutes: row.gap_minutes,
      expectedCandles: Math.floor(row.gap_minutes / intervalMinutes),
    });
  }

  return gaps;
}

/**
 * Check TimescaleDB for recent gaps (last 24 hours)
 */
async function findRecentGaps(pair: string, timeframe: string): Promise<Gap[]> {
  const intervalMinutes = TIMEFRAME_MINUTES[timeframe];
  const thresholdMinutes = intervalMinutes * GAP_THRESHOLD_MULTIPLIER;

  const query = `
    WITH ordered AS (
      SELECT time,
             LAG(time) OVER (ORDER BY time) as prev_time
      FROM candles
      WHERE pair = $1 AND timeframe = $2
        AND time > NOW() - INTERVAL '24 hours'
      ORDER BY time
    )
    SELECT
      prev_time as gap_start,
      time as gap_end,
      EXTRACT(EPOCH FROM (time - prev_time)) / 60 as gap_minutes
    FROM ordered
    WHERE prev_time IS NOT NULL
      AND EXTRACT(EPOCH FROM (time - prev_time)) / 60 > $3
    ORDER BY gap_start DESC
  `;

  const result = await timescale.query(query, [pair, timeframe, thresholdMinutes]);

  const gaps: Gap[] = [];

  for (const row of result.rows) {
    const from = new Date(row.gap_start);
    const to = new Date(row.gap_end);

    // Skip weekend gaps
    if (isWeekendOrHolidayGap(from, to)) {
      continue;
    }

    gaps.push({
      pair,
      timeframe,
      from,
      to,
      missingMinutes: Math.round(row.gap_minutes),
      expectedCandles: Math.floor(row.gap_minutes / intervalMinutes),
    });
  }

  return gaps;
}

/**
 * Fetch candles from OANDA for a specific time range
 */
async function fetchFromOanda(
  pair: string,
  timeframe: string,
  from: Date,
  to: Date
): Promise<OandaCandle[]> {
  const url = `${OANDA_API_URL}/v3/instruments/${pair}/candles?granularity=${timeframe}&from=${from.toISOString()}&to=${to.toISOString()}&price=M`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.candles || [];
}

// 30-day threshold for routing to Timescale vs ClickHouse
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Insert candles into TimescaleDB (for recent data <30 days)
 */
async function insertToTimescale(
  candles: OandaCandle[],
  pair: string,
  timeframe: string
): Promise<number> {
  if (candles.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  candles.forEach((c, i) => {
    const offset = i * 9;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
    );
    values.push(
      new Date(c.time),
      pair,
      timeframe,
      parseFloat(c.mid.o),
      parseFloat(c.mid.h),
      parseFloat(c.mid.l),
      parseFloat(c.mid.c),
      c.volume,
      c.complete
    );
  });

  await timescale.query(
    `INSERT INTO candles (time, pair, timeframe, open, high, low, close, volume, complete)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (time, pair, timeframe)
     DO UPDATE SET
       open = EXCLUDED.open,
       high = EXCLUDED.high,
       low = EXCLUDED.low,
       close = EXCLUDED.close,
       volume = EXCLUDED.volume,
       complete = EXCLUDED.complete`,
    values
  );

  return candles.length;
}

/**
 * Insert candles directly into ClickHouse (for historical data >30 days)
 */
async function insertToClickHouse(
  candles: OandaCandle[],
  pair: string,
  timeframe: string
): Promise<number> {
  if (candles.length === 0) return 0;

  const rows = candles.map(c => ({
    time: c.time.replace("T", " ").replace("Z", "").slice(0, 19),
    pair,
    timeframe,
    open: parseFloat(c.mid.o),
    high: parseFloat(c.mid.h),
    low: parseFloat(c.mid.l),
    close: parseFloat(c.mid.c),
    volume: c.volume,
  }));

  await clickhouse.insert({
    table: "candles",
    values: rows,
    format: "JSONEachRow",
  });

  return candles.length;
}

/**
 * Route candles to the appropriate database based on age
 */
async function insertCandles(
  candles: OandaCandle[],
  pair: string,
  timeframe: string,
  gapTime: Date
): Promise<{ timescale: number; clickhouse: number }> {
  if (candles.length === 0) return { timescale: 0, clickhouse: 0 };

  const now = Date.now();
  const gapAge = now - gapTime.getTime();

  // Route based on gap age
  if (gapAge < THIRTY_DAYS_MS) {
    // Recent gap: insert to TimescaleDB (will sync to ClickHouse via nightly cron)
    const count = await insertToTimescale(candles, pair, timeframe);
    return { timescale: count, clickhouse: 0 };
  } else {
    // Historical gap: insert directly to ClickHouse
    const count = await insertToClickHouse(candles, pair, timeframe);
    return { timescale: 0, clickhouse: count };
  }
}

// Minimum candles to consider a gap worth filling (skip tiny market closure artifacts)
const MIN_CANDLES_TO_FILL = 5;

/**
 * Fill a single gap
 */
async function fillGap(gap: Gap): Promise<number> {
  const ageInDays = Math.round((Date.now() - gap.from.getTime()) / (24 * 60 * 60 * 1000));
  const target = ageInDays < 30 ? "TimescaleDB" : "ClickHouse";

  try {
    const candles = await fetchFromOanda(gap.pair, gap.timeframe, gap.from, gap.to);

    // Skip if OANDA returns too few candles (likely market closure, not real gap)
    if (candles.length < MIN_CANDLES_TO_FILL) {
      return 0;
    }

    console.log(`  Gap: ${gap.from.toISOString().slice(0,16)} → ${gap.to.toISOString().slice(0,16)}`);
    console.log(`    ${candles.length} candles, ${ageInDays}d old → ${target}`);

    const { timescale, clickhouse } = await insertCandles(candles, gap.pair, gap.timeframe, gap.from);
    const total = timescale + clickhouse;

    if (timescale > 0) {
      console.log(`    ✓ Inserted ${timescale} to TimescaleDB`);
    }
    if (clickhouse > 0) {
      console.log(`    ✓ Inserted ${clickhouse} to ClickHouse`);
    }

    return total;
  } catch (err) {
    console.error(`    ✗ Error filling gap: ${err}`);
    return 0;
  }
}

/**
 * Main caretaker routine
 */
async function runCaretaker(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  Gap Caretaker Agent - " + new Date().toISOString());
  console.log("=".repeat(60) + "\n");

  await initConnections();

  let totalGapsFound = 0;
  let totalCandlesFilled = 0;

  for (const pair of PAIRS) {
    console.log(`\n📊 Scanning ${pair}...`);

    for (const timeframe of TIMEFRAMES) {
      // Check ClickHouse for historical gaps
      const historicalGaps = await findGapsInClickHouse(pair, timeframe);

      // Check TimescaleDB for recent gaps
      const recentGaps = await findRecentGaps(pair, timeframe);

      // Combine and dedupe gaps
      const allGaps = [...historicalGaps, ...recentGaps];

      if (allGaps.length === 0) {
        process.stdout.write(`  ${timeframe}: ✓ `);
        continue;
      }

      console.log(`\n  ${timeframe}: Found ${allGaps.length} gap(s)`);
      totalGapsFound += allGaps.length;

      // Fill each gap
      for (const gap of allGaps) {
        // Rate limit OANDA requests
        await new Promise(r => setTimeout(r, 200));

        const filled = await fillGap(gap);
        totalCandlesFilled += filled;
      }
    }
    console.log(""); // newline after pair
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Summary: Found ${totalGapsFound} gaps, filled ${totalCandlesFilled} candles`);
  console.log("=".repeat(60) + "\n");

  await timescale.end();
}

// Export for use in main worker
export { runCaretaker, initConnections };

// Run standalone if executed directly (ESM compatible)
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCaretaker().catch(console.error);
}
