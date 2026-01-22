/**
 * Cleanup Historical Data from TimescaleDB
 *
 * IMPORTANT: Only run this AFTER:
 * 1. Running verify-data-architecture.ts (all checks must pass)
 * 2. Testing the UI to confirm historical data loads correctly
 *
 * This script:
 * 1. Deletes historical news_events (>30 days old) from TimescaleDB
 * 2. Deletes all event_price_reactions from TimescaleDB
 * 3. Runs VACUUM to reclaim disk space
 *
 * Run: npx tsx scripts/cleanup-timescale-historical.ts [--dry-run]
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const DRY_RUN = process.argv.includes("--dry-run");
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  console.log("=".repeat(60));
  console.log("TimescaleDB Historical Data Cleanup");
  console.log(DRY_RUN ? "(DRY RUN - no changes will be made)" : "(LIVE - changes will be committed)");
  console.log("=".repeat(60));

  const pool = new Pool({
    connectionString: process.env.TIMESCALE_URL?.replace(/[?&]sslmode=[^&]+/, ""),
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Get current counts
    console.log("\n[1/5] Current TimescaleDB state...");

    const cutoffDate = new Date(Date.now() - THIRTY_DAYS_MS);

    const eventsCount = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE timestamp > $1) as to_keep,
        COUNT(*) FILTER (WHERE timestamp <= $1) as to_delete
      FROM news_events
    `, [cutoffDate]);

    const totalEvents = parseInt(eventsCount.rows[0].total);
    const keepEvents = parseInt(eventsCount.rows[0].to_keep);
    const deleteEvents = parseInt(eventsCount.rows[0].to_delete);

    console.log(`  news_events: ${totalEvents.toLocaleString()} total`);
    console.log(`    - Keep (upcoming 30 days): ${keepEvents.toLocaleString()}`);
    console.log(`    - Delete (historical): ${deleteEvents.toLocaleString()}`);

    const reactionsCount = await pool.query(`SELECT COUNT(*) as cnt FROM event_price_reactions`);
    const totalReactions = parseInt(reactionsCount.rows[0].cnt);
    console.log(`  event_price_reactions: ${totalReactions.toLocaleString()} (all will be deleted)`);

    if (DRY_RUN) {
      console.log("\n[DRY RUN] Would delete:");
      console.log(`  - ${deleteEvents.toLocaleString()} historical news_events`);
      console.log(`  - ${totalReactions.toLocaleString()} event_price_reactions`);
      console.log("\nRun without --dry-run to execute cleanup.");
      await pool.end();
      return;
    }

    // Confirm
    console.log("\n⚠️  WARNING: This will permanently delete data from TimescaleDB!");
    console.log("Press Ctrl+C within 5 seconds to cancel...\n");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Delete historical news_events
    console.log("[2/5] Deleting historical news_events...");
    const deleteEventsResult = await pool.query(`
      DELETE FROM news_events WHERE timestamp <= $1
    `, [cutoffDate]);
    console.log(`  ✓ Deleted ${deleteEventsResult.rowCount?.toLocaleString()} rows`);

    // Delete all event_price_reactions
    console.log("\n[3/5] Deleting event_price_reactions...");
    const deleteReactionsResult = await pool.query(`DELETE FROM event_price_reactions`);
    console.log(`  ✓ Deleted ${deleteReactionsResult.rowCount?.toLocaleString()} rows`);

    // Verify cleanup
    console.log("\n[4/5] Verifying cleanup...");
    const verifyEvents = await pool.query(`SELECT COUNT(*) as cnt FROM news_events`);
    const verifyReactions = await pool.query(`SELECT COUNT(*) as cnt FROM event_price_reactions`);
    console.log(`  news_events remaining: ${verifyEvents.rows[0].cnt}`);
    console.log(`  event_price_reactions remaining: ${verifyReactions.rows[0].cnt}`);

    // VACUUM
    console.log("\n[5/5] Running VACUUM ANALYZE...");
    await pool.query("VACUUM ANALYZE news_events");
    await pool.query("VACUUM ANALYZE event_price_reactions");
    console.log("  ✓ VACUUM complete");

    console.log("\n" + "=".repeat(60));
    console.log("✓ Cleanup Complete!");
    console.log("=".repeat(60));
    console.log(`
Summary:
- Deleted ${deleteEvents.toLocaleString()} historical news_events
- Deleted ${totalReactions.toLocaleString()} event_price_reactions
- Kept ${keepEvents.toLocaleString()} upcoming news_events

Data is now properly split:
- TimescaleDB: Upcoming events only (30-day rolling window)
- ClickHouse: All historical data (analytics)
`);

  } catch (error) {
    console.error("\n❌ Cleanup failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
