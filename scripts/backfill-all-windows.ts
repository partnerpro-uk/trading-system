#!/usr/bin/env npx tsx
/**
 * Full Backfill: All Event Candle Windows
 *
 * Processes ALL events (high, medium, low) with tiered window lengths.
 * Runs 7 pairs in parallel for maximum throughput.
 *
 * Tiered windows:
 *   - FOMC/ECB Press Conferences: T+90 (105 candles)
 *   - High impact: T+60 (75 candles)
 *   - Medium/Low: T+15 (30 candles)
 *   - Non-economic: Skip
 *
 * Usage:
 *   npx tsx scripts/backfill-all-windows.ts                    # All impacts
 *   npx tsx scripts/backfill-all-windows.ts --impact high      # High only
 *   npx tsx scripts/backfill-all-windows.ts --impact medium    # Medium only
 *   npx tsx scripts/backfill-all-windows.ts --limit 5000       # Limit events
 *   npx tsx scripts/backfill-all-windows.ts --from 2020 --to 2025
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// Configuration
const BATCH_SIZE = 50; // Reduced to match query limit cap
const EVENT_DELAY_MS = 100; // Small delay between events

const IMPACT_ORDER = ["high", "medium", "low"] as const;

async function main() {
  const args = process.argv.slice(2);
  let totalLimit = Infinity;
  let impactFilter: string | null = null;
  let fromYear = 2010;
  let toYear = 2027;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      totalLimit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--impact" && args[i + 1]) {
      impactFilter = args[i + 1];
      i++;
    } else if (args[i] === "--from" && args[i + 1]) {
      fromYear = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      toYear = parseInt(args[i + 1], 10);
      i++;
    }
  }

  const impacts = impactFilter ? [impactFilter] : IMPACT_ORDER;

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║           FULL BACKFILL: ALL EVENT CANDLE WINDOWS                 ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  console.log(`Configuration:`);
  console.log(`  Impact levels: ${impacts.join(", ")}`);
  console.log(`  Year range: ${fromYear}-${toYear}`);
  console.log(`  Limit: ${totalLimit === Infinity ? "unlimited" : totalLimit}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Pairs: 7 (parallel)\n`);

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Global stats
  let grandTotalProcessed = 0;
  let grandTotalWindows = 0;
  let grandTotalErrors = 0;
  const grandStartTime = Date.now();

  // Process each impact level
  for (const impact of impacts) {
    if (grandTotalProcessed >= totalLimit) break;

    console.log(`\n${"═".repeat(70)}`);
    console.log(`  PROCESSING: ${impact.toUpperCase()} IMPACT EVENTS`);
    console.log(`${"═".repeat(70)}\n`);

    let impactProcessed = 0;
    let impactWindows = 0;
    let impactErrors = 0;
    const impactStartTime = Date.now();

    // Process in batches with cursor pagination
    let cursor: number | undefined = undefined;

    while (grandTotalProcessed < totalLimit) {
      const batchLimit = Math.min(BATCH_SIZE, totalLimit - grandTotalProcessed);

      const result = await client.query(api.newsEvents.getEventsNeedingWindowsByImpact, {
        impact,
        limit: batchLimit,
        fromYear,
        toYear,
        cursor,
      });

      const events = result.events;

      if (events.length === 0) {
        if (result.hasMore) {
          // No events in this batch but more pages exist - continue with cursor
          cursor = result.nextCursor ?? undefined;
          continue;
        }
        console.log(`\n✓ No more ${impact} events need processing.`);
        break;
      }

      console.log(`\n━━━ Batch: ${events.length} ${impact} events ━━━\n`);

      for (const event of events) {
        if (grandTotalProcessed >= totalLimit) break;

        const isExtended = event.eventType === "FOMC_PRESSER" || event.eventType === "ECB_PRESSER";
        const windowType = isExtended ? "T+90" : impact === "high" ? "T+60" : "T+15";

        const eventDate = new Date(event.timestamp).toISOString().slice(0, 16);
        process.stdout.write(`[${grandTotalProcessed + 1}] ${eventDate} | ${event.eventType.slice(0, 25).padEnd(25)} | `);

        try {
          const results = await client.action(api.newsEventsActions.fetchAllWindowsForEvent, {
            eventId: event.eventId,
            eventTimestamp: event.timestamp,
            eventType: event.eventType,
            impact: event.impact,
          });

          let successes = 0;
          let errors = 0;
          for (const result of Object.values(results)) {
            if (result.success) {
              successes++;
              grandTotalWindows++;
              impactWindows++;
            } else {
              errors++;
              grandTotalErrors++;
              impactErrors++;
            }
          }

          console.log(`${successes}/7 ✓ ${windowType}`);

          grandTotalProcessed++;
          impactProcessed++;

          // Progress every 50 events
          if (grandTotalProcessed % 50 === 0) {
            const elapsed = (Date.now() - grandStartTime) / 1000;
            const rate = grandTotalProcessed / elapsed;
            const estRemaining = totalLimit === Infinity ? "∞" : Math.ceil((totalLimit - grandTotalProcessed) / rate);
            console.log(`\n  ⏱ Total: ${grandTotalProcessed} | Rate: ${rate.toFixed(1)}/s | Windows: ${grandTotalWindows} | ETA: ${estRemaining}s\n`);
          }

          await new Promise((r) => setTimeout(r, EVENT_DELAY_MS));
        } catch (error) {
          console.log(`ERROR: ${error}`);
          grandTotalErrors += 7;
          impactErrors += 7;
          grandTotalProcessed++;
          impactProcessed++;
        }
      }

      // Update cursor for next page
      if (result.hasMore && result.nextCursor) {
        cursor = result.nextCursor;
      } else {
        break; // No more pages
      }
    }

    // Impact summary
    const impactTime = (Date.now() - impactStartTime) / 1000;
    console.log(`\n  ${impact.toUpperCase()} Summary: ${impactProcessed} events, ${impactWindows} windows, ${impactErrors} errors in ${impactTime.toFixed(0)}s`);
  }

  // Final summary
  const grandTime = (Date.now() - grandStartTime) / 1000;
  console.log("\n" + "═".repeat(70));
  console.log("                        FINAL SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Events processed:     ${grandTotalProcessed.toLocaleString()}`);
  console.log(`  Windows created:      ${grandTotalWindows.toLocaleString()}`);
  console.log(`  Errors:               ${grandTotalErrors.toLocaleString()}`);
  console.log(`  Total time:           ${(grandTime / 60).toFixed(1)} minutes`);
  console.log(`  Rate:                 ${(grandTotalProcessed / grandTime).toFixed(2)} events/sec`);
  console.log(`  Est. candles stored:  ~${(grandTotalWindows * 50).toLocaleString()}`);
  console.log("═".repeat(70));
  console.log("\nDone!");
}

main().catch(console.error);
