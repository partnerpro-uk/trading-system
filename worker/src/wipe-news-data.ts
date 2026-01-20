/**
 * Wipe all news-related data due to timezone bug
 *
 * This removes:
 * - TimescaleDB: news_events, event_price_reactions
 * - ClickHouse: news_events, event_price_reactions, event_type_statistics, event_candle_windows
 *
 * Keeps:
 * - Candles (price data is correct)
 * - Session levels (derived from candles)
 * - Reference data (event_definitions, speaker_definitions, etc.)
 *
 * Run: npx tsx src/wipe-news-data.ts
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { createClient } from "@clickhouse/client";
import { resolve } from "path";

// Load env
config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL!;

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("⚠️  DATA WIPE - This will delete ALL news data");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("\nThis will delete:");
    console.log("  TimescaleDB:");
    console.log("    - news_events (all rows)");
    console.log("    - event_price_reactions (all rows)");
    console.log("\n  ClickHouse:");
    console.log("    - news_events (all rows)");
    console.log("    - event_price_reactions (all rows)");
    console.log("    - event_type_statistics (all rows)");
    console.log("    - event_candle_windows (all rows)");
    console.log("\nThis will KEEP:");
    console.log("    - candles (price data)");
    console.log("    - session_levels");
    console.log("    - event_definitions, speaker_definitions (reference data)");
    console.log("\nRun with --confirm to execute:");
    console.log("  npx tsx src/wipe-news-data.ts --confirm");
    return;
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("🗑️  WIPING NEWS DATA");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Connect to TimescaleDB
  console.log("Connecting to TimescaleDB...");
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Wipe TimescaleDB tables
    console.log("\n[TimescaleDB] Wiping event_price_reactions...");
    const reactionsResult = await pool.query("DELETE FROM event_price_reactions");
    console.log(`  Deleted ${reactionsResult.rowCount} rows`);

    console.log("[TimescaleDB] Wiping news_events...");
    const eventsResult = await pool.query("DELETE FROM news_events");
    console.log(`  Deleted ${eventsResult.rowCount} rows`);

    console.log("[TimescaleDB] ✓ Done");
  } catch (error) {
    console.error("[TimescaleDB] Error:", error);
  } finally {
    await pool.end();
  }

  // Connect to ClickHouse
  if (CLICKHOUSE_URL) {
    console.log("\nConnecting to ClickHouse...");
    const clickhouse = createClient({
      url: CLICKHOUSE_URL,
    });

    try {
      console.log("\n[ClickHouse] Wiping event_type_statistics...");
      await clickhouse.command({ query: "TRUNCATE TABLE event_type_statistics" });
      console.log("  ✓ Truncated");

      console.log("[ClickHouse] Wiping event_candle_windows...");
      await clickhouse.command({ query: "TRUNCATE TABLE event_candle_windows" });
      console.log("  ✓ Truncated");

      console.log("[ClickHouse] Wiping event_price_reactions...");
      await clickhouse.command({ query: "TRUNCATE TABLE event_price_reactions" });
      console.log("  ✓ Truncated");

      console.log("[ClickHouse] Wiping news_events...");
      await clickhouse.command({ query: "TRUNCATE TABLE news_events" });
      console.log("  ✓ Truncated");

      console.log("[ClickHouse] ✓ Done");
    } catch (error) {
      console.error("[ClickHouse] Error:", error);
    } finally {
      await clickhouse.close();
    }
  } else {
    console.log("\n[ClickHouse] Skipped (CLICKHOUSE_URL not set)");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("✓ DATA WIPE COMPLETE");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nNext steps:");
  console.log("1. Deploy fixed scraper to Railway");
  console.log("2. Scraper will refill news_events with correct timestamps");
  console.log("3. Historical backfill can be run separately if needed");
}

main().catch(console.error);
