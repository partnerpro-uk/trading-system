#!/usr/bin/env npx tsx
/**
 * Clear all news-related tables
 *
 * Tables cleared:
 * - economicEvents
 * - eventCandleWindows
 * - eventPriceReactions
 * - eventTypeStatistics
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

async function clearTable(
  client: ConvexHttpClient,
  tableName: string,
  clearFn: (client: ConvexHttpClient) => Promise<{ deleted: number; hasMore: boolean }>
) {
  let totalDeleted = 0;
  let hasMore = true;

  console.log(`\nClearing ${tableName}...`);

  while (hasMore) {
    const result = await clearFn(client);
    totalDeleted += result.deleted;
    hasMore = result.hasMore;

    if (result.deleted > 0) {
      process.stdout.write(`  Deleted ${totalDeleted} so far...\r`);
    }
  }

  console.log(`  ✓ ${tableName}: ${totalDeleted} documents deleted`);
  return totalDeleted;
}

async function main() {
  console.log("=== Clear News Tables ===\n");

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  const totals: Record<string, number> = {};

  // Clear in order: statistics, reactions, windows, events (reverse dependency order)
  totals.eventTypeStatistics = await clearTable(
    client,
    "eventTypeStatistics",
    (c) => c.mutation(api.newsEvents.clearEventTypeStatistics, {})
  );

  totals.eventPriceReactions = await clearTable(
    client,
    "eventPriceReactions",
    (c) => c.mutation(api.newsEvents.clearEventPriceReactions, {})
  );

  totals.eventCandleWindows = await clearTable(
    client,
    "eventCandleWindows",
    (c) => c.mutation(api.newsEvents.clearEventCandleWindows, {})
  );

  totals.economicEvents = await clearTable(
    client,
    "economicEvents",
    (c) => c.mutation(api.newsEvents.clearEconomicEvents, {})
  );

  console.log("\n=== Summary ===");
  for (const [table, count] of Object.entries(totals)) {
    console.log(`  ${table}: ${count} deleted`);
  }
  console.log("\n✓ All news tables cleared!");
}

main().catch(console.error);
