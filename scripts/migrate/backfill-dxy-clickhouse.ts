#!/usr/bin/env npx tsx
/**
 * Backfill DXY data from Dukascopy to ClickHouse
 *
 * Usage: npx tsx scripts/migrate/backfill-dxy-clickhouse.ts [timeframe]
 * Example: npx tsx scripts/migrate/backfill-dxy-clickhouse.ts M15
 */

import { config } from "dotenv";
import { execSync } from "child_process";
import { readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from "fs";
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Timeframe mapping (Dukascopy format)
const TIMEFRAMES: Record<string, string> = {
  M5: "m5",
  M15: "m15",
  M30: "m30",
  H1: "h1",
  H4: "h4",
  D: "d1",
  W: "w1",
  M: "mn1",
};

interface DukascopyCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

async function fetchDukascopyData(
  timeframe: string,
  fromDate: string,
  toDate: string
): Promise<DukascopyCandle[]> {
  const dukaTf = TIMEFRAMES[timeframe];
  if (!dukaTf) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  if (!existsSync("download")) {
    mkdirSync("download");
  }

  // Clear existing files
  const existingFiles = readdirSync("download").filter(f =>
    f.startsWith(`dollaridxusd-${dukaTf}-bid-`) && f.endsWith(".json")
  );
  for (const f of existingFiles) {
    unlinkSync(`download/${f}`);
  }

  console.log(`  Fetching ${fromDate} to ${toDate}...`);

  try {
    execSync(
      `npx dukascopy-node -i dollaridxusd -from ${fromDate} -to ${toDate} -t ${dukaTf} -f json`,
      { stdio: "pipe" }
    );
  } catch (error) {
    console.error("  Error fetching from Dukascopy");
    return [];
  }

  const files = readdirSync("download").filter(f =>
    f.startsWith(`dollaridxusd-${dukaTf}-bid-`) && f.endsWith(".json")
  );

  if (files.length === 0) {
    return [];
  }

  const outputFile = `download/${files[0]}`;
  const fileContent = readFileSync(outputFile, "utf-8").trim();
  unlinkSync(outputFile);

  if (!fileContent || fileContent === "[]") {
    return [];
  }

  try {
    const data = JSON.parse(fileContent) as DukascopyCandle[];
    return data;
  } catch {
    console.error(`  Warning: Invalid JSON in ${outputFile}`);
    return [];
  }
}

async function insertToClickHouse(
  candles: DukascopyCandle[],
  timeframe: string
): Promise<number> {
  if (candles.length === 0) return 0;

  // Group by month for partitions
  const byMonth: Record<string, DukascopyCandle[]> = {};
  for (const c of candles) {
    const date = new Date(c.timestamp);
    const yyyymm = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth[yyyymm]) byMonth[yyyymm] = [];
    byMonth[yyyymm].push(c);
  }

  let inserted = 0;
  for (const monthCandles of Object.values(byMonth)) {
    const rows = monthCandles.map((c) => ({
      time: new Date(c.timestamp).toISOString().replace("T", " ").replace("Z", ""),
      pair: "DXY",
      timeframe,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: 0,
    }));

    await clickhouse.insert({
      table: "candles",
      values: rows,
      format: "JSONEachRow",
    });

    inserted += rows.length;
  }

  return inserted;
}

async function backfillTimeframe(timeframe: string): Promise<number> {
  console.log(`\n=== DXY ${timeframe} ===`);

  // Dukascopy DXY data starts Dec 2017
  const startYear = 2017;
  const endYear = new Date().getFullYear();
  const endDate = new Date().toISOString().split("T")[0];

  let totalInserted = 0;

  for (let year = startYear; year <= endYear; year++) {
    const fromDate = year === 2017 ? "2017-12-01" : `${year}-01-01`;
    const toDate = year === endYear ? endDate : `${year}-12-31`;

    const candles = await fetchDukascopyData(timeframe, fromDate, toDate);

    if (candles.length > 0) {
      const inserted = await insertToClickHouse(candles, timeframe);
      totalInserted += inserted;
      console.log(`  ${year}: ${inserted.toLocaleString()} candles`);
    }
  }

  console.log(`  Total: ${totalInserted.toLocaleString()} candles`);
  return totalInserted;
}

async function main(): Promise<void> {
  console.log("═".repeat(50));
  console.log("  DXY BACKFILL (Dukascopy → ClickHouse)");
  console.log("═".repeat(50));

  // Test ClickHouse connection
  const result = await clickhouse.query({
    query: "SELECT version()",
    format: "JSONEachRow",
  });
  const version = await result.json();
  console.log(`Connected to ClickHouse v${(version as any)[0]["version()"]}\n`);

  const timeframe = process.argv[2];

  let grandTotal = 0;

  if (timeframe) {
    if (!TIMEFRAMES[timeframe]) {
      console.error(`Invalid timeframe: ${timeframe}`);
      console.error(`Valid: ${Object.keys(TIMEFRAMES).join(", ")}`);
      process.exit(1);
    }
    grandTotal = await backfillTimeframe(timeframe);
  } else {
    // All timeframes (larger first for speed)
    const order = ["M", "W", "D", "H4", "H1", "M30", "M15", "M5"];

    for (const tf of order) {
      grandTotal += await backfillTimeframe(tf);
    }
  }

  console.log("\n" + "═".repeat(50));
  console.log(`  DXY COMPLETE: ${grandTotal.toLocaleString()} candles`);
  console.log("═".repeat(50));

  await clickhouse.close();
}

main().catch(console.error);
