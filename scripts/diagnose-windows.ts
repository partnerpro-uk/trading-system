#!/usr/bin/env npx tsx
/**
 * Diagnose why getEventsNeedingWindowsByImpact returns so few events
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

async function main() {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           WINDOW BACKFILL DIAGNOSTIC                         ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 1. Test the current query
  console.log("1. Testing getEventsNeedingWindowsByImpact query...\n");
  const queryResult = await client.query(api.newsEvents.getEventsNeedingWindowsByImpact, {
    impact: "high",
    limit: 100,
    fromYear: 2010,
    toYear: 2027,
  });
  console.log(`   Query returns: ${queryResult.length} events\n`);

  // Show first few if any
  if (queryResult.length > 0) {
    console.log("   First 5 events:");
    for (const e of queryResult.slice(0, 5)) {
      const date = new Date(e.timestamp).toISOString().slice(0, 16);
      console.log(`   - ${date} | ${e.eventType} | reactionsCalculated: ${e.reactionsCalculated}`);
    }
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 2. Run a raw count diagnostic using dashboard-style approach
  // We'll sample events and check their state
  console.log("2. Sampling high-impact events to understand data state...\n");

  // Sample a batch of high impact events (we'll use the existing query without the reactionsCalculated filter)
  // We need to add a new diagnostic query for this
  console.log("   (Need to add diagnostic query to check reactionsCalculated distribution)\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 3. Check total windows in database
  console.log("3. Summary of likely issues:\n");
  console.log("   Issue A: The query filters by 'reactionsCalculated === false'");
  console.log("            If events were incorrectly marked as processed, they won't appear.\n");
  console.log("   Issue B: The query only takes (limit * 2) events before filtering by windows");
  console.log("            If all 200 sampled events have 7 windows, we get 0 results.\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("RECOMMENDATION: Remove the 'reactionsCalculated' filter from the window query.");
  console.log("Windows should be fetched regardless of reaction calculation status.\n");
}

main().catch(console.error);
