#!/usr/bin/env npx tsx
/**
 * Calculate Price Reactions
 *
 * Processes stored candle windows to calculate price reactions
 * (spike, reversal, pattern classification) for each event.
 *
 * Usage:
 *   npx tsx scripts/calculate-all-reactions.ts
 *   npx tsx scripts/calculate-all-reactions.ts --limit 50
 *
 * Environment:
 *   NEXT_PUBLIC_CONVEX_URL - Convex deployment URL
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let limit = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log("=== Calculate Price Reactions ===\n");
  console.log(`Limit: ${limit} events\n`);

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);

  // Calculate reactions in batch
  console.log("Processing events with candle windows...");

  try {
    const result = await client.action(api.newsReactions.batchCalculateReactions, {
      limit,
    });

    console.log(`\nProcessed ${result.processed} events`);

    // Log summary per event
    for (const [eventId, eventResult] of Object.entries(result.results)) {
      console.log(`\n${eventId}:`);
      for (const [pair, pairResult] of Object.entries(
        eventResult as Record<string, any>
      )) {
        if (pairResult.success) {
          console.log(
            `  ${pair}: ${pairResult.pattern} (${pairResult.spikePips} pips ${pairResult.spikeDirection})`
          );
        } else {
          console.log(`  ${pair}: ✗ ${pairResult.error}`);
        }
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\nDone!");
}

main().catch(console.error);
