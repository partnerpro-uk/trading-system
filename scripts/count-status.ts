#!/usr/bin/env npx tsx
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
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("=== Reactions Count by Pair ===\n");

  let totalReactions = 0;

  for (const pair of PAIRS) {
    // Get reactions count for this pair
    const result = await client.query(api.newsQueries.getReactionsCountPerPair, { pair });
    console.log(`${pair}: ${result.reactions} reactions`);
    totalReactions += result.reactions;
  }

  console.log(`\nTotal reactions: ${totalReactions}`);
}

main().catch(console.error);
