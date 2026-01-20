#!/usr/bin/env npx tsx
/**
 * Export recent candles (last 30 days) from Convex to Timescale
 * - Required for continuous aggregates to work
 * - Only exports M5 data (aggregates are built from M5)
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import pg from "pg";
import { api } from "../../convex/_generated/api";

config({ path: ".env.local" });

const BATCH_SIZE = 1000;
const DAYS_TO_EXPORT = 30;

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
];

// We need M5 data to create M1 lookups for the continuous aggregates
// Since the system stores M5 as the minimum, we'll store M5 as "M5"
// and the aggregates will work from the candles table
const TIMEFRAMES = ["M5", "M15", "H1", "H4", "D"];

// Convex client
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Postgres client
const { Client } = pg;

async function main() {
  console.log("Starting candle export to Timescale Cloud...\n");

  const client = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to Timescale Cloud\n");

  // Calculate cutoff date (30 days ago)
  const cutoffDate = Date.now() - DAYS_TO_EXPORT * 24 * 60 * 60 * 1000;
  console.log(`Exporting candles since: ${new Date(cutoffDate).toISOString()}\n`);

  let grandTotal = 0;

  for (const pair of PAIRS) {
    console.log(`\n${pair}:`);

    for (const tf of TIMEFRAMES) {
      let exported = 0;
      let cursor: number | undefined = undefined;
      let hasMore = true;

      while (hasMore) {
        // Fetch batch from Convex (using getCandlesPaginated)
        const candles = await convex.query(api.candles.getCandlesPaginated, {
          pair,
          timeframe: tf,
          after: cursor,
          limit: BATCH_SIZE,
        });

        // Filter to only include recent candles
        const recentCandles = candles.filter((c: any) => c.timestamp >= cutoffDate);

        if (recentCandles.length === 0) {
          hasMore = false;
          break;
        }

        // Build batch insert query
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const c of recentCandles) {
          placeholders.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          values.push(
            new Date(c.timestamp).toISOString(),
            c.pair,
            c.timeframe,
            c.open,
            c.high,
            c.low,
            c.close,
            c.volume ?? 0,
            c.complete ?? true
          );
        }

        // Upsert to Timescale
        await client.query(
          `INSERT INTO candles (time, pair, timeframe, open, high, low, close, volume, complete)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (time, pair, timeframe) DO UPDATE SET
             open = EXCLUDED.open,
             high = EXCLUDED.high,
             low = EXCLUDED.low,
             close = EXCLUDED.close,
             volume = EXCLUDED.volume,
             complete = EXCLUDED.complete`,
          values
        );

        exported += recentCandles.length;
        cursor = candles[candles.length - 1]?.timestamp;

        console.log(`  ${tf}: +${recentCandles.length} (total: ${exported})`);

        // If we got data older than cutoff or less than batch, we're done
        if (
          candles.length < BATCH_SIZE ||
          candles.some((c: any) => c.timestamp < cutoffDate)
        ) {
          hasMore = false;
        }

        // Small delay
        await new Promise((r) => setTimeout(r, 50));
      }

      grandTotal += exported;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Export complete!`);
  console.log(`Total candles exported: ${grandTotal}`);
  console.log(`${"=".repeat(60)}\n`);

  // Verify counts
  console.log("Verifying Timescale counts...\n");
  const result = await client.query(`
    SELECT pair, timeframe, count(*) as count
    FROM candles
    GROUP BY pair, timeframe
    ORDER BY pair, timeframe
  `);

  for (const row of result.rows) {
    console.log(`  ${row.pair} ${row.timeframe}: ${row.count}`);
  }

  // Refresh continuous aggregates
  console.log("\nRefreshing continuous aggregates...");

  const aggregates = ["candles_m5", "candles_m15", "candles_h1", "candles_h4", "candles_d1"];
  for (const agg of aggregates) {
    try {
      await client.query(`CALL refresh_continuous_aggregate('${agg}', NULL, NULL)`);
      console.log(`  Refreshed: ${agg}`);
    } catch (err: any) {
      console.log(`  Skip ${agg}: ${err.message}`);
    }
  }

  await client.end();
  console.log("\nDone!");
}

main().catch(console.error);
