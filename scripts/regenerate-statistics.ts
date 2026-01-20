#!/usr/bin/env npx tsx
/**
 * Regenerate Statistics
 *
 * Recomputes all aggregated statistics for event types.
 * Run this after backfilling events and calculating reactions.
 *
 * Usage:
 *   npx tsx scripts/regenerate-statistics.ts
 *
 * Environment:
 *   NEXT_PUBLIC_CONVEX_URL - Convex deployment URL
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

async function main() {
  console.log("=== Regenerate All Statistics ===\n");

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("Regenerating statistics for all event type + pair combinations...\n");

  try {
    const result = await client.action(api.newsStatistics.regenerateAllStatistics, {});

    console.log(`Total combinations: ${result.total}`);
    console.log(`Processed successfully: ${result.processed}`);
    console.log(`Failed (insufficient data): ${result.failed}`);

    // Show sample results
    console.log("\n=== Sample Results ===");
    let shown = 0;
    for (const [key, value] of Object.entries(result.results)) {
      if (shown >= 10) break;
      const v = value as any;
      if (v.success) {
        console.log(
          `${key}: ${v.sampleSize} samples, avg ${v.avgSpikePips} pips, ${v.reversalPct}% reversal`
        );
        shown++;
      }
    }

    // Show some failures for debugging
    const failures = Object.entries(result.results).filter(
      ([, v]) => !(v as any).success
    );
    if (failures.length > 0) {
      console.log(`\n=== Sample Failures (${failures.length} total) ===`);
      for (const [key, value] of failures.slice(0, 5)) {
        console.log(`${key}: ${(value as any).error}`);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }

  console.log("\nDone!");
}

main().catch(console.error);
