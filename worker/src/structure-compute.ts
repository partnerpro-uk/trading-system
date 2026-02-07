#!/usr/bin/env npx tsx
/**
 * Incremental Structure Computation — Worker Job
 *
 * After each candle sync, computes structure (swings, BOS, sweeps, FVGs,
 * key levels) for the leading edge and persists to TimescaleDB.
 *
 * Triggered after syncTimeframe() in the main worker loop.
 * Only re-computes if new candles have arrived since last computation.
 *
 * Uses the full lib/structure engine (not simplified inline versions)
 * and the existing lib/db/structure upsert functions.
 */

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

/** Timeframes that get structure computation after candle sync. */
export const STRUCTURE_TIMEFRAMES = ["M15", "M30", "H1", "H4", "D", "W", "M"];

/** How many candles to fetch per timeframe for incremental computation. */
const INCREMENTAL_LOOKBACK: Record<string, number> = {
  M15: 60,
  M30: 60,
  H1: 60,
  H4: 50,
  D: 40,
  W: 30,
  M: 20,
};

/** Track last computed candle timestamp per pair:timeframe to skip unchanged data. */
const lastComputedCandle = new Map<string, number>();

// ─── Database ───────────────────────────────────────────────────────────────

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 5,
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

// ─── Core Computation ────────────────────────────────────────────────────────

/**
 * Compute structure for a single pair+timeframe and persist to TimescaleDB.
 * Returns the number of entities upserted, or 0 if skipped.
 */
export async function computeStructureAfterSync(
  pair: string,
  timeframe: string
): Promise<number> {
  const lookback = INCREMENTAL_LOOKBACK[timeframe];
  if (!lookback) return 0;

  // Fetch candles for this timeframe
  const candles = await fetchCandles(pair, timeframe, lookback);
  if (candles.length < 20) return 0;

  // Skip if latest candle hasn't changed since last computation
  const key = `${pair}:${timeframe}`;
  const latestTs = candles[candles.length - 1].timestamp;
  if (lastComputedCandle.get(key) === latestTs) return 0;

  // Fetch D/W/M candles for key level computation
  const [dailyCandles, weeklyCandles, monthlyCandles] = await Promise.all([
    fetchCandles(pair, "D", 60),
    fetchCandles(pair, "W", 20),
    fetchCandles(pair, "M", 13),
  ]);

  // Run structure pipeline (steps 1-9)
  // Steps 7+ (nesting, P/D, MTF, enrichment) are skipped because we
  // don't pass higherTFFVGs, htfStructures, or enableEnrichment options
  const result = computeStructure(
    pair,
    timeframe,
    candles,
    dailyCandles,
    weeklyCandles,
    monthlyCandles
  );

  // Upsert all entities to TimescaleDB (parallel)
  await Promise.all([
    upsertSwingPoints(pair, timeframe, result.swings),
    upsertBOSEvents(pair, timeframe, result.bosEvents),
    upsertSweepEvents(pair, timeframe, result.sweepEvents),
    upsertFVGEvents(pair, timeframe, result.fvgEvents),
  ]);

  // Upsert key levels (date-keyed, idempotent via ON CONFLICT)
  if (result.keyLevels) {
    const today = new Date().toISOString().slice(0, 10);
    await upsertKeyLevels(pair, today, result.keyLevels);
  }

  // Upsert current structure for HTF lookups
  await upsertHTFStructure(pair, timeframe, result.currentStructure);

  // Track latest computed candle
  lastComputedCandle.set(key, latestTs);

  const total =
    result.swings.length +
    result.bosEvents.length +
    result.sweepEvents.length +
    result.fvgEvents.length;

  return total;
}

/**
 * Run structure computation for all pairs on a given timeframe.
 * Called after syncTimeframe() completes in the main worker loop.
 */
export async function runStructureComputeForTimeframe(
  timeframe: string
): Promise<void> {
  const startTime = Date.now();
  let totalEntities = 0;
  let computed = 0;

  for (const pair of PAIRS) {
    try {
      const entities = await computeStructureAfterSync(pair, timeframe);
      if (entities > 0) {
        totalEntities += entities;
        computed++;
      }
    } catch (err) {
      console.error(`[StructureCompute] Error for ${pair}/${timeframe}:`, err);
    }
  }

  const duration = Date.now() - startTime;
  if (computed > 0) {
    console.log(
      `[StructureCompute] ${timeframe}: ${computed} pairs, ${totalEntities} entities in ${duration}ms`
    );
  }
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

async function main() {
  console.log("[StructureCompute] Running manually for all timeframes...");

  for (const tf of STRUCTURE_TIMEFRAMES) {
    await runStructureComputeForTimeframe(tf);
  }

  console.log("[StructureCompute] Done");
  await pool?.end();
}

if (process.argv[1]?.endsWith("structure-compute.ts")) {
  main().catch(console.error);
}
