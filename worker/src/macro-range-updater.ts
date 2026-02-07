#!/usr/bin/env npx tsx
/**
 * Macro Range Updater — Worker Job
 *
 * Computes all-time high/low for each pair from ClickHouse daily candles.
 * Stores results in macro_ranges table for Premium/Discount computation.
 *
 * Schedule: Daily (startup + 24h interval)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient, ClickHouseClient } from "@clickhouse/client";

// =============================================================================
// Configuration
// =============================================================================

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL || "http://localhost:8123";
const CLICKHOUSE_DB = process.env.CLICKHOUSE_DB || "default";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || "default";
const CLICKHOUSE_PASS = process.env.CLICKHOUSE_PASSWORD || "";

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD",
  "XAG_USD", "SPX500_USD",
];

// =============================================================================
// Database
// =============================================================================

let client: ClickHouseClient | null = null;

function getClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: CLICKHOUSE_URL,
      database: CLICKHOUSE_DB,
      username: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASS,
    });
  }
  return client;
}

// =============================================================================
// Macro Range Computation
// =============================================================================

interface AggRow {
  highest_high: string;
  lowest_low: string;
  data_start_date: string;
  data_end_date: string;
  candle_count: string;
}

async function computeRangeForPair(pair: string): Promise<{ high: number; low: number } | null> {
  const ch = getClient();

  const result = await ch.query({
    query: `
      SELECT
        max(high) AS highest_high,
        min(low) AS lowest_low,
        min(toDate(time)) AS data_start_date,
        max(toDate(time)) AS data_end_date,
        count() AS candle_count
      FROM candles
      WHERE pair = {pair:String}
        AND timeframe = 'D'
    `,
    query_params: { pair },
    format: "JSONEachRow",
  });

  const rows = await result.json<AggRow>();
  if (rows.length === 0) return null;

  const row = rows[0];
  const high = parseFloat(row.highest_high);
  const low = parseFloat(row.lowest_low);

  if (isNaN(high) || isNaN(low) || high <= low) return null;

  // Upsert into macro_ranges
  await ch.insert({
    table: "macro_ranges",
    values: [
      {
        pair,
        highest_high: high,
        lowest_low: low,
        data_start_date: row.data_start_date,
        data_end_date: row.data_end_date,
        candle_count: parseInt(row.candle_count),
      },
    ],
    format: "JSONEachRow",
  });

  return { high, low };
}

// =============================================================================
// Main entry
// =============================================================================

export async function runMacroRangeUpdater(): Promise<void> {
  let updated = 0;

  for (const pair of PAIRS) {
    try {
      const range = await computeRangeForPair(pair);
      if (range) {
        updated++;
        console.log(`[MacroRange] ${pair}: ${range.low.toFixed(5)} — ${range.high.toFixed(5)}`);
      }
    } catch (err) {
      console.error(`[MacroRange] Error for ${pair}:`, err);
    }
  }

  console.log(`[MacroRange] Updated ${updated}/${PAIRS.length} pairs`);
}

// CLI entry
async function main() {
  console.log("[MacroRange] Running manually...");
  await runMacroRangeUpdater();
  console.log("[MacroRange] Done");
  await client?.close();
}

if (process.argv[1]?.endsWith("macro-range-updater.ts")) {
  main().catch(console.error);
}
