#!/usr/bin/env npx tsx
/**
 * Test Backfill: 1K High Impact Events
 *
 * Tests the candle window infrastructure with 1000 high-impact events.
 * Uses tiered windows: T+60 for high impact, T+90 for FOMC/ECB press conferences.
 *
 * Usage:
 *   npx tsx scripts/test-backfill-1k-high.ts
 *   npx tsx scripts/test-backfill-1k-high.ts --limit 100  # Test with fewer events
 *   npx tsx scripts/test-backfill-1k-high.ts --dry-run    # Show what would be processed
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// Configuration
const BATCH_SIZE = 50; // Reduced to match query limit cap
const EVENT_DELAY_MS = 100; // Delay between events (pairs run in parallel now)

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let totalLimit = 1000;
  let dryRun = false;
  let fromYear = 2010;
  let toYear = 2027;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      totalLimit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--from" && args[i + 1]) {
      fromYear = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      toYear = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║        TEST BACKFILL: 1K HIGH IMPACT EVENTS                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log(`Configuration:`);
  console.log(`  Limit: ${totalLimit} events`);
  console.log(`  Year range: ${fromYear}-${toYear}`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Dry run: ${dryRun}`);
  console.log(`  Event delay: ${EVENT_DELAY_MS}ms\n`);

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);

  // Stats
  let totalProcessed = 0;
  let totalWindowsFetched = 0;
  let totalErrors = 0;
  let extendedWindowCount = 0;
  let standardWindowCount = 0;
  const startTime = Date.now();

  // Main loop with cursor pagination
  let cursor: number | undefined = undefined;

  while (totalProcessed < totalLimit) {
    const batchLimit = Math.min(BATCH_SIZE, totalLimit - totalProcessed);

    console.log(`\n━━━ Fetching batch (up to ${batchLimit} events) ━━━`);

    // Get HIGH impact events that need windows (paginated)
    const result = await client.query(api.newsEvents.getEventsNeedingWindowsByImpact, {
      impact: "high",
      limit: batchLimit,
      fromYear,
      toYear,
      cursor,
    });

    const events = result.events;

    console.log(`Found ${events.length} high-impact events needing windows\n`);

    if (events.length === 0) {
      if (result.hasMore) {
        cursor = result.nextCursor ?? undefined;
        continue;
      }
      console.log("✓ No more high-impact events need processing. Done!");
      break;
    }

    if (dryRun) {
      // Just show what would be processed
      console.log("DRY RUN - Would process these events:\n");
      for (const event of events.slice(0, 20)) {
        const isExtended = event.eventType === "FOMC_PRESSER" ||
                          event.eventType === "ECB_PRESSER";
        const windowType = isExtended ? "T+90 (extended)" : "T+60 (high)";
        const date = new Date(event.timestamp).toISOString().slice(0, 16);
        console.log(`  ${date} | ${event.eventType.padEnd(25)} | ${windowType}`);
      }
      if (events.length > 20) {
        console.log(`  ... and ${events.length - 20} more events`);
      }
      break;
    }

    // Process each event
    for (const event of events) {
      const isExtended = event.eventType === "FOMC_PRESSER" ||
                        event.eventType === "ECB_PRESSER";
      const windowType = isExtended ? "T+90" : "T+60";
      const expectedCandles = isExtended ? 105 : 75;

      const eventDate = new Date(event.timestamp).toISOString().slice(0, 16);
      console.log(`[${totalProcessed + 1}/${totalLimit}] ${eventDate} | ${event.eventType}`);
      console.log(`  Window: ${windowType} | Expected: ~${expectedCandles} candles × 7 pairs`);

      try {
        const results = await client.action(
          api.newsEventsActions.fetchAllWindowsForEvent,
          {
            eventId: event.eventId,
            eventTimestamp: event.timestamp,
            eventType: event.eventType,
            impact: event.impact,
          }
        );

        // Count results
        let pairSuccesses = 0;
        let pairErrors = 0;
        const pairResults: string[] = [];

        for (const [pair, pairResult] of Object.entries(results)) {
          if (pairResult.success) {
            pairSuccesses++;
            pairResults.push(`${pair}:${pairResult.candleCount}`);
            totalWindowsFetched++;
          } else {
            pairErrors++;
            pairResults.push(`${pair}:ERR`);
            totalErrors++;
          }
        }

        console.log(`  Results: ${pairSuccesses}/7 pairs | ${pairResults.join(", ")}`);

        if (isExtended) {
          extendedWindowCount++;
        } else {
          standardWindowCount++;
        }

        totalProcessed++;

        // Progress update every 10 events
        if (totalProcessed % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = totalProcessed / elapsed;
          const remaining = (totalLimit - totalProcessed) / rate;
          console.log(`\n  ⏱ Progress: ${totalProcessed}/${totalLimit} | Rate: ${rate.toFixed(1)}/sec | ETA: ${Math.ceil(remaining)}s\n`);
        }

        // Delay between events
        await new Promise((resolve) => setTimeout(resolve, EVENT_DELAY_MS));
      } catch (error) {
        console.error(`  ✗ Error: ${error}`);
        totalErrors++;
        totalProcessed++;
      }
    }

    // Update cursor for next page
    if (result.hasMore && result.nextCursor) {
      cursor = result.nextCursor;
    } else {
      console.log("\n✓ Reached end of unprocessed high-impact events.");
      break;
    }
  }

  // Final summary
  const totalTime = (Date.now() - startTime) / 1000;
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     SUMMARY                                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  Events processed:     ${totalProcessed}`);
  console.log(`  Windows fetched:      ${totalWindowsFetched}`);
  console.log(`  Extended (T+90):      ${extendedWindowCount}`);
  console.log(`  Standard (T+60):      ${standardWindowCount}`);
  console.log(`  Errors:               ${totalErrors}`);
  console.log(`  Total time:           ${totalTime.toFixed(1)}s`);
  console.log(`  Rate:                 ${(totalProcessed / totalTime).toFixed(2)} events/sec`);
  console.log(`  Avg per event:        ${(totalTime / totalProcessed).toFixed(2)}s`);
  console.log("\nDone!");
}

main().catch(console.error);
