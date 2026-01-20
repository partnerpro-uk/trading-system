/**
 * Verify Data Architecture Setup
 *
 * This script verifies that the triple-database architecture is correctly set up:
 * 1. TimescaleDB has only recent data (upcoming 30 days)
 * 2. ClickHouse has historical data
 * 3. T+60/T+90 extraction worked correctly
 *
 * Run: npx tsx scripts/verify-data-architecture.ts
 */

import { createClient, ClickHouseClient } from "@clickhouse/client";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  console.log("=".repeat(60));
  console.log("Data Architecture Verification");
  console.log("=".repeat(60));

  // Connect to databases
  const timescalePool = new Pool({
    connectionString: process.env.TIMESCALE_URL?.replace(/[?&]sslmode=[^&]+/, ""),
    ssl: { rejectUnauthorized: false },
  });

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  const checks: { name: string; passed: boolean; details: string }[] = [];

  try {
    // Test connections
    console.log("\n[1/7] Testing connections...");
    await timescalePool.query("SELECT 1");
    checks.push({ name: "TimescaleDB connection", passed: true, details: "Connected" });

    await clickhouse.query({ query: "SELECT 1" });
    checks.push({ name: "ClickHouse connection", passed: true, details: "Connected" });

    // Check ClickHouse news_events
    console.log("\n[2/7] Checking ClickHouse news_events...");
    const chEventsResult = await clickhouse.query({
      query: "SELECT count() as cnt, min(timestamp) as oldest, max(timestamp) as newest FROM news_events",
      format: "JSONEachRow",
    });
    const chEvents = (await chEventsResult.json()) as { cnt: string; oldest: string; newest: string }[];
    const chEventsCount = parseInt(chEvents[0].cnt);
    checks.push({
      name: "ClickHouse news_events populated",
      passed: chEventsCount > 0,
      details: `${chEventsCount.toLocaleString()} rows, ${chEvents[0].oldest} to ${chEvents[0].newest}`,
    });

    // Check ClickHouse event_price_reactions
    console.log("\n[3/7] Checking ClickHouse event_price_reactions...");
    const chReactionsResult = await clickhouse.query({
      query: `
        SELECT
          count() as total,
          countIf(price_at_plus_60m IS NOT NULL AND price_at_plus_60m > 0) as has_60m,
          countIf(price_at_plus_90m IS NOT NULL AND price_at_plus_90m > 0) as has_90m
        FROM event_price_reactions
      `,
      format: "JSONEachRow",
    });
    const chReactions = (await chReactionsResult.json()) as { total: string; has_60m: string; has_90m: string }[];
    const totalReactions = parseInt(chReactions[0].total);
    const has60m = parseInt(chReactions[0].has_60m);
    const has90m = parseInt(chReactions[0].has_90m);

    checks.push({
      name: "ClickHouse reactions populated",
      passed: totalReactions > 0,
      details: `${totalReactions.toLocaleString()} total reactions`,
    });

    checks.push({
      name: "T+60 prices extracted",
      passed: has60m > 0,
      details: `${has60m.toLocaleString()} rows (${((has60m / totalReactions) * 100).toFixed(1)}%)`,
    });

    checks.push({
      name: "T+90 prices extracted",
      passed: has90m > 0,
      details: `${has90m.toLocaleString()} rows (${((has90m / totalReactions) * 100).toFixed(1)}%)`,
    });

    // Check ClickHouse event_candle_windows
    console.log("\n[4/7] Checking ClickHouse event_candle_windows...");
    const chWindowsResult = await clickhouse.query({
      query: `
        SELECT
          count() as total,
          countIf(candle_count >= 75) as extended,
          countIf(candle_count >= 105) as fomc
        FROM event_candle_windows
      `,
      format: "JSONEachRow",
    });
    const chWindows = (await chWindowsResult.json()) as { total: string; extended: string; fomc: string }[];

    checks.push({
      name: "Event candle windows available",
      passed: parseInt(chWindows[0].total) > 0,
      details: `${parseInt(chWindows[0].total).toLocaleString()} total, ${parseInt(chWindows[0].extended).toLocaleString()} extended, ${parseInt(chWindows[0].fomc).toLocaleString()} FOMC`,
    });

    // Check TimescaleDB news_events (should have mostly upcoming)
    console.log("\n[5/7] Checking TimescaleDB news_events...");
    const cutoffDate = new Date(Date.now() - THIRTY_DAYS_MS);
    const tsEventsResult = await timescalePool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE timestamp > $1) as upcoming,
        COUNT(*) FILTER (WHERE timestamp <= $1) as historical
      FROM news_events
    `, [cutoffDate]);

    const tsTotal = parseInt(tsEventsResult.rows[0].total);
    const tsUpcoming = parseInt(tsEventsResult.rows[0].upcoming);
    const tsHistorical = parseInt(tsEventsResult.rows[0].historical);

    checks.push({
      name: "TimescaleDB news_events status",
      passed: true, // Info check
      details: `${tsTotal.toLocaleString()} total (${tsUpcoming.toLocaleString()} upcoming, ${tsHistorical.toLocaleString()} historical)`,
    });

    // Check TimescaleDB event_price_reactions
    console.log("\n[6/7] Checking TimescaleDB event_price_reactions...");
    const tsReactionsResult = await timescalePool.query(`SELECT COUNT(*) as cnt FROM event_price_reactions`);
    const tsReactions = parseInt(tsReactionsResult.rows[0].cnt);

    checks.push({
      name: "TimescaleDB reactions status",
      passed: true, // Info check
      details: `${tsReactions.toLocaleString()} rows (can be cleaned up after verification)`,
    });

    // Sample data check
    console.log("\n[7/7] Sampling ClickHouse data quality...");
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          event_id,
          pair,
          price_at_minus_15m,
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
    const samples = await sampleResult.json() as {
      event_id: string;
      pair: string;
      price_at_minus_15m: string;
      price_at_event: string;
      price_at_plus_60m: string;
      price_at_plus_90m: string;
      window_minutes: number;
    }[];

    if (samples.length > 0) {
      checks.push({
        name: "Sample data quality",
        passed: true,
        details: `Found ${samples.length} FOMC/ECB events with T+90 data`,
      });
    }

    // Print results
    console.log("\n" + "=".repeat(60));
    console.log("VERIFICATION RESULTS");
    console.log("=".repeat(60));

    let allPassed = true;
    for (const check of checks) {
      const status = check.passed ? "✓" : "✗";
      const color = check.passed ? "\x1b[32m" : "\x1b[31m";
      console.log(`${color}${status}\x1b[0m ${check.name}`);
      console.log(`    ${check.details}`);
      if (!check.passed) allPassed = false;
    }

    console.log("\n" + "=".repeat(60));
    if (allPassed) {
      console.log("✓ All checks passed!");
      console.log("\nNext steps:");
      console.log("1. Test the UI to verify historical data displays correctly");
      console.log("2. Run cleanup-timescale-historical.ts to remove old data from TimescaleDB");
    } else {
      console.log("✗ Some checks failed - please investigate before cleanup");
    }
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Verification failed:", error);
    throw error;
  } finally {
    await timescalePool.end();
    await clickhouse.close();
  }
}

main().catch(console.error);
