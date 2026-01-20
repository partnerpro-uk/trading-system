#!/usr/bin/env npx tsx
/**
 * Regenerate Statistics (Batched)
 * Processes statistics in smaller batches to avoid timeouts.
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD"];

async function main() {
  console.log("=== Regenerate Statistics (Batched) ===\n");

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Get unique event types from the public query
  const eventTypes = await client.query(api.newsStatistics.getUniqueCombinationsPublic, {});
  console.log(`Found ${eventTypes.length} unique event types\n`);

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const eventType of eventTypes) {
    for (const pair of PAIRS) {
      try {
        const result = await client.action(api.newsStatistics.aggregateStatisticsPublic, {
          eventType,
          pair,
        });
        
        if (result.success) {
          processed++;
          if (result.sampleSize && result.sampleSize >= 5) {
            console.log(`${eventType}/${pair}: ${result.sampleSize} samples, ${result.avgSpikePips} avg pips`);
          }
        } else {
          skipped++;
        }
      } catch (error) {
        failed++;
      }
    }
  }

  console.log(`\nTotal: ${processed} success, ${skipped} skipped (no data), ${failed} errors`);
  console.log("Done!");
}

main().catch(console.error);
