#!/usr/bin/env npx tsx
/**
 * Fill Missing Reactions
 *
 * Processes each pair separately to find and calculate missing reactions.
 * Uses pair-based pagination to ensure all windows are checked.
 *
 * Usage:
 *   npx tsx scripts/fill-missing-reactions.ts
 *   npx tsx scripts/fill-missing-reactions.ts --batch 200
 *   npx tsx scripts/fill-missing-reactions.ts --pair EUR_USD
 *
 * Environment:
 *   NEXT_PUBLIC_CONVEX_URL - Convex deployment URL
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
];

async function main() {
  const args = process.argv.slice(2);
  let batchSize = 200;
  let pairFilter: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--batch" && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--pair" && args[i + 1]) {
      pairFilter = args[i + 1];
      i++;
    }
  }

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("=== Fill Missing Reactions ===\n");
  console.log(`Batch size: ${batchSize} per call`);
  console.log(`Pair filter: ${pairFilter || "all pairs"}\n`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  const pairsToProcess = pairFilter ? [pairFilter] : PAIRS;

  for (const pair of pairsToProcess) {
    console.log(`\nProcessing ${pair}...`);

    let pairDone = false;
    let pairProcessed = 0;
    let pairSuccess = 0;
    let pairErrors = 0;

    while (!pairDone) {
      try {
        const result = await client.action(
          api.newsReactions.fillMissingReactionsForPair,
          {
            pair,
            limit: batchSize,
          }
        );

        console.log(
          `  Batch: ${result.processed} processed, ${result.success} success, ${result.errors} errors, hasMore: ${result.hasMore}`
        );

        pairProcessed += result.processed;
        pairSuccess += result.success;
        pairErrors += result.errors;
        totalProcessed += result.processed;
        totalSuccess += result.success;
        totalErrors += result.errors;

        // Use hasMore to determine if we should continue
        if (!result.hasMore) {
          pairDone = true;
        }
      } catch (error) {
        console.error(`  Error: ${error}`);
        // Continue to next pair on error
        pairDone = true;
      }
    }

    console.log(
      `  ${pair} complete: ${pairProcessed} processed, ${pairSuccess} success, ${pairErrors} errors`
    );
  }

  console.log("\n=== Summary ===");
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total success: ${totalSuccess}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log("\nDone!");
}

main().catch(console.error);
