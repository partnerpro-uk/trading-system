#!/usr/bin/env npx tsx
/**
 * Export ALL candles from Convex to ClickHouse
 * - Batches of 5000 for memory efficiency
 * - Progress logging every batch
 * - Handles resume on failure (tracks cursor)
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@clickhouse/client";
import { api } from "../../convex/_generated/api";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const BATCH_SIZE = 5000;
const PROGRESS_FILE = join(__dirname, "../../data/migration-progress-candles.json");

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
];

const TIMEFRAMES = ["M5", "M15", "H1", "H4", "D"];

// Convex client
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

interface Progress {
  completed: Record<string, Record<string, number>>; // pair -> timeframe -> lastTimestamp
  totalExported: number;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { completed: {}, totalExported: 0 };
}

function saveProgress(progress: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function exportPairTimeframe(
  pair: string,
  timeframe: string,
  progress: Progress
): Promise<number> {
  let exported = 0;
  let cursor = progress.completed[pair]?.[timeframe] ?? 0;
  let hasMore = true;

  console.log(`  Starting ${pair} ${timeframe} from cursor ${cursor}...`);

  while (hasMore) {
    // Fetch batch from Convex
    const candles = await convex.query(api.candles.getCandlesPaginated, {
      pair,
      timeframe,
      after: cursor || undefined,
      limit: BATCH_SIZE,
    });

    if (candles.length === 0) {
      hasMore = false;
      break;
    }

    // Transform for ClickHouse
    const rows = candles.map((c: any) => ({
      time: new Date(c.timestamp).toISOString().replace("T", " ").replace("Z", ""),
      pair: c.pair,
      timeframe: c.timeframe,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
      // Velocity data defaults (can be computed later)
      time_to_high_ms: 0,
      time_to_low_ms: 0,
      high_formed_first: 0,
      body_percent: 0,
      range_pips: 0,
      is_displacement: 0,
      displacement_score: 0,
    }));

    // Insert to ClickHouse
    await clickhouse.insert({
      table: "candles",
      values: rows,
      format: "JSONEachRow",
    });

    exported += candles.length;
    cursor = candles[candles.length - 1].timestamp;

    // Save progress
    if (!progress.completed[pair]) progress.completed[pair] = {};
    progress.completed[pair][timeframe] = cursor;
    progress.totalExported += candles.length;
    saveProgress(progress);

    console.log(
      `    ${pair} ${timeframe}: +${candles.length} (total: ${exported}, cursor: ${new Date(cursor).toISOString()})`
    );

    // Check if we got less than batch size (means no more data)
    if (candles.length < BATCH_SIZE) {
      hasMore = false;
    }

    // Small delay to avoid overwhelming APIs
    await new Promise((r) => setTimeout(r, 100));
  }

  return exported;
}

async function main() {
  console.log("Starting candle export to ClickHouse...\n");

  // Test connections
  const version = await clickhouse.query({
    query: "SELECT version()",
    format: "JSONEachRow",
  });
  const versionData = await version.json();
  console.log(`Connected to ClickHouse v${(versionData as any)[0]["version()"]}\n`);

  const progress = loadProgress();
  console.log(`Resuming from progress: ${progress.totalExported} total exported\n`);

  let grandTotal = 0;

  for (const pair of PAIRS) {
    console.log(`\n${pair}:`);

    for (const tf of TIMEFRAMES) {
      const exported = await exportPairTimeframe(pair, tf, progress);
      grandTotal += exported;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Export complete!`);
  console.log(`Total candles exported: ${grandTotal}`);
  console.log(`${"=".repeat(60)}\n`);

  // Verify counts
  console.log("Verifying ClickHouse counts...\n");
  const countResult = await clickhouse.query({
    query: `
      SELECT pair, timeframe, count(*) as count
      FROM candles
      GROUP BY pair, timeframe
      ORDER BY pair, timeframe
    `,
    format: "JSONEachRow",
  });
  const counts = (await countResult.json()) as any[];

  for (const row of counts) {
    console.log(`  ${row.pair} ${row.timeframe}: ${row.count}`);
  }

  await clickhouse.close();
  console.log("\nDone!");
}

main().catch(console.error);
