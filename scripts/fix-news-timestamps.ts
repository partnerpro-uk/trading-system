/**
 * Fix news event timestamps - subtract 5 hours
 *
 * The scraper assumed ForexFactory was showing times in EST,
 * but it was actually showing GMT. So all timestamps are 5 hours ahead.
 *
 * Example:
 * - Stored: 12:00 UTC (7:00am EST interpretation)
 * - Correct: 07:00 UTC (7:00am GMT actual)
 *
 * Run: npx tsx scripts/fix-news-timestamps.ts [--dry-run]
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;
const DRY_RUN = process.argv.includes("--dry-run");

async function fixTimestamps() {
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Check current state
    console.log("=== Current State ===\n");

    const sample = await pool.query(`
      SELECT event_id, name, currency, timestamp,
             timestamp - INTERVAL '5 hours' as corrected_timestamp
      FROM news_events
      WHERE name IN ('Unemployment Rate', 'Claimant Count Change')
        AND currency = 'GBP'
      ORDER BY timestamp DESC
      LIMIT 5
    `);

    console.log("Sample GBP events (before fix):");
    for (const row of sample.rows) {
      console.log(`  ${row.name}: ${row.timestamp} → ${row.corrected_timestamp}`);
    }

    // Count affected rows
    const count = await pool.query(`SELECT COUNT(*) as cnt FROM news_events`);
    console.log(`\nTotal events to update: ${count.rows[0].cnt}`);

    const reactionsCount = await pool.query(`SELECT COUNT(*) as cnt FROM event_price_reactions`);
    console.log(`Total reactions (event_id will need updating): ${reactionsCount.rows[0].cnt}`);

    if (DRY_RUN) {
      console.log("\n=== DRY RUN - No changes made ===");
      console.log("Run without --dry-run to apply the fix.");
      await pool.end();
      return;
    }

    console.log("\n=== Applying Fix ===\n");

    // Fix news_events timestamps
    console.log("Updating news_events timestamps (-5 hours)...");
    const updateEvents = await pool.query(`
      UPDATE news_events
      SET timestamp = timestamp - INTERVAL '5 hours'
    `);
    console.log(`  Updated ${updateEvents.rowCount} events`);

    // Update event_id in news_events (includes the time in the ID)
    console.log("\nUpdating news_events event_id (contains time)...");

    // Event IDs are like: "Unemployment_Rate_GBP_2026-01-20_12:00"
    // We need to update the time part from 12:00 to 07:00
    // This is complex because we need to recalculate the time portion

    // Instead of complex string manipulation, let's regenerate event_ids
    const regenerateEventIds = await pool.query(`
      UPDATE news_events
      SET event_id =
        regexp_replace(name, '[^a-zA-Z0-9]', '_', 'g') || '_' ||
        currency || '_' ||
        to_char(timestamp, 'YYYY-MM-DD') || '_' ||
        to_char(timestamp, 'HH24:MI')
    `);
    console.log(`  Regenerated ${regenerateEventIds.rowCount} event IDs`);

    // Now we need to update event_price_reactions to match the new event_ids
    // First, let's see what the old IDs look like
    console.log("\nUpdating event_price_reactions event_id references...");

    // The reactions table has event_id that should match news_events
    // We need to update them to match the new format
    // This is tricky because reactions reference the old event_ids

    // Let's update reactions similarly - they have the same format
    const regenerateReactionIds = await pool.query(`
      UPDATE event_price_reactions r
      SET event_id = n.event_id
      FROM news_events n
      WHERE r.event_id LIKE n.name || '_%'
        AND r.event_id LIKE '%_' || n.currency || '_%'
        AND r.event_id LIKE '%_' || to_char(n.timestamp + INTERVAL '5 hours', 'YYYY-MM-DD') || '_%'
    `);
    console.log(`  Updated ${regenerateReactionIds.rowCount} reaction event_ids`);

    // Verify fix
    console.log("\n=== Verification ===\n");

    const verifyEvents = await pool.query(`
      SELECT event_id, name, currency, timestamp
      FROM news_events
      WHERE name IN ('Unemployment Rate', 'Claimant Count Change')
        AND currency = 'GBP'
      ORDER BY timestamp DESC
      LIMIT 5
    `);

    console.log("Sample GBP events (after fix):");
    for (const row of verifyEvents.rows) {
      console.log(`  ${row.name}: ${row.timestamp} | ID: ${row.event_id}`);
    }

  } finally {
    await pool.end();
  }
}

fixTimestamps().catch(console.error);
