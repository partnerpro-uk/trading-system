/**
 * Nightly Sync: Timescale -> ClickHouse
 *
 * Runs daily at 00:30 UTC
 * - Moves candles older than 30 days from Timescale to ClickHouse
 * - Aggregates M1 to M5 before moving
 * - Deletes old M1 data from Timescale
 */

import { NextResponse } from "next/server";
import { Pool } from "pg";
import { createClient } from "@clickhouse/client";

const TIMESCALE_URL = process.env.TIMESCALE_URL!;
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST!;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER!;
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD!;

const CUTOFF_DAYS = 30;
const BATCH_SIZE = 10000;

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
  // Note: DXY and BTC_USD don't use OANDA streaming
];

// Timeframes to move (M5 and above)
const TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D", "W", "M"];

export async function GET(request: Request) {
  // Verify cron secret (if deployed to Vercel)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const logs: string[] = [];

  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  log("===== Nightly Sync Started =====");
  log(`Cutoff: ${CUTOFF_DAYS} days ago`);

  // Connect to databases
  // Remove sslmode from URL to use our own ssl config
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, '');
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  const clickhouse = createClient({
    url: CLICKHOUSE_HOST,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
  });

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CUTOFF_DAYS);
    cutoffDate.setUTCHours(0, 0, 0, 0);

    log(`Cutoff date: ${cutoffDate.toISOString()}`);

    let totalMoved = 0;
    let totalDeleted = 0;

    // Step 1: Aggregate M1 to M5 for old data
    log("\n--- Step 1: Aggregate M1 to M5 ---");
    for (const pair of PAIRS) {
      const aggregated = await aggregateM1toM5(pool, pair, cutoffDate);
      if (aggregated > 0) {
        log(`  ${pair}: Aggregated ${aggregated} M5 candles from M1`);
      }
    }

    // Step 2: Move M5+ candles to ClickHouse
    log("\n--- Step 2: Move candles to ClickHouse ---");
    for (const pair of PAIRS) {
      for (const timeframe of TIMEFRAMES) {
        const moved = await moveCandlesToClickHouse(
          pool,
          clickhouse,
          pair,
          timeframe,
          cutoffDate
        );
        if (moved > 0) {
          log(`  ${pair} ${timeframe}: Moved ${moved} candles`);
          totalMoved += moved;
        }
      }
    }

    // Step 3: Delete old M1 candles from Timescale
    log("\n--- Step 3: Delete old M1 from Timescale ---");
    for (const pair of PAIRS) {
      const deleted = await deleteOldM1(pool, pair, cutoffDate);
      if (deleted > 0) {
        log(`  ${pair}: Deleted ${deleted} old M1 candles`);
        totalDeleted += deleted;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n===== Sync Complete =====`);
    log(`Moved: ${totalMoved} candles`);
    log(`Deleted: ${totalDeleted} M1 candles`);
    log(`Duration: ${duration}s`);

    return NextResponse.json({
      success: true,
      moved: totalMoved,
      deleted: totalDeleted,
      duration: `${duration}s`,
      logs,
    });
  } catch (error: any) {
    log(`ERROR: ${error.message}`);
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        logs,
      },
      { status: 500 }
    );
  } finally {
    await pool.end();
    await clickhouse.close();
  }
}

async function aggregateM1toM5(
  pool: Pool,
  pair: string,
  cutoffDate: Date
): Promise<number> {
  // Aggregate M1 candles into M5 buckets for data older than cutoff
  const result = await pool.query(
    `
    INSERT INTO candles (time, pair, timeframe, open, high, low, close, volume, complete)
    SELECT
      date_trunc('hour', time) + INTERVAL '5 minute' * (EXTRACT(MINUTE FROM time)::int / 5) as bucket,
      pair,
      'M5' as timeframe,
      (array_agg(open ORDER BY time))[1] as open,
      max(high) as high,
      min(low) as low,
      (array_agg(close ORDER BY time DESC))[1] as close,
      sum(volume) as volume,
      true as complete
    FROM candles
    WHERE pair = $1
      AND timeframe = 'M1'
      AND time < $2
    GROUP BY date_trunc('hour', time) + INTERVAL '5 minute' * (EXTRACT(MINUTE FROM time)::int / 5), pair
    ON CONFLICT (time, pair, timeframe) DO NOTHING
    RETURNING 1
    `,
    [pair, cutoffDate]
  );

  return result.rowCount || 0;
}

async function moveCandlesToClickHouse(
  pool: Pool,
  clickhouse: ReturnType<typeof createClient>,
  pair: string,
  timeframe: string,
  cutoffDate: Date
): Promise<number> {
  // Get old candles from Timescale
  const result = await pool.query(
    `
    SELECT time, pair, timeframe, open, high, low, close, volume
    FROM candles
    WHERE pair = $1
      AND timeframe = $2
      AND time < $3
    ORDER BY time ASC
    LIMIT $4
    `,
    [pair, timeframe, cutoffDate, BATCH_SIZE]
  );

  if (result.rows.length === 0) {
    return 0;
  }

  // Group by month for ClickHouse partitions
  const byMonth: Record<string, typeof result.rows> = {};
  for (const row of result.rows) {
    const date = new Date(row.time);
    const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[yyyymm]) byMonth[yyyymm] = [];
    byMonth[yyyymm].push(row);
  }

  // Insert to ClickHouse by month
  let inserted = 0;
  for (const rows of Object.values(byMonth)) {
    const values = rows.map((row) => ({
      time: new Date(row.time).toISOString().replace("T", " ").replace("Z", ""),
      pair: row.pair,
      timeframe: row.timeframe,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: parseInt(row.volume) || 0,
    }));

    await clickhouse.insert({
      table: "candles",
      values,
      format: "JSONEachRow",
    });

    inserted += rows.length;
  }

  // Delete from Timescale (only after successful insert)
  const times = result.rows.map((r) => r.time);
  if (times.length > 0) {
    await pool.query(
      `DELETE FROM candles WHERE pair = $1 AND timeframe = $2 AND time = ANY($3::timestamptz[])`,
      [pair, timeframe, times]
    );
  }

  return inserted;
}

async function deleteOldM1(
  pool: Pool,
  pair: string,
  cutoffDate: Date
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM candles WHERE pair = $1 AND timeframe = 'M1' AND time < $2`,
    [pair, cutoffDate]
  );

  return result.rowCount || 0;
}

// Enable Vercel cron
export const config = {
  runtime: "nodejs",
};
