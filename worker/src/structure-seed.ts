#!/usr/bin/env npx tsx
/**
 * Structure Seed — One-Time 30-Day Backfill to TimescaleDB
 *
 * Populates TimescaleDB with pre-computed structure for the last 30 days
 * across all pairs and structure timeframes. Run this once to bootstrap
 * the pre-computed structure system before the incremental worker takes over.
 *
 * Usage:
 *   npx tsx worker/src/structure-seed.ts
 *   npx tsx worker/src/structure-seed.ts --days 60
 *   npx tsx worker/src/structure-seed.ts --pair EUR_USD
 */

import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });
dotenv.config({ path: resolve(process.cwd(), "../.env.local") });

import { Pool } from "pg";
import { computeStructure } from "../../lib/structure/index";
import {
  upsertSwingPoints,
  upsertBOSEvents,
  upsertSweepEvents,
  upsertFVGEvents,
  upsertKeyLevels,
  upsertHTFStructure,
} from "../../lib/db/structure";
import type { Candle } from "../../lib/structure/types";

// ─── Configuration ──────────────────────────────────────────────────────────

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD",
  "XAG_USD", "SPX500_USD",
];

const SEED_TIMEFRAMES = [
  { tf: "M15", candleCount: 2880 },  // 30d × 24h × 4 per hour
  { tf: "M30", candleCount: 1440 },  // 30d × 24h × 2 per hour
  { tf: "H1", candleCount: 720 },    // 30d × 24h
  { tf: "H4", candleCount: 180 },    // 30d × 6 per day
  { tf: "D", candleCount: 200 },     // ~200 days for context
  { tf: "W", candleCount: 104 },     // ~2 years for context
  { tf: "M", candleCount: 60 },      // ~5 years for context
];

// ─── Database ───────────────────────────────────────────────────────────────

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

// ─── Candle Fetching ────────────────────────────────────────────────────────

async function fetchCandles(
  pair: string,
  timeframe: string,
  limit: number
): Promise<Candle[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT time, open::float, high::float, low::float, close::float, volume::int
     FROM candles
     WHERE pair = $1 AND timeframe = $2
     ORDER BY time DESC
     LIMIT $3`,
    [pair, timeframe, limit]
  );

  return result.rows.reverse().map((row) => ({
    timestamp: new Date(row.time).getTime(),
    time: row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume || 0,
  }));
}

// ─── Seed Logic ─────────────────────────────────────────────────────────────

async function seedPairTimeframe(
  pair: string,
  timeframe: string,
  candleCount: number
): Promise<number> {
  const candles = await fetchCandles(pair, timeframe, candleCount);
  if (candles.length < 20) {
    console.log(`  [${pair}/${timeframe}] Skipped — only ${candles.length} candles`);
    return 0;
  }

  // Fetch D/W/M candles for key level computation (sequential to avoid DB OOM)
  const dailyCandles = await fetchCandles(pair, "D", 200);
  const weeklyCandles = await fetchCandles(pair, "W", 104);
  const monthlyCandles = await fetchCandles(pair, "M", 60);

  // Run full structure pipeline
  const result = computeStructure(
    pair,
    timeframe,
    candles,
    dailyCandles,
    weeklyCandles,
    monthlyCandles
  );

  // Upsert all entities to TimescaleDB (sequential to avoid DB OOM)
  await upsertSwingPoints(pair, timeframe, result.swings);
  await upsertBOSEvents(pair, timeframe, result.bosEvents);
  await upsertSweepEvents(pair, timeframe, result.sweepEvents);
  await upsertFVGEvents(pair, timeframe, result.fvgEvents);

  // Key levels
  if (result.keyLevels) {
    const today = new Date().toISOString().slice(0, 10);
    await upsertKeyLevels(pair, today, result.keyLevels);
  }

  // Current structure
  await upsertHTFStructure(pair, timeframe, result.currentStructure);

  const total =
    result.swings.length +
    result.bosEvents.length +
    result.sweepEvents.length +
    result.fvgEvents.length;

  console.log(
    `  [${pair}/${timeframe}] ${candles.length} candles → ${result.swings.length} swings, ` +
    `${result.bosEvents.length} BOS, ${result.sweepEvents.length} sweeps, ` +
    `${result.fvgEvents.length} FVGs`
  );

  return total;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI args
  let days = 30;
  let filterPair: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--pair" && args[i + 1]) {
      filterPair = args[i + 1].toUpperCase();
      i++;
    }
  }

  const pairs = filterPair ? [filterPair] : PAIRS;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Structure Seed — TimescaleDB Backfill");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Pairs: ${pairs.length}`);
  console.log(`  Timeframes: ${SEED_TIMEFRAMES.map((t) => t.tf).join(", ")}`);
  console.log(`  Target depth: ~${days} days`);
  console.log("");

  const startTime = Date.now();
  let totalEntities = 0;
  let processedCount = 0;
  const totalJobs = pairs.length * SEED_TIMEFRAMES.length;

  for (const pair of pairs) {
    console.log(`\n[${pair}]`);
    for (const { tf, candleCount } of SEED_TIMEFRAMES) {
      try {
        const entities = await seedPairTimeframe(pair, tf, candleCount);
        totalEntities += entities;
        processedCount++;

        if (processedCount % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`\n  Progress: ${processedCount}/${totalJobs} (${elapsed}s elapsed)\n`);
        }
      } catch (err) {
        console.error(`  [${pair}/${tf}] ERROR:`, err);
      }
    }
    // Pause between pairs to let DB memory recover
    await new Promise((r) => setTimeout(r, 2000));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Seed Complete: ${totalEntities} entities in ${duration}s`);
  console.log(`  Processed: ${processedCount}/${totalJobs} pair×timeframes`);
  console.log("═══════════════════════════════════════════════════════\n");

  await pool?.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
