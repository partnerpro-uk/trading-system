#!/usr/bin/env npx tsx
/**
 * Backfill Event Candle Windows
 *
 * Fetches 1-minute candle windows from OANDA for economic events.
 * Each window covers T-15min to T+60min (75 candles).
 *
 * Usage:
 *   npx tsx scripts/backfill-event-windows.ts
 *   npx tsx scripts/backfill-event-windows.ts --limit 100
 *   npx tsx scripts/backfill-event-windows.ts --pair EUR_USD --limit 50
 *
 * Environment:
 *   OANDA_API_KEY - OANDA API key
 *   OANDA_API_URL - OANDA API URL (default: practice)
 *   NEXT_PUBLIC_CONVEX_URL - Convex deployment URL
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD"];

// OANDA rate limit: 120 requests/second
// We'll use 10/second to be safe (100ms delay)
const RATE_LIMIT_DELAY_MS = 150;

// Delay between events (6 pairs per event)
const EVENT_DELAY_MS = 1000;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let totalLimit = 100;
  let pairFilter: string | null = null;
  let fromYear = 2015;
  let toYear = 2026;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      totalLimit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--pair" && args[i + 1]) {
      pairFilter = args[i + 1];
      i++;
    } else if (args[i] === "--from" && args[i + 1]) {
      fromYear = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      toYear = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Batch size for queries (Convex has 8192 item limit)
  const BATCH_SIZE = 500;

  console.log("=== Event Candle Window Backfill ===\n");
  console.log(`Total limit: ${totalLimit} events`);
  console.log(`Year range: ${fromYear}-${toYear}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Pair filter: ${pairFilter || "all pairs"}`);
  console.log(`Pairs: ${pairFilter || PAIRS.join(", ")}\n`);

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);

  let totalProcessed = 0;
  let totalWindowsFetched = 0;
  let totalErrors = 0;
  let batchNum = 0;

  while (totalProcessed < totalLimit) {
    batchNum++;
    const batchLimit = Math.min(BATCH_SIZE, totalLimit - totalProcessed);

    console.log(`\n=== Batch ${batchNum} (fetching up to ${batchLimit} events) ===`);

    // Get events that need windows
    const events = await client.query(api.newsEvents.getEventsNeedingWindows, {
      limit: batchLimit,
      fromYear,
      toYear,
    });

    console.log(`Found ${events.length} events in this batch\n`);

    if (events.length === 0) {
      console.log("No more events need processing. Done!");
      break;
    }

    for (const event of events) {
      const eventDate = new Date(event.timestamp).toISOString();
      console.log(`\n[${totalProcessed + 1}/${totalLimit}] ${event.name}`);
      console.log(`  Type: ${event.eventType}`);
      console.log(`  Time: ${eventDate}`);
      console.log(`  Currency: ${event.currency}`);

      try {
        // Fetch windows for all pairs (or filtered pair)
        const results = await client.action(
          api.newsEventsActions.fetchAllWindowsForEvent,
          {
            eventId: event.eventId,
            eventTimestamp: event.timestamp,
          }
        );

        // Log results per pair
        const pairsToCheck = pairFilter ? [pairFilter] : PAIRS;
        for (const pair of pairsToCheck) {
          const result = results[pair];
          if (result?.success) {
            console.log(`  ${pair}: ✓ ${result.candleCount} candles`);
            totalWindowsFetched++;
          } else {
            console.log(`  ${pair}: ✗ ${result?.error || "Unknown error"}`);
            totalErrors++;
          }
        }

        totalProcessed++;

        // Delay between events
        await new Promise((resolve) => setTimeout(resolve, EVENT_DELAY_MS));
      } catch (error) {
        console.error(`  Error processing event: ${error}`);
        totalErrors++;
        totalProcessed++;
      }
    }

    // If batch returned fewer than requested, we're done
    if (events.length < batchLimit) {
      console.log("\nReached end of unprocessed events.");
      break;
    }
  }

  // Summary
  console.log("\n=== Final Summary ===");
  console.log(`Events processed: ${totalProcessed}`);
  console.log(`Windows fetched: ${totalWindowsFetched}`);
  console.log(`Errors: ${totalErrors}`);
  console.log("\nDone!");
}

main().catch(console.error);
