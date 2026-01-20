#!/usr/bin/env npx tsx
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

async function main() {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  // Test a few failing windows
  const failingWindows = [
    { eventId: "Retail_Sales_q_q_2015-02-15_21:45", pair: "EUR_USD" },
    { eventId: "Final_Services_PMI_2015-10-04_20:30", pair: "EUR_USD" },
    { eventId: "Employment_Cost_Inde_2015-10-29_20:30", pair: "EUR_USD" },
  ];

  for (const w of failingWindows) {
    console.log(`\n=== ${w.eventId} / ${w.pair} ===`);
    const result = await client.query(api.newsReactions.debugWindowCandles, {
      eventId: w.eventId,
      pair: w.pair,
    });
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(console.error);
