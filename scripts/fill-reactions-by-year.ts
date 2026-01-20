#!/usr/bin/env npx tsx
/**
 * Fill Missing Reactions by Year
 *
 * Processes windows year by year to avoid memory limits.
 *
 * Usage:
 *   npx tsx scripts/fill-reactions-by-year.ts
 *   npx tsx scripts/fill-reactions-by-year.ts --pair EUR_USD
 *   npx tsx scripts/fill-reactions-by-year.ts --year 2015
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

const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

async function main() {
  const args = process.argv.slice(2);
  let pairFilter: string | null = null;
  let yearFilter: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pair" && args[i + 1]) {
      pairFilter = args[i + 1];
      i++;
    } else if (args[i] === "--year" && args[i + 1]) {
      yearFilter = parseInt(args[i + 1], 10);
      i++;
    }
  }

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) throw new Error("NEXT_PUBLIC_CONVEX_URL not set");

  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("=== Fill Missing Reactions by Year ===\n");
  console.log(`Pair filter: ${pairFilter || "all pairs"}`);
  console.log(`Year filter: ${yearFilter || "all years (2015-2026)"}\n`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  const pairsToProcess = pairFilter ? [pairFilter] : PAIRS;
  const yearsToProcess = yearFilter ? [yearFilter] : YEARS;

  for (const pair of pairsToProcess) {
    console.log(`\n=== ${pair} ===`);

    for (const year of yearsToProcess) {
      try {
        const result = await client.action(api.newsReactions.fillMissingReactionsForPairYear, {
          pair,
          year,
          limit: 200,
        });

        if (result.processed > 0 || result.checkedCount > 0) {
          console.log(
            `  ${year}: checked ${result.checkedCount}, processed ${result.processed}, ` +
            `success ${result.success}, errors ${result.errors}`
          );

          totalProcessed += result.processed;
          totalSuccess += result.success;
          totalErrors += result.errors;
        }
      } catch (error) {
        console.error(`  ${year}: Error - ${error}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total success: ${totalSuccess}`);
  console.log(`Total errors: ${totalErrors}`);
  console.log("\nDone!");
}

main().catch(console.error);
