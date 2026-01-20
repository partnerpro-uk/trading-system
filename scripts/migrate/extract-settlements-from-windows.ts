/**
 * Extract Settlement Prices (T+60, T+90) from ClickHouse event_candle_windows
 *
 * The event_candle_windows table contains M1 candle arrays:
 * - 30-min windows: T-15 to T+14 (indices 1-30)
 * - 75-min windows: T-15 to T+59 (indices 1-75) - can extract T+60 approx
 * - 105-min windows: T-15 to T+89 (indices 1-105) - can extract T+90 approx
 *
 * This script extracts settlement prices and updates event_price_reactions.
 *
 * Run: npx tsx scripts/migrate/extract-settlements-from-windows.ts
 */

import { createClient, ClickHouseClient } from "@clickhouse/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BATCH_SIZE = 5000;

// Index calculations (1-based arrays in ClickHouse):
// Window starts at T-15 (15 min before event)
// Each index = minute in window, index 1 = T-15
//
// T-15 = index 1 (first candle)
// T+0 = index 16 (1 + 15)
// T+15 = index 31 (1 + 30)
// T+30 = index 46 (1 + 45)
// T+59 = index 75 (last candle in 75-min window, use as T+60)
// T+89 = index 105 (last candle in 105-min window, use as T+90)
//
// Note: Arrays have exactly candle_count elements, so max index = candle_count
// For 75-candle windows: indices 1-75 (T-15 to T+59)
// For 105-candle windows: indices 1-105 (T-15 to T+89)

const INDEX_T_MINUS_15 = 1;
const INDEX_T_MINUS_5 = 11; // 1 + 10
const INDEX_T_PLUS_0 = 16; // 1 + 15
const INDEX_T_PLUS_5 = 21; // 1 + 20
const INDEX_T_PLUS_15 = 31; // 1 + 30
const INDEX_T_PLUS_30 = 46; // 1 + 45
const INDEX_T_PLUS_59 = 75; // Last index in 75-min window (use as T+60)
const INDEX_T_PLUS_89 = 105; // Last index in 105-min window (use as T+90)

