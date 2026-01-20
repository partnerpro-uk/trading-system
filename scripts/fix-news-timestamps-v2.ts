/**
 * Fix news event timestamps - subtract 5 hours from ALL timestamp fields
 *
 * The scraper assumed ForexFactory was showing times in EST,
 * but it was actually showing GMT. So all timestamps are 5 hours ahead.
 *
 * Example (UK Claimant Count):
 * - Stored: 12:00 UTC (interpreted as 7:00am EST + 5hrs = 12:00 UTC)
 * - Correct: 07:00 UTC (actual 7:00am GMT = 7:00 UTC)
 *
 * Run: npx tsx scripts/fix-news-timestamps-v2.ts [--dry-run]
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
    console.log("=== Current State (BEFORE fix) ===\n");

    const sample = await pool.query(`
      SELECT event_id, name, currency, timestamp,
             datetime_utc, datetime_new_york, datetime_london
      FROM news_events
      WHERE name IN ('Unemployment Rate', 'Claimant Count Change')
        AND currency = 'GBP'
      ORDER BY timestamp DESC
      LIMIT 3
    `);

    console.log("Sample GBP events (before fix):");
    for (const row of sample.rows) {
      console.log(`  ${row.name}:`);
      console.log(`    timestamp: ${row.timestamp}`);
      console.log(`    datetime_utc: ${row.datetime_utc}`);
      console.log(`    datetime_new_york: ${row.datetime_new_york}`);
      console.log(`    datetime_london: ${row.datetime_london}`);
    }

    // Count affected rows
    const count = await pool.query(`SELECT COUNT(*) as cnt FROM news_events`);
    console.log(`\nTotal events to update: ${count.rows[0].cnt}`);

    if (DRY_RUN) {
      // Show what the fix would look like
      const preview = await pool.query(`
        SELECT
          name, currency,
          timestamp as old_timestamp,
          timestamp - INTERVAL '5 hours' as new_timestamp,
          datetime_utc as old_datetime_utc,
          datetime_london as old_datetime_london
        FROM news_events
        WHERE name IN ('Unemployment Rate', 'Claimant Count Change')
          AND currency = 'GBP'
        ORDER BY timestamp DESC
        LIMIT 3
      `);

      console.log("\n=== Preview of changes (DRY RUN) ===");
      for (const row of preview.rows) {
        console.log(`  ${row.name}:`);
        console.log(`    old timestamp: ${row.old_timestamp} -> new: ${row.new_timestamp}`);
      }

      console.log("\nRun without --dry-run to apply the fix.");
      await pool.end();
      return;
    }

    console.log("\n=== Applying Fix ===\n");

    // Fix the main timestamp column (subtract 5 hours)
    console.log("1. Updating timestamp column (-5 hours)...");
    const updateTimestamp = await pool.query(`
      UPDATE news_events
      SET timestamp = timestamp - INTERVAL '5 hours'
    `);
    console.log(`   Updated ${updateTimestamp.rowCount} events`);

    // Fix datetime_utc (subtract 5 hours from the time)
    console.log("2. Updating datetime_utc (-5 hours)...");
    await pool.query(`
      UPDATE news_events
      SET datetime_utc = to_char(
        to_timestamp(datetime_utc, 'YYYY-MM-DD HH24:MI:SS') - INTERVAL '5 hours',
        'YYYY-MM-DD HH24:MI:SS'
      )
      WHERE datetime_utc IS NOT NULL
    `);

    // Fix datetime_london (should match UTC for UK events in winter, or UTC+1 in summer)
    // For simplicity, we'll set it equal to datetime_utc (GMT = UTC)
    console.log("3. Updating datetime_london (set to corrected UTC)...");
    await pool.query(`
      UPDATE news_events
      SET datetime_london = datetime_utc
      WHERE datetime_london IS NOT NULL
    `);

    // Fix datetime_new_york (UTC - 5 hours in winter, UTC - 4 in summer)
    // For simplicity, use UTC - 5 hours (EST)
    console.log("4. Updating datetime_new_york (UTC - 5 hours)...");
    await pool.query(`
      UPDATE news_events
      SET datetime_new_york = to_char(
        to_timestamp(datetime_utc, 'YYYY-MM-DD HH24:MI:SS') - INTERVAL '5 hours',
        'YYYY-MM-DD HH24:MI:SS'
      )
      WHERE datetime_new_york IS NOT NULL
    `);

    // Regenerate event_id to match the new timestamp
    console.log("5. Regenerating event_id with new timestamps...");
    const regenerateEventIds = await pool.query(`
      UPDATE news_events
      SET event_id =
        regexp_replace(name, '[^a-zA-Z0-9]', '_', 'g') || '_' ||
        currency || '_' ||
        to_char(timestamp, 'YYYY-MM-DD') || '_' ||
        to_char(timestamp, 'HH24:MI')
    `);
    console.log(`   Regenerated ${regenerateEventIds.rowCount} event IDs`);

    // Verify fix
    console.log("\n=== Verification (AFTER fix) ===\n");

    const verifyEvents = await pool.query(`
      SELECT event_id, name, currency, timestamp,
             datetime_utc, datetime_new_york, datetime_london
      FROM news_events
      WHERE name IN ('Unemployment Rate', 'Claimant Count Change')
        AND currency = 'GBP'
      ORDER BY timestamp DESC
      LIMIT 3
    `);

    console.log("Sample GBP events (after fix):");
    for (const row of verifyEvents.rows) {
      console.log(`  ${row.name}:`);
      console.log(`    event_id: ${row.event_id}`);
      console.log(`    timestamp: ${row.timestamp}`);
      console.log(`    datetime_utc: ${row.datetime_utc} (should be 07:00)`);
      console.log(`    datetime_london: ${row.datetime_london} (should be 07:00)`);
      console.log(`    datetime_new_york: ${row.datetime_new_york} (should be 02:00)`);
    }

    console.log("\n=== Fix Complete ===");

  } finally {
    await pool.end();
  }
}

fixTimestamps().catch(console.error);
