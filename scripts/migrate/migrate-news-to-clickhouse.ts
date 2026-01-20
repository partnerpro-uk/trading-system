/**
 * Migrate Historical News Data from TimescaleDB to ClickHouse
 *
 * This script:
 * 1. Exports historical news_events (>30 days old) from TimescaleDB
 * 2. Exports all event_price_reactions from TimescaleDB
 * 3. Inserts into ClickHouse in batches
 * 4. Verifies row counts match
 *
 * Run: npx tsx scripts/migrate/migrate-news-to-clickhouse.ts
 */

import { Pool } from "pg";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const BATCH_SIZE = 10000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface NewsEvent {
  event_id: string;
  event_type: string;
  name: string;
  country: string;
  currency: string;
  timestamp: Date;
  impact: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  description: string | null;
  datetime_utc: string | null;
  datetime_new_york: string | null;
  datetime_london: string | null;
  source_tz: string | null;
  trading_session: string | null;
  window_before_minutes: number;
  window_after_minutes: number;
  raw_source: string;
}

interface PriceReaction {
  event_id: string;
  pair: string;
  price_at_minus_15m: number;
  price_at_minus_5m: number | null;
  price_at_event: number;
  spike_high: number;
  spike_low: number;
  spike_direction: string;
  spike_magnitude_pips: number;
  time_to_spike_seconds: number | null;
  price_at_plus_5m: number | null;
  price_at_plus_15m: number | null;
  price_at_plus_30m: number | null;
  price_at_plus_60m: number | null;
  pattern_type: string;
  did_reverse: boolean;
  reversal_magnitude_pips: number | null;
  final_matches_spike: boolean;
}

