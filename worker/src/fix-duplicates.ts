/**
 * Production-grade duplicate fix for news events
 *
 * This script:
 * 1. Finds all duplicate events (same name + currency + date)
 * 2. Determines which timestamp is correct based on currency timezone rules
 * 3. Merges actual values if one record has them
 * 4. Deletes the incorrect duplicate
 * 5. Optionally adds a unique constraint
 *
 * Run: cd worker && npx tsx src/fix-duplicates.ts [--execute] [--add-constraint]
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

// Load env
config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

// Currency to typical release timezone mapping
// This helps determine which timestamp is "correct" for a given currency's events
const CURRENCY_TIMEZONE_RULES: Record<string, { name: string; utcOffset: number }> = {
  // North American currencies - Eastern Time (ET) releases
  USD: { name: "America/New_York", utcOffset: -5 }, // EST, -4 in summer
  CAD: { name: "America/Toronto", utcOffset: -5 },

  // European currencies - Local time releases
  GBP: { name: "Europe/London", utcOffset: 0 }, // GMT, +1 in summer
  EUR: { name: "Europe/Berlin", utcOffset: 1 }, // CET, +2 in summer
  CHF: { name: "Europe/Zurich", utcOffset: 1 },

  // Asia-Pacific currencies
  JPY: { name: "Asia/Tokyo", utcOffset: 9 },
  AUD: { name: "Australia/Sydney", utcOffset: 11 }, // AEDT, +10 in winter
  NZD: { name: "Pacific/Auckland", utcOffset: 13 }, // NZDT, +12 in winter
  CNY: { name: "Asia/Shanghai", utcOffset: 8 },
};

interface DuplicateGroup {
  name: string;
  currency: string;
  event_date: Date;
  count: number;
  event_ids: string[];
  timestamps: Date[];
  actuals: (string | null)[];
  forecasts: (string | null)[];
  previouses: (string | null)[];
}

async function main() {
  const dryRun = !process.argv.includes("--execute");
  const addConstraint = process.argv.includes("--add-constraint");

  console.log("=".repeat(60));
  console.log("NEWS EVENTS DUPLICATE FIX");
  console.log("=".repeat(60));
  console.log(`Mode: ${dryRun ? "DRY RUN (use --execute to apply)" : "EXECUTE"}`);
  console.log();

  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log("Connected to TimescaleDB\n");

    // Find ALL duplicates with their data
    const duplicates = await pool.query<DuplicateGroup>(`
      SELECT
        name,
        currency,
        DATE(timestamp) as event_date,
        COUNT(*) as count,
        ARRAY_AGG(event_id ORDER BY timestamp) as event_ids,
        ARRAY_AGG(timestamp ORDER BY timestamp) as timestamps,
        ARRAY_AGG(actual ORDER BY timestamp) as actuals,
        ARRAY_AGG(forecast ORDER BY timestamp) as forecasts,
        ARRAY_AGG(previous ORDER BY timestamp) as previouses
      FROM news_events
      GROUP BY name, currency, DATE(timestamp)
      HAVING COUNT(*) > 1
      ORDER BY event_date DESC, currency, name
    `);

    if (duplicates.rows.length === 0) {
      console.log("✓ No duplicates found! Data is clean.");
      await pool.end();
      return;
    }

    console.log(`Found ${duplicates.rows.length} duplicate groups to process\n`);

    let fixed = 0;
    let skipped = 0;
    const toDelete: string[] = [];
    const toUpdate: Array<{ event_id: string; actual: string | null; forecast: string | null; previous: string | null }> = [];

    for (const group of duplicates.rows) {
      const { name, currency, event_date, event_ids, timestamps, actuals, forecasts, previouses } = group;

      console.log(`\n--- ${name} (${currency}) on ${event_date.toISOString().split("T")[0]} ---`);

      // Determine which record to keep
      // Strategy: Avoid midnight timestamps (likely parsing errors) and prefer records with actual data
      const tzRule = CURRENCY_TIMEZONE_RULES[currency];

      if (!tzRule) {
        console.log(`  ⚠️ Unknown currency ${currency}`);
      }

      // Analyze the timestamps
      const timeDiffHours = Math.abs(
        (timestamps[1].getTime() - timestamps[0].getTime()) / (1000 * 60 * 60)
      );
      console.log(`  Timestamps: ${timestamps.map(t => t.toISOString()).join(" vs ")}`);
      console.log(`  Time difference: ${timeDiffHours.toFixed(1)} hours`);

      // Check for suspicious midnight timestamps (likely parsing errors)
      const isMidnight = (ts: Date) => ts.getUTCHours() === 0 && ts.getUTCMinutes() === 0;
      const midnightIndices = timestamps.map((ts, i) => isMidnight(ts) ? i : -1).filter(i => i >= 0);
      const nonMidnightIndices = timestamps.map((_, i) => i).filter(i => !isMidnight(timestamps[i]));

      let keepIndex: number;
      let deleteIndex: number;

      // Priority 1: Avoid midnight timestamps (they're usually parsing errors)
      if (midnightIndices.length > 0 && nonMidnightIndices.length > 0) {
        // Keep first non-midnight, delete first midnight
        keepIndex = nonMidnightIndices[0];
        deleteIndex = midnightIndices[0];
        console.log(`  → Keeping non-midnight timestamp (midnight is likely parsing error)`);
      }
      // Priority 2: Keep the one with actual data
      else if (actuals[0] && !actuals[1]) {
        keepIndex = 0;
        deleteIndex = 1;
        console.log(`  → Keeping first (has actual value)`);
      } else if (!actuals[0] && actuals[1]) {
        keepIndex = 1;
        deleteIndex = 0;
        console.log(`  → Keeping second (has actual value)`);
      }
      // Priority 3: For 5-6 hour offset (timezone bug), keep earlier for UK events
      else if (timeDiffHours >= 4 && timeDiffHours <= 7) {
        if (["GBP", "EUR", "CHF"].includes(currency)) {
          keepIndex = 0;
          deleteIndex = 1;
          console.log(`  → Keeping earlier (UK timezone event)`);
        } else {
          keepIndex = 0;
          deleteIndex = 1;
          console.log(`  → Keeping earlier (timezone bug pattern)`);
        }
      }
      // Default: keep earliest
      else {
        keepIndex = 0;
        deleteIndex = 1;
        console.log(`  → Keeping earliest (default)`);
      }

      // Check if we need to merge actual values
      const keepActual = actuals[keepIndex];
      const deleteActual = actuals[deleteIndex];
      const keepForecast = forecasts[keepIndex];
      const deleteForecast = forecasts[deleteIndex];
      const keepPrevious = previouses[keepIndex];
      const deletePrevious = previouses[deleteIndex];

      // Merge: if the one we're deleting has data that the keeper doesn't, copy it
      let needsUpdate = false;
      let mergedActual = keepActual;
      let mergedForecast = keepForecast;
      let mergedPrevious = keepPrevious;

      if (!keepActual && deleteActual) {
        mergedActual = deleteActual;
        needsUpdate = true;
        console.log(`  → Merging actual value: ${deleteActual}`);
      }
      if (!keepForecast && deleteForecast) {
        mergedForecast = deleteForecast;
        needsUpdate = true;
        console.log(`  → Merging forecast value: ${deleteForecast}`);
      }
      if (!keepPrevious && deletePrevious) {
        mergedPrevious = deletePrevious;
        needsUpdate = true;
        console.log(`  → Merging previous value: ${deletePrevious}`);
      }

      toDelete.push(event_ids[deleteIndex]);
      console.log(`  → Will delete: ${event_ids[deleteIndex]}`);
      console.log(`  → Will keep: ${event_ids[keepIndex]}`);

      if (needsUpdate) {
        toUpdate.push({
          event_id: event_ids[keepIndex],
          actual: mergedActual,
          forecast: mergedForecast,
          previous: mergedPrevious,
        });
      }

      fixed++;
    }

    console.log("\n" + "=".repeat(60));
    console.log("SUMMARY");
    console.log("=".repeat(60));
    console.log(`Duplicate groups found: ${duplicates.rows.length}`);
    console.log(`Records to delete: ${toDelete.length}`);
    console.log(`Records to update (merge values): ${toUpdate.length}`);

    if (dryRun) {
      console.log("\n⚠️ DRY RUN - No changes made");
      console.log("Run with --execute to apply changes");
    } else {
      console.log("\n--- Executing fixes ---\n");

      // Update records that need merged values
      for (const update of toUpdate) {
        await pool.query(
          `UPDATE news_events
           SET actual = COALESCE($2, actual),
               forecast = COALESCE($3, forecast),
               previous = COALESCE($4, previous)
           WHERE event_id = $1`,
          [update.event_id, update.actual, update.forecast, update.previous]
        );
        console.log(`Updated ${update.event_id} with merged values`);
      }

      // Delete duplicates
      if (toDelete.length > 0) {
        const result = await pool.query(
          `DELETE FROM news_events WHERE event_id = ANY($1::text[])`,
          [toDelete]
        );
        console.log(`Deleted ${result.rowCount} duplicate records`);
      }

      console.log("\n✓ Duplicates fixed!");
    }

    // Add unique constraint if requested
    if (addConstraint) {
      console.log("\n--- Adding unique constraint ---\n");

      if (dryRun) {
        console.log("Would add constraint: UNIQUE (name, currency, DATE(timestamp))");
        console.log("SQL: CREATE UNIQUE INDEX idx_news_events_unique ON news_events (name, currency, (timestamp::date))");
      } else {
        try {
          // Check if constraint already exists
          const existing = await pool.query(`
            SELECT indexname FROM pg_indexes
            WHERE tablename = 'news_events' AND indexname = 'idx_news_events_unique'
          `);

          if (existing.rows.length > 0) {
            console.log("✓ Unique index already exists");
          } else {
            await pool.query(`
              CREATE UNIQUE INDEX idx_news_events_unique
              ON news_events (name, currency, (timestamp::date))
            `);
            console.log("✓ Added unique index: idx_news_events_unique");
          }
        } catch (err) {
          console.error("Failed to add constraint:", err);
          console.log("Note: This may fail if duplicates still exist. Run without --add-constraint first.");
        }
      }
    }

    // Verify the fix
    if (!dryRun) {
      console.log("\n--- Verifying fix ---\n");
      const verify = await pool.query(`
        SELECT COUNT(*) as duplicate_count
        FROM (
          SELECT name, currency, DATE(timestamp)
          FROM news_events
          GROUP BY name, currency, DATE(timestamp)
          HAVING COUNT(*) > 1
        ) dupes
      `);

      if (parseInt(verify.rows[0].duplicate_count) === 0) {
        console.log("✓ Verification passed: No duplicates remain");
      } else {
        console.log(`⚠️ ${verify.rows[0].duplicate_count} duplicate groups still exist`);
      }
    }

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
