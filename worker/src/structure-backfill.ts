#!/usr/bin/env npx tsx
/**
 * Historical Structure Backfill — Worker Job
 *
 * Processes years of ClickHouse candle data through the structure engine.
 * Populates swing_points, bos_events, sweep_events, key_levels, fvg_events
 * in ClickHouse for historical analytics.
 *
 * Resumable: tracks progress per pair × timeframe × month in backfill_progress.
 *
 * Usage:
 *   npx tsx structure-backfill.ts full [startDate] [endDate]
 *   npx tsx structure-backfill.ts incremental
 *   npx tsx structure-backfill.ts status
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { computeStructure } from "../../lib/structure/index";
import type { Candle, StructureResponse } from "../../lib/structure/types";

// ─── Configuration ──────────────────────────────────────────────────────────

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD",
  "XAG_USD", "SPX500_USD",
];

const BACKFILL_TIMEFRAMES = [
  { tf: "H1", lookback: 300 },
  { tf: "H4", lookback: 200 },
  { tf: "D", lookback: 200 },
  { tf: "W", lookback: 104 },
];

const BATCH_SIZE = 1000;

// ─── ClickHouse Client ──────────────────────────────────────────────────────

let client: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_HOST!,
      username: process.env.CLICKHOUSE_USER || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
      database: "default",
      request_timeout: 60000,
    });
  }
  return client;
}

// ─── Candle Fetching ────────────────────────────────────────────────────────

async function fetchCandles(
  pair: string,
  timeframe: string,
  startTime: string,
  endTime: string,
  limit: number = 10000
): Promise<Candle[]> {
  const ch = getClient();

  const result = await ch.query({
    query: `
      SELECT time, open, high, low, close, volume
      FROM candles
      WHERE pair = {pair:String} AND timeframe = {timeframe:String}
        AND time >= {startTime:String} AND time <= {endTime:String}
      ORDER BY time ASC
      LIMIT {limit:UInt32}
    `,
    query_params: { pair, timeframe, startTime, endTime, limit },
    format: "JSONEachRow",
  });

  interface Row { time: string; open: string; high: string; low: string; close: string; volume: string; }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    time: r.time,
    timestamp: new Date(r.time).getTime(),
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: parseInt(r.volume) || 0,
  }));
}

// ─── Progress Tracking ──────────────────────────────────────────────────────

interface ProgressEntry {
  pair: string;
  timeframe: string;
  yearMonth: string;
  status: string;
}

async function getCompletedMonths(): Promise<Set<string>> {
  const ch = getClient();
  const result = await ch.query({
    query: `SELECT pair, timeframe, year_month FROM backfill_progress FINAL WHERE status = 'complete'`,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ pair: string; timeframe: string; year_month: string }>();
  return new Set(rows.map((r) => `${r.pair}:${r.timeframe}:${r.year_month}`));
}

async function markProgress(pair: string, timeframe: string, yearMonth: string, rowsWritten: number, status: string): Promise<void> {
  const ch = getClient();
  await ch.insert({
    table: "backfill_progress",
    values: [{ pair, timeframe, year_month: yearMonth, rows_written: rowsWritten, status }],
    format: "JSONEachRow",
  });
}

// ─── Result Conversion + Batch Insert ───────────────────────────────────────

function toISOString(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").replace("Z", "");
}

async function insertResults(
  pair: string,
  timeframe: string,
  result: StructureResponse,
  monthStart: number,
  monthEnd: number
): Promise<number> {
  const ch = getClient();
  let totalRows = 0;

  // Filter to only include entities within the target month
  const inMonth = (ts: number) => ts >= monthStart && ts < monthEnd;

  // Swing points
  const swingRows = result.swings
    .filter((s) => inMonth(s.timestamp))
    .map((s) => ({
      time: toISOString(s.timestamp),
      pair,
      timeframe,
      price: s.price,
      swing_type: s.type,
      label: s.label || "unknown",
      lookback_used: s.lookbackUsed,
      true_range: s.trueRange,
    }));

  if (swingRows.length > 0) {
    for (let i = 0; i < swingRows.length; i += BATCH_SIZE) {
      await ch.insert({ table: "swing_points", values: swingRows.slice(i, i + BATCH_SIZE), format: "JSONEachRow" });
    }
    totalRows += swingRows.length;
  }

  // BOS events
  const bosRows = result.bosEvents
    .filter((e) => inMonth(e.timestamp))
    .map((e) => ({
      time: toISOString(e.timestamp),
      pair,
      timeframe,
      direction: e.direction,
      status: e.status,
      broken_level: e.brokenLevel,
      broken_swing_time: toISOString(e.brokenSwingTimestamp),
      confirming_close: e.confirmingClose,
      magnitude_pips: e.magnitudePips,
      is_displacement: e.isDisplacement ? 1 : 0,
      is_counter_trend: e.isCounterTrend ? 1 : 0,
      reclaimed_at: e.reclaimedAt ? toISOString(e.reclaimedAt) : null,
      reclaimed_by_close: e.reclaimedByClose ?? null,
      time_til_reclaim_ms: e.timeTilReclaim ?? null,
    }));

  if (bosRows.length > 0) {
    for (let i = 0; i < bosRows.length; i += BATCH_SIZE) {
      await ch.insert({ table: "bos_events", values: bosRows.slice(i, i + BATCH_SIZE), format: "JSONEachRow" });
    }
    totalRows += bosRows.length;
  }

  // Sweep events
  const sweepRows = result.sweepEvents
    .filter((e) => inMonth(e.timestamp))
    .map((e) => ({
      time: toISOString(e.timestamp),
      pair,
      timeframe,
      direction: e.direction,
      swept_level: e.sweptLevel,
      wick_extreme: e.wickExtreme,
      swept_level_type: e.sweptLevelType,
      followed_by_bos: e.followedByBOS ? 1 : 0,
    }));

  if (sweepRows.length > 0) {
    for (let i = 0; i < sweepRows.length; i += BATCH_SIZE) {
      await ch.insert({ table: "sweep_events", values: sweepRows.slice(i, i + BATCH_SIZE), format: "JSONEachRow" });
    }
    totalRows += sweepRows.length;
  }

  // FVG events
  const fvgRows = result.fvgEvents
    .filter((e) => inMonth(e.createdAt))
    .map((e) => ({
      time: toISOString(e.createdAt),
      pair,
      timeframe,
      direction: e.direction,
      status: e.status,
      top_price: e.topPrice,
      bottom_price: e.bottomPrice,
      midline: e.midline,
      gap_size_pips: e.gapSizePips,
      displacement_body: e.displacementBody,
      displacement_range: e.displacementRange,
      gap_to_body_ratio: e.gapToBodyRatio,
      is_displacement: e.isDisplacement ? 1 : 0,
      relative_volume: e.relativeVolume,
      tier: e.tier,
      fill_percent: e.fillPercent,
      max_fill_percent: e.maxFillPercent,
      body_filled: e.bodyFilled ? 1 : 0,
      wick_touched: e.wickTouched ? 1 : 0,
      first_touch_at: e.firstTouchAt ? toISOString(e.firstTouchAt) : null,
      first_touch_bars_after: e.firstTouchBarsAfter ?? null,
      retest_count: e.retestCount,
      midline_respected: e.midlineRespected ? 1 : 0,
      midline_touch_count: e.midlineTouchCount,
      filled_at: e.filledAt ? toISOString(e.filledAt) : null,
      bars_to_fill: e.barsToFill ?? null,
      inverted_at: e.invertedAt ? toISOString(e.invertedAt) : null,
      bars_to_inversion: e.barsToInversion ?? null,
      parent_bos: e.parentBOS ?? null,
      contained_by: e.containedBy ?? [],
      confluence_with: e.confluenceWith ?? [],
      trade_id: e.tradeId ?? null,
    }));

  if (fvgRows.length > 0) {
    for (let i = 0; i < fvgRows.length; i += BATCH_SIZE) {
      await ch.insert({ table: "fvg_events", values: fvgRows.slice(i, i + BATCH_SIZE), format: "JSONEachRow" });
    }
    totalRows += fvgRows.length;
  }

  return totalRows;
}

// ─── Month Processing ───────────────────────────────────────────────────────

function generateMonths(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const start = new Date(startDate + "-01");
  const end = new Date(endDate + "-01");

  const current = new Date(start);
  while (current <= end) {
    months.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`);
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

async function processMonth(
  pair: string,
  timeframe: string,
  yearMonth: string,
  lookback: number
): Promise<number> {
  const [year, month] = yearMonth.split("-").map(Number);

  // Month boundaries
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1); // first day of next month

  // Fetch candles with lookback window before month start
  // Use a generous time window for lookback (lookback * timeframe duration)
  const tfHours: Record<string, number> = { H1: 1, H4: 4, D: 24, W: 168 };
  const hoursPerCandle = tfHours[timeframe] || 4;
  const lookbackMs = lookback * hoursPerCandle * 60 * 60 * 1000;
  const fetchStart = new Date(monthStart.getTime() - lookbackMs);

  const candles = await fetchCandles(
    pair,
    timeframe,
    fetchStart.toISOString(),
    monthEnd.toISOString()
  );

  if (candles.length < 20) {
    return 0;
  }

  // Fetch D/W/M candles for key level computation
  const [dailyCandles, weeklyCandles, monthlyCandles] = await Promise.all([
    fetchCandles(pair, "D", fetchStart.toISOString(), monthEnd.toISOString()),
    fetchCandles(pair, "W", new Date(fetchStart.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString(), monthEnd.toISOString()),
    fetchCandles(pair, "M", new Date(fetchStart.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString(), monthEnd.toISOString()),
  ]);

  // Run structure computation
  const result = computeStructure(
    pair,
    timeframe,
    candles,
    dailyCandles,
    weeklyCandles,
    monthlyCandles
  );

  // Insert results (filtered to target month only)
  const rowsWritten = await insertResults(
    pair,
    timeframe,
    result,
    monthStart.getTime(),
    monthEnd.getTime()
  );

  return rowsWritten;
}

// ─── Backfill Entry Points ──────────────────────────────────────────────────

export async function backfillHistorical(
  startDate?: string,
  endDate?: string
): Promise<void> {
  const start = startDate || "2020-01";
  const end = endDate || new Date().toISOString().slice(0, 7); // Current month
  const months = generateMonths(start, end);
  const completed = await getCompletedMonths();

  console.log(`[Backfill] Processing ${PAIRS.length} pairs × ${BACKFILL_TIMEFRAMES.length} timeframes × ${months.length} months`);
  console.log(`[Backfill] Already completed: ${completed.size} entries`);

  let totalProcessed = 0;
  let totalRows = 0;

  for (const pair of PAIRS) {
    for (const { tf, lookback } of BACKFILL_TIMEFRAMES) {
      for (const month of months) {
        const key = `${pair}:${tf}:${month}`;
        if (completed.has(key)) continue;

        try {
          const rows = await processMonth(pair, tf, month, lookback);
          await markProgress(pair, tf, month, rows, "complete");
          totalProcessed++;
          totalRows += rows;

          if (totalProcessed % 10 === 0) {
            console.log(`[Backfill] Progress: ${totalProcessed} months processed, ${totalRows} total rows`);
          }
        } catch (err) {
          console.error(`[Backfill] Error for ${pair}/${tf}/${month}:`, err);
          await markProgress(pair, tf, month, 0, "error");
        }
      }
    }
  }

  console.log(`[Backfill] Complete: ${totalProcessed} months, ${totalRows} rows inserted`);
}

export async function runIncrementalBackfill(): Promise<void> {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  console.log(`[Backfill] Incremental run for ${currentMonth}`);

  let totalRows = 0;

  for (const pair of PAIRS) {
    for (const { tf, lookback } of BACKFILL_TIMEFRAMES) {
      try {
        const rows = await processMonth(pair, tf, currentMonth, lookback);
        await markProgress(pair, tf, currentMonth, rows, "complete");
        totalRows += rows;
      } catch (err) {
        console.error(`[Backfill] Error for ${pair}/${tf}/${currentMonth}:`, err);
      }
    }
  }

  console.log(`[Backfill] Incremental complete: ${totalRows} rows`);
}

async function printStatus(): Promise<void> {
  const completed = await getCompletedMonths();
  const totalPossible = PAIRS.length * BACKFILL_TIMEFRAMES.length;

  console.log(`\n[Backfill Status]`);
  console.log(`Total completed month entries: ${completed.size}`);
  console.log(`Pairs: ${PAIRS.length}, Timeframes: ${BACKFILL_TIMEFRAMES.length}`);

  // Group by pair
  for (const pair of PAIRS) {
    const pairCompleted: Record<string, number> = {};
    for (const { tf } of BACKFILL_TIMEFRAMES) {
      pairCompleted[tf] = 0;
      for (const key of completed) {
        if (key.startsWith(`${pair}:${tf}:`)) pairCompleted[tf]++;
      }
    }
    const tfSummary = BACKFILL_TIMEFRAMES.map(({ tf }) => `${tf}:${pairCompleted[tf]}`).join(", ");
    console.log(`  ${pair}: ${tfSummary}`);
  }
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "incremental";

  switch (command) {
    case "full":
      await backfillHistorical(args[1], args[2]);
      break;
    case "incremental":
      await runIncrementalBackfill();
      break;
    case "status":
      await printStatus();
      break;
    default:
      console.log("Usage: npx tsx structure-backfill.ts [full|incremental|status] [startDate] [endDate]");
  }

  await client?.close();
}

if (process.argv[1]?.endsWith("structure-backfill.ts")) {
  main().catch(console.error);
}