async function main() {
  console.log("=".repeat(60));
  console.log("News Data Migration: TimescaleDB -> ClickHouse");
  console.log("=".repeat(60));

  // Connect to TimescaleDB
  const timescalePool = new Pool({
    connectionString: process.env.TIMESCALE_URL?.replace(/[?&]sslmode=[^&]+/, ""),
    ssl: { rejectUnauthorized: false },
  });

  // Connect to ClickHouse
  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  try {
    // Test connections
    console.log("\n[1/6] Testing connections...");
    await timescalePool.query("SELECT 1");
    console.log("  ✓ TimescaleDB connected");
    await clickhouse.query({ query: "SELECT 1" });
    console.log("  ✓ ClickHouse connected");

    // Get counts from TimescaleDB
    console.log("\n[2/6] Counting source rows...");
    const cutoffDate = new Date(Date.now() - THIRTY_DAYS_MS);

    const eventsCount = await timescalePool.query(
      `SELECT COUNT(*) as count FROM news_events WHERE timestamp < $1`,
      [cutoffDate]
    );
    const historicalEventsCount = parseInt(eventsCount.rows[0].count);
    console.log(`  Historical news_events (>30 days): ${historicalEventsCount.toLocaleString()}`);

    const reactionsCount = await timescalePool.query(
      `SELECT COUNT(*) as count FROM event_price_reactions`
    );
    const totalReactionsCount = parseInt(reactionsCount.rows[0].count);
    console.log(`  event_price_reactions: ${totalReactionsCount.toLocaleString()}`);

    // Migrate news_events
    console.log("\n[3/6] Migrating historical news_events...");
    let migratedEvents = 0;
    let offset = 0;

    while (true) {
      const result = await timescalePool.query<NewsEvent>(
        `SELECT
          event_id,
          event_type,
          name,
          country,
          currency,
          timestamp,
          impact,
          actual,
          forecast,
          previous,
          description,
          datetime_utc,
          datetime_new_york,
          datetime_london,
          source_tz,
          trading_session,
          COALESCE(window_before_minutes, 15) as window_before_minutes,
          COALESCE(window_after_minutes, 15) as window_after_minutes,
          COALESCE(raw_source, 'jblanked') as raw_source
        FROM news_events
        WHERE timestamp < $1
        ORDER BY timestamp
        LIMIT $2 OFFSET $3`,
        [cutoffDate, BATCH_SIZE, offset]
      );

      if (result.rows.length === 0) break;

      // Insert into ClickHouse
      await clickhouse.insert({
        table: "news_events",
        values: result.rows.map((row) => ({
          event_id: row.event_id,
          event_type: row.event_type,
          name: row.name,
          country: row.country,
          currency: row.currency,
          timestamp: row.timestamp.toISOString().replace("T", " ").replace("Z", ""),
          impact: row.impact,
          actual: row.actual,
          forecast: row.forecast,
          previous: row.previous,
          description: row.description,
          datetime_utc: row.datetime_utc,
          datetime_new_york: row.datetime_new_york,
          datetime_london: row.datetime_london,
          source_tz: row.source_tz,
          trading_session: row.trading_session,
          window_before_minutes: row.window_before_minutes,
          window_after_minutes: row.window_after_minutes,
          raw_source: row.raw_source,
        })),
        format: "JSONEachRow",
      });

      migratedEvents += result.rows.length;
      offset += BATCH_SIZE;
      process.stdout.write(`  Migrated ${migratedEvents.toLocaleString()} / ${historicalEventsCount.toLocaleString()} events\r`);
    }
    console.log(`\n  ✓ Migrated ${migratedEvents.toLocaleString()} news_events`);

    // Migrate event_price_reactions
    console.log("\n[4/6] Migrating event_price_reactions...");
    let migratedReactions = 0;
    offset = 0;

    while (true) {
      const result = await timescalePool.query<PriceReaction>(
        `SELECT
          event_id,
          pair,
          price_at_minus_15m,
          price_at_minus_5m,
          price_at_event,
          spike_high,
          spike_low,
          spike_direction,
          spike_magnitude_pips,
          time_to_spike_seconds,
          price_at_plus_5m,
          price_at_plus_15m,
          price_at_plus_30m,
          price_at_plus_60m,
          pattern_type,
          did_reverse,
          reversal_magnitude_pips,
          final_matches_spike
        FROM event_price_reactions
        ORDER BY event_id, pair
        LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, offset]
      );

      if (result.rows.length === 0) break;

      // Insert into ClickHouse
      await clickhouse.insert({
        table: "event_price_reactions",
        values: result.rows.map((row) => ({
          event_id: row.event_id,
          pair: row.pair,
          price_at_minus_15m: row.price_at_minus_15m,
          price_at_minus_5m: row.price_at_minus_5m,
          price_at_event: row.price_at_event,
          spike_high: row.spike_high,
          spike_low: row.spike_low,
          spike_direction: row.spike_direction,
          spike_magnitude_pips: row.spike_magnitude_pips,
          time_to_spike_seconds: row.time_to_spike_seconds,
          price_at_plus_5m: row.price_at_plus_5m,
          price_at_plus_15m: row.price_at_plus_15m,
          price_at_plus_30m: row.price_at_plus_30m,
          price_at_plus_60m: row.price_at_plus_60m,
          pattern_type: row.pattern_type,
          did_reverse: row.did_reverse ? 1 : 0,
          reversal_magnitude_pips: row.reversal_magnitude_pips,
          final_matches_spike: row.final_matches_spike ? 1 : 0,
          window_minutes: 30, // Will be updated by extract-settlements script
        })),
        format: "JSONEachRow",
      });

      migratedReactions += result.rows.length;
      offset += BATCH_SIZE;
      process.stdout.write(`  Migrated ${migratedReactions.toLocaleString()} / ${totalReactionsCount.toLocaleString()} reactions\r`);
    }
    console.log(`\n  ✓ Migrated ${migratedReactions.toLocaleString()} event_price_reactions`);

    // Verify counts in ClickHouse
    console.log("\n[5/6] Verifying migration...");

    const chEventsResult = await clickhouse.query({
      query: "SELECT count() as count FROM news_events",
      format: "JSONEachRow",
    });
    const chEventsData = await chEventsResult.json() as { count: string }[];
    const chEventsCount = parseInt(chEventsData[0].count);

    const chReactionsResult = await clickhouse.query({
      query: "SELECT count() as count FROM event_price_reactions",
      format: "JSONEachRow",
    });
    const chReactionsData = await chReactionsResult.json() as { count: string }[];
    const chReactionsCount = parseInt(chReactionsData[0].count);

    console.log(`  ClickHouse news_events: ${chEventsCount.toLocaleString()}`);
    console.log(`  ClickHouse event_price_reactions: ${chReactionsCount.toLocaleString()}`);

    const eventsMatch = chEventsCount >= migratedEvents;
    const reactionsMatch = chReactionsCount >= migratedReactions;

    if (eventsMatch && reactionsMatch) {
      console.log("  ✓ Row counts verified!");
    } else {
      console.log("  ⚠ Row count mismatch - please investigate before cleanup");
    }

    // Summary
    console.log("\n[6/6] Migration Summary");
    console.log("=".repeat(60));
    console.log(`  news_events migrated:           ${migratedEvents.toLocaleString()}`);
    console.log(`  event_price_reactions migrated: ${migratedReactions.toLocaleString()}`);
    console.log("");
    console.log("  Next steps:");
    console.log("  1. Run extract-settlements-from-windows.ts to populate T+60/T+90");
    console.log("  2. Verify data integrity");
    console.log("  3. Run cleanup-timescale-historical.ts to remove old data");
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    throw error;
  } finally {
    await timescalePool.end();
    await clickhouse.close();
  }
}

main().catch(console.error);
