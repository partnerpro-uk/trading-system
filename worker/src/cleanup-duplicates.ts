/**
 * Cleanup duplicate news events caused by timezone bug
 *
 * Run: npx tsx src/cleanup-duplicates.ts
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

// Load env
config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

async function main() {
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("Connected to TimescaleDB");

    // Find duplicate events (same name, currency, date but different times)
    const duplicates = await pool.query(`
      SELECT
        name,
        currency,
        DATE(timestamp) as event_date,
        COUNT(*) as count,
        ARRAY_AGG(event_id ORDER BY timestamp) as event_ids,
        ARRAY_AGG(timestamp ORDER BY timestamp) as timestamps
      FROM news_events
      WHERE timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY name, currency, DATE(timestamp)
      HAVING COUNT(*) > 1
      ORDER BY event_date DESC, name
    `);

    console.log(`\nFound ${duplicates.rows.length} potential duplicate groups:\n`);

    for (const row of duplicates.rows) {
      console.log(`${row.name} (${row.currency}) on ${row.event_date.toISOString().split('T')[0]}:`);
      console.log(`  Count: ${row.count}`);
      console.log(`  Event IDs: ${row.event_ids.join(', ')}`);
      console.log(`  Timestamps: ${row.timestamps.map((t: Date) => t.toISOString()).join(', ')}`);
      console.log();
    }

    // Option 1: Delete all events from affected days and let scraper refill
    const affectedDates = [...new Set(duplicates.rows.map(r => r.event_date.toISOString().split('T')[0]))];

    if (affectedDates.length > 0) {
      console.log(`\nAffected dates: ${affectedDates.join(', ')}`);
      console.log("\nTo clean up, run the following SQL:");
      console.log("----------------------------------------");

      for (const date of affectedDates) {
        console.log(`DELETE FROM news_events WHERE DATE(timestamp) = '${date}';`);
      }

      console.log("----------------------------------------");
      console.log("\nOr run with --execute flag to delete automatically");

      if (process.argv.includes('--execute')) {
        console.log("\nExecuting cleanup...");
        for (const date of affectedDates) {
          const result = await pool.query(
            `DELETE FROM news_events WHERE DATE(timestamp) = $1`,
            [date]
          );
          console.log(`Deleted ${result.rowCount} events for ${date}`);
        }
        console.log("\nCleanup complete. Scraper will refill events on next run.");
      }
    } else {
      console.log("No duplicates found!");
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
