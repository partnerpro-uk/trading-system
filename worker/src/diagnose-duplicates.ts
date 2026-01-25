/**
 * Diagnose duplicate news events across entire dataset
 *
 * Run: cd worker && npx tsx src/diagnose-duplicates.ts
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
    console.log("Connected to TimescaleDB\n");
    console.log("=".repeat(60));
    console.log("NEWS EVENTS DUPLICATE DIAGNOSIS");
    console.log("=".repeat(60));

    // 1. Total event count
    const totalResult = await pool.query(`SELECT COUNT(*) as total FROM news_events`);
    console.log(`\nTotal events in database: ${totalResult.rows[0].total}`);

    // 2. Find ALL duplicates (same name + currency + date, different times)
    const duplicatesResult = await pool.query(`
      SELECT
        name,
        currency,
        DATE(timestamp) as event_date,
        COUNT(*) as count,
        ARRAY_AGG(timestamp ORDER BY timestamp) as timestamps,
        ARRAY_AGG(event_id ORDER BY timestamp) as event_ids
      FROM news_events
      GROUP BY name, currency, DATE(timestamp)
      HAVING COUNT(*) > 1
      ORDER BY event_date DESC
    `);

    console.log(`\nDuplicate groups found: ${duplicatesResult.rows.length}`);

    if (duplicatesResult.rows.length === 0) {
      console.log("\n✓ No duplicates found! Data is clean.");
      return;
    }

    // 3. Analyze the time differences
    let timeDiffs: number[] = [];
    let sampleDuplicates: any[] = [];

    for (const row of duplicatesResult.rows) {
      const timestamps = row.timestamps as Date[];
      if (timestamps.length >= 2) {
        const diff = Math.abs(timestamps[1].getTime() - timestamps[0].getTime()) / (1000 * 60 * 60);
        timeDiffs.push(diff);

        if (sampleDuplicates.length < 10) {
          sampleDuplicates.push({
            name: row.name,
            currency: row.currency,
            date: row.event_date,
            times: timestamps.map((t: Date) => t.toISOString()),
            diff: diff.toFixed(1) + " hours"
          });
        }
      }
    }

    // 4. Group by time difference to see pattern
    const diffCounts: Record<string, number> = {};
    for (const diff of timeDiffs) {
      const rounded = Math.round(diff);
      diffCounts[rounded] = (diffCounts[rounded] || 0) + 1;
    }

    console.log("\n--- Time Difference Distribution ---");
    console.log("(How many hours apart are the duplicates?)\n");
    for (const [hours, count] of Object.entries(diffCounts).sort((a, b) => Number(b[1]) - Number(a[1]))) {
      const bar = "█".repeat(Math.min(50, Math.ceil(count / 10)));
      console.log(`${hours.padStart(3)}h: ${count.toString().padStart(5)} ${bar}`);
    }

    // 5. Show affected years
    const yearResult = await pool.query(`
      SELECT
        EXTRACT(YEAR FROM event_date) as year,
        COUNT(*) as duplicate_count
      FROM (
        SELECT
          DATE(timestamp) as event_date
        FROM news_events
        GROUP BY name, currency, DATE(timestamp)
        HAVING COUNT(*) > 1
      ) dupes
      GROUP BY EXTRACT(YEAR FROM event_date)
      ORDER BY year
    `);

    console.log("\n--- Duplicates by Year ---\n");
    for (const row of yearResult.rows) {
      console.log(`${row.year}: ${row.duplicate_count} duplicate groups`);
    }

    // 6. Sample duplicates
    console.log("\n--- Sample Duplicates (first 10) ---\n");
    for (const dup of sampleDuplicates) {
      console.log(`${dup.name} (${dup.currency}) on ${dup.date.toISOString().split('T')[0]}`);
      console.log(`  Times: ${dup.times.join(' vs ')}`);
      console.log(`  Diff: ${dup.diff}`);
      console.log();
    }

    // 7. Check if ClickHouse data is affected
    console.log("--- ClickHouse Impact ---\n");

    // Get all duplicate event_ids
    const allDuplicateIds = duplicatesResult.rows.flatMap(r => r.event_ids as string[]);
    console.log(`Total duplicate event_ids: ${allDuplicateIds.length}`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total events: ${totalResult.rows[0].total}`);
    console.log(`Duplicate groups: ${duplicatesResult.rows.length}`);
    console.log(`Total duplicate records: ${allDuplicateIds.length}`);
    console.log(`Records that should be deleted: ${allDuplicateIds.length - duplicatesResult.rows.length}`);

    const mostCommonDiff = Object.entries(diffCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
    if (mostCommonDiff) {
      console.log(`Most common time diff: ${mostCommonDiff[0]} hours (${mostCommonDiff[1]} occurrences)`);
      if (mostCommonDiff[0] === "5" || mostCommonDiff[0] === "6") {
        console.log(`  → This confirms the timezone bug (ET vs UK = ~5 hours)`);
      }
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

main();
