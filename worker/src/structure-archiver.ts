#!/usr/bin/env npx tsx
/**
 * Structure Data Archiver — Worker Job
 *
 * Moves expired structure data (>30 days) from TimescaleDB to ClickHouse.
 * Runs daily to keep TimescaleDB lean while preserving historical data.
 *
 * Schedule: Daily (startup + 24h interval)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Pool } from "pg";
import { createClient, type ClickHouseClient } from "@clickhouse/client";

// ─── Configuration ──────────────────────────────────────────────────────────

const TIMESCALE_URL = process.env.TIMESCALE_URL!;
const ARCHIVE_THRESHOLD_DAYS = 30;
const BATCH_SIZE = 1000;

// ─── Database Connections ───────────────────────────────────────────────────

let pool: Pool | null = null;
let chClient: ClickHouseClient | null = null;

function getPool(): Pool {
  if (!pool) {
    const url = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
    pool = new Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

function getCH(): ClickHouseClient {
  if (!chClient) {
    chClient = createClient({
      url: process.env.CLICKHOUSE_HOST!,
      username: process.env.CLICKHOUSE_USER || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
      database: "default",
      request_timeout: 30000,
    });
  }
  return chClient;
}

function toISOString(ts: Date | string): string {
  return new Date(ts).toISOString().replace("T", " ").replace("Z", "");
}

// ─── Archive Functions ──────────────────────────────────────────────────────

async function archiveSwingPoints(): Promise<number> {
  const db = getPool();
  const ch = getCH();
  let totalArchived = 0;

  while (true) {
    const result = await db.query(
      `SELECT time, pair, timeframe, price::float, swing_type, label, lookback_used, true_range::float
       FROM swing_points
       WHERE time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'
       ORDER BY time ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (result.rows.length === 0) break;

    const rows = result.rows.map((r) => ({
      time: toISOString(r.time),
      pair: r.pair,
      timeframe: r.timeframe,
      price: r.price,
      swing_type: r.swing_type,
      label: r.label || "unknown",
      lookback_used: r.lookback_used,
      true_range: r.true_range,
    }));

    await ch.insert({ table: "swing_points", values: rows, format: "JSONEachRow" });

    // Delete archived rows
    const oldest = result.rows[0].time;
    const newest = result.rows[result.rows.length - 1].time;
    await db.query(
      `DELETE FROM swing_points WHERE time >= $1 AND time <= $2 AND time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'`,
      [oldest, newest]
    );

    totalArchived += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }

  return totalArchived;
}

async function archiveBOSEvents(): Promise<number> {
  const db = getPool();
  const ch = getCH();
  let totalArchived = 0;

  while (true) {
    const result = await db.query(
      `SELECT time, pair, timeframe, direction, status, broken_level::float,
         broken_swing_time, confirming_close::float, magnitude_pips::float,
         is_displacement, is_counter_trend,
         reclaimed_at, reclaimed_by_close::float, time_til_reclaim_ms
       FROM bos_events
       WHERE time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'
       ORDER BY time ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (result.rows.length === 0) break;

    const rows = result.rows.map((r) => ({
      time: toISOString(r.time),
      pair: r.pair,
      timeframe: r.timeframe,
      direction: r.direction,
      status: r.status,
      broken_level: r.broken_level,
      broken_swing_time: toISOString(r.broken_swing_time),
      confirming_close: r.confirming_close,
      magnitude_pips: r.magnitude_pips,
      is_displacement: r.is_displacement ? 1 : 0,
      is_counter_trend: r.is_counter_trend ? 1 : 0,
      reclaimed_at: r.reclaimed_at ? toISOString(r.reclaimed_at) : null,
      reclaimed_by_close: r.reclaimed_by_close ?? null,
      time_til_reclaim_ms: r.time_til_reclaim_ms ?? null,
    }));

    await ch.insert({ table: "bos_events", values: rows, format: "JSONEachRow" });

    const oldest = result.rows[0].time;
    const newest = result.rows[result.rows.length - 1].time;
    await db.query(
      `DELETE FROM bos_events WHERE time >= $1 AND time <= $2 AND time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'`,
      [oldest, newest]
    );

    totalArchived += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }

  return totalArchived;
}

async function archiveSweepEvents(): Promise<number> {
  const db = getPool();
  const ch = getCH();
  let totalArchived = 0;

  while (true) {
    const result = await db.query(
      `SELECT time, pair, timeframe, direction, swept_level::float,
         wick_extreme::float, swept_level_type, followed_by_bos
       FROM sweep_events
       WHERE time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'
       ORDER BY time ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (result.rows.length === 0) break;

    const rows = result.rows.map((r) => ({
      time: toISOString(r.time),
      pair: r.pair,
      timeframe: r.timeframe,
      direction: r.direction,
      swept_level: r.swept_level,
      wick_extreme: r.wick_extreme,
      swept_level_type: r.swept_level_type,
      followed_by_bos: r.followed_by_bos ? 1 : 0,
    }));

    await ch.insert({ table: "sweep_events", values: rows, format: "JSONEachRow" });

    const oldest = result.rows[0].time;
    const newest = result.rows[result.rows.length - 1].time;
    await db.query(
      `DELETE FROM sweep_events WHERE time >= $1 AND time <= $2 AND time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'`,
      [oldest, newest]
    );

    totalArchived += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }

  return totalArchived;
}

async function archiveKeyLevels(): Promise<number> {
  const db = getPool();
  const ch = getCH();
  let totalArchived = 0;

  while (true) {
    const result = await db.query(
      `SELECT date, pair, pdh::float, pdl::float, pwh::float, pwl::float,
         pmh::float, pml::float, yh::float, yl::float
       FROM key_levels
       WHERE date < CURRENT_DATE - ${ARCHIVE_THRESHOLD_DAYS}
       ORDER BY date ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (result.rows.length === 0) break;

    const rows = result.rows.map((r) => ({
      date: new Date(r.date).toISOString().split("T")[0],
      pair: r.pair,
      pdh: r.pdh,
      pdl: r.pdl,
      pwh: r.pwh,
      pwl: r.pwl,
      pmh: r.pmh,
      pml: r.pml,
      yh: r.yh,
      yl: r.yl,
    }));

    await ch.insert({ table: "key_levels", values: rows, format: "JSONEachRow" });

    const oldest = result.rows[0].date;
    const newest = result.rows[result.rows.length - 1].date;
    await db.query(
      `DELETE FROM key_levels WHERE date >= $1 AND date <= $2 AND date < CURRENT_DATE - ${ARCHIVE_THRESHOLD_DAYS}`,
      [oldest, newest]
    );

    totalArchived += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }

  return totalArchived;
}

async function archiveFVGEvents(): Promise<number> {
  const db = getPool();
  const ch = getCH();
  let totalArchived = 0;

  // Only archive FVGs that are fully resolved (filled/inverted), not fresh/partial
  while (true) {
    const result = await db.query(
      `SELECT time, pair, timeframe, direction, status,
         top_price::float, bottom_price::float, midline::float, gap_size_pips::float,
         displacement_body::float, displacement_range::float, gap_to_body_ratio::float,
         is_displacement, relative_volume::float, tier,
         fill_percent::float, max_fill_percent::float, body_filled, wick_touched,
         first_touch_at, first_touch_bars_after,
         retest_count, midline_respected, midline_touch_count,
         filled_at, bars_to_fill, inverted_at, bars_to_inversion,
         parent_bos, contained_by, confluence_with, trade_id
       FROM fvg_events
       WHERE time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'
         AND status IN ('filled', 'inverted')
       ORDER BY time ASC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    if (result.rows.length === 0) break;

    const rows = result.rows.map((r) => ({
      time: toISOString(r.time),
      pair: r.pair,
      timeframe: r.timeframe,
      direction: r.direction,
      status: r.status,
      top_price: r.top_price,
      bottom_price: r.bottom_price,
      midline: r.midline,
      gap_size_pips: r.gap_size_pips,
      displacement_body: r.displacement_body,
      displacement_range: r.displacement_range,
      gap_to_body_ratio: r.gap_to_body_ratio,
      is_displacement: r.is_displacement ? 1 : 0,
      relative_volume: r.relative_volume,
      tier: r.tier,
      fill_percent: r.fill_percent,
      max_fill_percent: r.max_fill_percent,
      body_filled: r.body_filled ? 1 : 0,
      wick_touched: r.wick_touched ? 1 : 0,
      first_touch_at: r.first_touch_at ? toISOString(r.first_touch_at) : null,
      first_touch_bars_after: r.first_touch_bars_after ?? null,
      retest_count: r.retest_count,
      midline_respected: r.midline_respected ? 1 : 0,
      midline_touch_count: r.midline_touch_count,
      filled_at: r.filled_at ? toISOString(r.filled_at) : null,
      bars_to_fill: r.bars_to_fill ?? null,
      inverted_at: r.inverted_at ? toISOString(r.inverted_at) : null,
      bars_to_inversion: r.bars_to_inversion ?? null,
      parent_bos: r.parent_bos ?? null,
      contained_by: r.contained_by ?? [],
      confluence_with: r.confluence_with ?? [],
      trade_id: r.trade_id ?? null,
    }));

    await ch.insert({ table: "fvg_events", values: rows, format: "JSONEachRow" });

    const oldest = result.rows[0].time;
    const newest = result.rows[result.rows.length - 1].time;
    await db.query(
      `DELETE FROM fvg_events
       WHERE time >= $1 AND time <= $2
         AND time < NOW() - INTERVAL '${ARCHIVE_THRESHOLD_DAYS} days'
         AND status IN ('filled', 'inverted')`,
      [oldest, newest]
    );

    totalArchived += result.rows.length;
    if (result.rows.length < BATCH_SIZE) break;
  }

  return totalArchived;
}

// ─── Main Entry ─────────────────────────────────────────────────────────────

export async function runStructureArchival(): Promise<void> {
  console.log("[Archiver] Starting structure archival...");

  const [swings, bos, sweeps, keyLevels, fvgs] = await Promise.all([
    archiveSwingPoints().catch((err) => { console.error("[Archiver] Swing error:", err); return 0; }),
    archiveBOSEvents().catch((err) => { console.error("[Archiver] BOS error:", err); return 0; }),
    archiveSweepEvents().catch((err) => { console.error("[Archiver] Sweep error:", err); return 0; }),
    archiveKeyLevels().catch((err) => { console.error("[Archiver] Key levels error:", err); return 0; }),
    archiveFVGEvents().catch((err) => { console.error("[Archiver] FVG error:", err); return 0; }),
  ]);

  const total = swings + bos + sweeps + keyLevels + fvgs;
  console.log(`[Archiver] Complete: ${total} rows archived (swings=${swings}, bos=${bos}, sweeps=${sweeps}, keyLevels=${keyLevels}, fvgs=${fvgs})`);
}

// CLI entry
async function main() {
  console.log("[Archiver] Running manually...");
  await runStructureArchival();
  console.log("[Archiver] Done");
  await pool?.end();
  await chClient?.close();
}

if (process.argv[1]?.endsWith("structure-archiver.ts")) {
  main().catch(console.error);
}
