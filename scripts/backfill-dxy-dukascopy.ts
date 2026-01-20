#!/usr/bin/env npx tsx
/**
 * Backfill DXY data from Dukascopy
 * Uses dukascopy-node CLI to fetch data, then uploads to Convex
 *
 * Usage: npx tsx scripts/backfill-dxy-dukascopy.ts [timeframe]
 * Example: npx tsx scripts/backfill-dxy-dukascopy.ts M15
 */

import { config } from "dotenv";
import { execSync } from "child_process";
import { readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from "fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

// Load environment from .env.local
config({ path: ".env.local" });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  console.error("NEXT_PUBLIC_CONVEX_URL not set");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);

// Timeframe mapping
const TIMEFRAMES: Record<string, string> = {
  M5: "m5",
  M15: "m15",
  M30: "m30",
  H1: "h1",
  H4: "h4",
  D: "d1",
  W: "w1",
  MN: "mn1",
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

  // Ensure download directory exists
  if (!existsSync("download")) {
    mkdirSync("download");
  }

  // Clear any existing files matching pattern before fetching
  const existingFiles = readdirSync("download").filter(f =>
    f.startsWith(`dollaridxusd-${dukaTf}-bid-`) && f.endsWith(".json")
  );
  for (const f of existingFiles) {
    unlinkSync(`download/${f}`);
  }

  console.log(`Fetching DXY ${timeframe} from ${fromDate} to ${toDate}...`);

  try {
    execSync(
      `npx dukascopy-node -i dollaridxusd -from ${fromDate} -to ${toDate} -t ${dukaTf} -f json`,
      { stdio: "pipe" }
    );
  } catch (error) {
    console.error("Error fetching from Dukascopy:", error);
    return [];
  }

  // Find the output file (filename pattern varies)
  const files = readdirSync("download").filter(f =>
    f.startsWith(`dollaridxusd-${dukaTf}-bid-`) && f.endsWith(".json")
  );

  if (files.length === 0) {
    console.error("Output file not created");
    return [];
  }

  const outputFile = `download/${files[0]}`;
  const data = JSON.parse(readFileSync(outputFile, "utf-8")) as DukascopyCandle[];

  // Cleanup
  unlinkSync(outputFile);

  return data;
}

async function uploadToConvex(
  candles: DukascopyCandle[],
  timeframe: string
): Promise<number> {
  if (candles.length === 0) return 0;

  const candlesToStore = candles.map((c) => ({
    pair: "DXY",
    timeframe,
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: 0,
    complete: true,
  }));

  // Upload in batches of 100
  let uploaded = 0;
  for (let i = 0; i < candlesToStore.length; i += 100) {
    const batch = candlesToStore.slice(i, i + 100);
    await client.action(api.candles.uploadCandles, { candles: batch });
    uploaded += batch.length;

    if (uploaded % 10000 === 0) {
      console.log(`  Uploaded ${uploaded} candles...`);
    }
  }

  return uploaded;
}

async function backfillTimeframe(timeframe: string): Promise<void> {
  console.log(`\n=== Backfilling DXY ${timeframe} ===`);

  // Dukascopy DXY data starts Dec 2017
  const startDate = "2017-12-01";
  const endDate = new Date().toISOString().split("T")[0];

  // For large timeframes, fetch all at once
  // For smaller timeframes (M5, M15), fetch in yearly chunks
  const smallTimeframes = ["M5", "M15", "M30"];

  if (smallTimeframes.includes(timeframe)) {
    // Fetch in yearly chunks
    let currentYear = 2017;
    const endYear = new Date().getFullYear();
    let totalUploaded = 0;

    while (currentYear <= endYear) {
      const fromDate =
        currentYear === 2017 ? "2017-12-01" : `${currentYear}-01-01`;
      const toDate =
        currentYear === endYear
          ? endDate
          : `${currentYear}-12-31`;

      console.log(`\nFetching ${currentYear}...`);
      const candles = await fetchDukascopyData(timeframe, fromDate, toDate);
      console.log(`  Got ${candles.length} candles`);

      if (candles.length > 0) {
        const uploaded = await uploadToConvex(candles, timeframe);
        totalUploaded += uploaded;
        console.log(`  Uploaded ${uploaded} candles (total: ${totalUploaded})`);
      }

      currentYear++;
    }

    console.log(`\nTotal ${timeframe}: ${totalUploaded} candles`);
  } else {
    // Fetch all at once for larger timeframes
    const candles = await fetchDukascopyData(timeframe, startDate, endDate);
    console.log(`Got ${candles.length} candles`);

    if (candles.length > 0) {
      const uploaded = await uploadToConvex(candles, timeframe);
      console.log(`Uploaded ${uploaded} candles`);
    }
  }
}

async function main(): Promise<void> {
  const timeframe = process.argv[2];

  if (timeframe) {
    // Backfill specific timeframe
    if (!TIMEFRAMES[timeframe]) {
      console.error(`Invalid timeframe: ${timeframe}`);
      console.error(`Valid timeframes: ${Object.keys(TIMEFRAMES).join(", ")}`);
      process.exit(1);
    }
    await backfillTimeframe(timeframe);
  } else {
    // Backfill all timeframes
    console.log("=== Backfilling all DXY timeframes from Dukascopy ===\n");

    // Order: larger timeframes first (faster), then smaller ones
    const order = ["MN", "W", "D", "H4", "H1", "M30", "M15", "M5"];

    for (const tf of order) {
      await backfillTimeframe(tf);
    }

    console.log("\n=== ALL DXY BACKFILLS COMPLETE ===");
  }
}

main().catch(console.error);
