#!/usr/bin/env npx tsx
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

async function main() {
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

  const summary = await client.query(api.newsQueries.getEventsSummary, {});

  console.log("\n=== NEWS EVENTS DATABASE SUMMARY ===\n");
  console.log(`Total events: ${summary.totalEvents}`);
  console.log(`Unique event types: ${summary.uniqueTypes}`);

  console.log("\n=== Events by Year ===");
  summary.byYear.forEach((y: any) => console.log(`  ${y.year}: ${y.count} events`));

  console.log("\n=== Events by Currency ===");
  summary.byCurrency.forEach((c: any) => console.log(`  ${c.currency}: ${c.count}`));

  console.log("\n=== Top 30 Event Types ===");
  summary.byType.slice(0, 30).forEach((t: any) => console.log(`  ${t.type}: ${t.count}`));

  console.log("\n=== All Event Types ===");
  summary.byType.forEach((t: any, i: number) => console.log(`  ${i+1}. ${t.type}: ${t.count}`));
}

main().catch(console.error);
