#!/usr/bin/env npx tsx
/**
 * Overnight Backfill: HIGH → MEDIUM → LOW
 *
 * Runs all three impact levels in sequence for overnight processing.
 * Handles the full 26M candle goal.
 *
 * Usage:
 *   npx tsx scripts/backfill-overnight.ts
 *   npx tsx scripts/backfill-overnight.ts --from 2015 --to 2026
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// Configuration
const BATCH_SIZE = 30; // Reduced to match query limit cap
const EVENT_DELAY_MS = 80; // Reduced delay for faster processing
const IMPACT_ORDER = ["high", "medium", "low"] as const;

async function main() {
  const args = process.argv.slice(2);
  let fromYear = 2015;
  let toYear = 2026;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      fromYear = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      toYear = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║           OVERNIGHT BACKFILL: ALL IMPACT LEVELS                   ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  console.log(`Configuration:`);
  console.log(`  Impact levels: HIGH → MEDIUM → LOW`);
  console.log(`  Year range: ${fromYear}-${toYear}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Started at: ${new Date().toISOString()}\n`);

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Global stats
  let grandTotalProcessed = 0;
  let grandTotalWindows = 0;
  let grandTotalErrors = 0;
  const grandStartTime = Date.now();

  // Process each impact level
  for (const impact of IMPACT_ORDER) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`  PROCESSING: ${impact.toUpperCase()} IMPACT EVENTS`);
    console.log(`  Started at: ${new Date().toISOString()}`);
    console.log(`${"═".repeat(70)}\n`);

    let impactProcessed = 0;
    let impactWindows = 0;
    let impactErrors = 0;
    const impactStartTime = Date.now();
    let cursor: number | undefined = undefined;

    while (true) {
      const result = await client.query(api.newsEvents.getEventsNeedingWindowsByImpact, {
        impact,
        limit: BATCH_SIZE,
        fromYear,
        toYear,
        cursor,
      });

      const events = result.events;

      if (events.length === 0) {
        if (result.hasMore) {
          cursor = result.nextCursor ?? undefined;
          continue;
        }
        console.log(`\n✓ Completed all ${impact} events!`);
        break;
      }

      console.log(`\n━━━ Batch: ${events.length} ${impact} events ━━━\n`);

      for (const event of events) {
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
          for (const pairResult of Object.values(results)) {
            if (pairResult.success) {
              successes++;
              grandTotalWindows++;
              impactWindows++;
            } else {
              grandTotalErrors++;
              impactErrors++;
            }
          }

          console.log(`${successes}/7 ✓ ${windowType}`);

          grandTotalProcessed++;
          impactProcessed++;

          // Progress every 100 events
          if (grandTotalProcessed % 100 === 0) {
            const elapsed = (Date.now() - grandStartTime) / 1000;
            const rate = grandTotalProcessed / elapsed;
            console.log(`\n  ⏱ Total: ${grandTotalProcessed.toLocaleString()} | Rate: ${rate.toFixed(1)}/s | Windows: ${grandTotalWindows.toLocaleString()} | Time: ${(elapsed / 60).toFixed(1)}m\n`);
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
        break;
      }
    }

    // Impact summary
    const impactTime = (Date.now() - impactStartTime) / 1000;
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  ${impact.toUpperCase()} COMPLETE:`);
    console.log(`    Events: ${impactProcessed.toLocaleString()}`);
    console.log(`    Windows: ${impactWindows.toLocaleString()}`);
    console.log(`    Errors: ${impactErrors.toLocaleString()}`);
    console.log(`    Time: ${(impactTime / 60).toFixed(1)} minutes`);
    console.log(`${"─".repeat(70)}`);
  }

  // Final summary
  const grandTime = (Date.now() - grandStartTime) / 1000;
  console.log("\n" + "═".repeat(70));
  console.log("                   OVERNIGHT BACKFILL COMPLETE");
  console.log("═".repeat(70));
  console.log(`  Finished at:          ${new Date().toISOString()}`);
  console.log(`  Events processed:     ${grandTotalProcessed.toLocaleString()}`);
  console.log(`  Windows created:      ${grandTotalWindows.toLocaleString()}`);
  console.log(`  Errors:               ${grandTotalErrors.toLocaleString()}`);
  console.log(`  Total time:           ${(grandTime / 3600).toFixed(2)} hours`);
  console.log(`  Average rate:         ${(grandTotalProcessed / grandTime).toFixed(2)} events/sec`);
  console.log(`  Est. candles stored:  ~${(grandTotalWindows * 50).toLocaleString()}`);
  console.log("═".repeat(70));
  console.log("\nDone!");
}

main().catch(console.error);