async function main() {
  console.log("=".repeat(60));
  console.log("Extract Settlement Prices from event_candle_windows");
  console.log("=".repeat(60));

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  try {
    // Test connection
    console.log("\n[1/6] Testing ClickHouse connection...");
    await clickhouse.query({ query: "SELECT 1" });
    console.log("  ✓ Connected");

    // Get statistics on available windows
    console.log("\n[2/6] Analyzing event_candle_windows...");
    const windowStats = await clickhouse.query({
      query: `
        SELECT
          CASE
            WHEN candle_count >= 105 THEN '105+ (T+90 available)'
            WHEN candle_count >= 75 THEN '75+ (T+60 available)'
            WHEN candle_count >= 45 THEN '45+ (T+30 available)'
            ELSE '<45 (partial)'
          END as window_category,
          count() as cnt
        FROM event_candle_windows
        GROUP BY window_category
        ORDER BY window_category
      `,
      format: "JSONEachRow",
    });
    const stats = (await windowStats.json()) as { window_category: string; cnt: string }[];
    console.log("  Window coverage:");
    for (const stat of stats) {
      console.log(`    ${stat.window_category}: ${parseInt(stat.cnt).toLocaleString()}`);
    }

    // Count how many reactions we can potentially update
    console.log("\n[3/6] Counting reactions to update...");
    const reactionsCount = await clickhouse.query({
      query: "SELECT count() as cnt FROM event_price_reactions",
      format: "JSONEachRow",
    });
    const totalReactions = parseInt(((await reactionsCount.json()) as { cnt: string }[])[0].cnt);
    console.log(`  Total reactions: ${totalReactions.toLocaleString()}`);

    // Check current state of T+60/T+90 columns
    const nullCheck = await clickhouse.query({
      query: `
        SELECT
          countIf(price_at_plus_60m IS NULL) as null_60m,
          countIf(price_at_plus_60m IS NOT NULL AND price_at_plus_60m > 0) as has_60m,
          countIf(price_at_plus_90m IS NULL) as null_90m,
          countIf(price_at_plus_90m IS NOT NULL AND price_at_plus_90m > 0) as has_90m
        FROM event_price_reactions
      `,
      format: "JSONEachRow",
    });
    const nullStats = (await nullCheck.json()) as {
      null_60m: string;
      has_60m: string;
      null_90m: string;
      has_90m: string;
    }[];
    console.log(`  T+60 null: ${parseInt(nullStats[0].null_60m).toLocaleString()}, populated: ${parseInt(nullStats[0].has_60m).toLocaleString()}`);
    console.log(`  T+90 null: ${parseInt(nullStats[0].null_90m).toLocaleString()}, populated: ${parseInt(nullStats[0].has_90m).toLocaleString()}`);

    // Create a temporary table with extracted prices
    console.log("\n[4/6] Creating temporary table with extracted prices...");

    // Drop temp table if exists
    await clickhouse.command({
      query: "DROP TABLE IF EXISTS event_price_reactions_temp",
    });

    // Create temp table by joining and extracting
    await clickhouse.command({
      query: `
        CREATE TABLE event_price_reactions_temp
        ENGINE = MergeTree()
        ORDER BY (event_id, pair)
        AS
        SELECT
          r.event_id,
          r.pair,
          r.price_at_minus_15m,
          r.price_at_minus_5m,
          r.price_at_event,
          r.spike_high,
          r.spike_low,
          r.spike_direction,
          r.spike_magnitude_pips,
          r.time_to_spike_seconds,
          r.price_at_plus_5m,
          r.price_at_plus_15m,
          r.price_at_plus_30m,
          -- Extract T+60 from 75+ candle windows (using T+59 as approximation)
          CASE
            WHEN w.candle_count >= 75 THEN toDecimal64(w.candle_closes[${INDEX_T_PLUS_59}], 5)
            ELSE r.price_at_plus_60m
          END as price_at_plus_60m,
          -- Extract T+90 from 105+ candle windows (using T+89 as approximation)
          CASE
            WHEN w.candle_count >= 105 THEN toDecimal64(w.candle_closes[${INDEX_T_PLUS_89}], 5)
            ELSE r.price_at_plus_90m
          END as price_at_plus_90m,
          r.pattern_type,
          r.did_reverse,
          r.reversal_magnitude_pips,
          r.final_matches_spike,
          -- Update window_minutes based on actual window size
          CASE
            WHEN w.candle_count >= 105 THEN 105
            WHEN w.candle_count >= 75 THEN 75
            WHEN w.candle_count >= 30 THEN 30
            ELSE r.window_minutes
          END as window_minutes,
          now() as created_at
        FROM event_price_reactions r
        LEFT JOIN event_candle_windows w ON r.event_id = w.event_id AND r.pair = w.pair
      `,
    });

    // Verify temp table
    const tempCount = await clickhouse.query({
      query: "SELECT count() as cnt FROM event_price_reactions_temp",
      format: "JSONEachRow",
    });
    const tempRows = parseInt(((await tempCount.json()) as { cnt: string }[])[0].cnt);
    console.log(`  ✓ Created temp table with ${tempRows.toLocaleString()} rows`);

    // Check extraction results
    const extractionStats = await clickhouse.query({
      query: `
        SELECT
          countIf(price_at_plus_60m IS NOT NULL AND price_at_plus_60m > 0) as has_60m,
          countIf(price_at_plus_90m IS NOT NULL AND price_at_plus_90m > 0) as has_90m,
          countIf(window_minutes = 30) as windows_30,
          countIf(window_minutes = 75) as windows_75,
          countIf(window_minutes = 105) as windows_105
        FROM event_price_reactions_temp
      `,
      format: "JSONEachRow",
    });
    const extracted = (await extractionStats.json()) as {
      has_60m: string;
      has_90m: string;
      windows_30: string;
      windows_75: string;
      windows_105: string;
    }[];
    console.log(`  After extraction:`);
    console.log(`    T+60 populated: ${parseInt(extracted[0].has_60m).toLocaleString()}`);
    console.log(`    T+90 populated: ${parseInt(extracted[0].has_90m).toLocaleString()}`);
    console.log(`    30-min windows: ${parseInt(extracted[0].windows_30).toLocaleString()}`);
    console.log(`    75-min windows: ${parseInt(extracted[0].windows_75).toLocaleString()}`);
    console.log(`    105-min windows: ${parseInt(extracted[0].windows_105).toLocaleString()}`);

    // Swap tables
    console.log("\n[5/6] Swapping tables...");

    // Rename original to backup
    await clickhouse.command({
      query: "RENAME TABLE event_price_reactions TO event_price_reactions_backup",
    });
    console.log("  ✓ Backed up original to event_price_reactions_backup");

    // Rename temp to main
    await clickhouse.command({
      query: "RENAME TABLE event_price_reactions_temp TO event_price_reactions",
    });
    console.log("  ✓ Promoted temp table to event_price_reactions");

    // Verify final table
    console.log("\n[6/6] Verifying final table...");
    const finalCount = await clickhouse.query({
      query: "SELECT count() as cnt FROM event_price_reactions",
      format: "JSONEachRow",
    });
    const finalRows = parseInt(((await finalCount.json()) as { cnt: string }[])[0].cnt);

    const finalStats = await clickhouse.query({
      query: `
        SELECT
          countIf(price_at_plus_60m IS NOT NULL AND price_at_plus_60m > 0) as has_60m,
          countIf(price_at_plus_90m IS NOT NULL AND price_at_plus_90m > 0) as has_90m
        FROM event_price_reactions
      `,
      format: "JSONEachRow",
    });
    const final = (await finalStats.json()) as { has_60m: string; has_90m: string }[];

    console.log(`  Total rows: ${finalRows.toLocaleString()}`);
    console.log(`  T+60 coverage: ${parseInt(final[0].has_60m).toLocaleString()} (${((parseInt(final[0].has_60m) / finalRows) * 100).toFixed(1)}%)`);
    console.log(`  T+90 coverage: ${parseInt(final[0].has_90m).toLocaleString()} (${((parseInt(final[0].has_90m) / finalRows) * 100).toFixed(1)}%)`);

    // Sample some data
    console.log("\n  Sample extracted prices:");
    const sample = await clickhouse.query({
      query: `
        SELECT
          event_id,
          pair,
          price_at_event,
          price_at_plus_60m,
          price_at_plus_90m,
          window_minutes
        FROM event_price_reactions
        WHERE price_at_plus_90m IS NOT NULL AND price_at_plus_90m > 0
        LIMIT 3
      `,
      format: "JSONEachRow",
    });
    const samples = (await sample.json()) as {
      event_id: string;
      pair: string;
      price_at_event: string;
      price_at_plus_60m: string;
      price_at_plus_90m: string;
      window_minutes: number;
    }[];
    for (const s of samples) {
      console.log(`    ${s.event_id} (${s.pair}):`);
      console.log(`      T+0: ${s.price_at_event}, T+60: ${s.price_at_plus_60m}, T+90: ${s.price_at_plus_90m}, window: ${s.window_minutes}min`);
    }

    // Cleanup
    console.log("\n  Dropping backup table...");
    await clickhouse.command({
      query: "DROP TABLE IF EXISTS event_price_reactions_backup",
    });
    console.log("  ✓ Cleanup complete");

    console.log("\n" + "=".repeat(60));
    console.log("Settlement Price Extraction Complete!");
    console.log("=".repeat(60));
    console.log(`
Next steps:
1. Verify data in UI shows correct T+60/T+90 prices
2. Run cleanup-timescale-historical.ts to remove old data from TimescaleDB
`);

  } catch (error) {
    console.error("\n❌ Extraction failed:", error);
    throw error;
  } finally {
    await clickhouse.close();
  }
}

main().catch(console.error);
