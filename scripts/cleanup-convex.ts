#!/usr/bin/env npx tsx
/**
 * Cleanup Convex - Delete migrated data
 *
 * This script deletes data that has been migrated to Timescale/ClickHouse:
 * - candles (→ ClickHouse)
 * - sessions (→ Timescale)
 * - economicEvents (→ Timescale)
 * - eventPriceReactions (→ Timescale)
 * - eventCandleWindows (→ ClickHouse)
 * - eventTypeStatistics (can regenerate)
 *
 * Run with: npx convex run cleanup:deleteAll
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";

config({ path: ".env.local" });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;

async function main() {
  console.log("═".repeat(60));
  console.log("  CONVEX CLEANUP");
  console.log("═".repeat(60));
  console.log();
  console.log(`Target: ${CONVEX_URL}`);
  console.log();

  console.log("To clean up Convex, you have two options:\n");

  console.log("OPTION 1: Switch to production (recommended)");
  console.log("-".repeat(50));
  console.log("1. Update .env.local to use production:");
  console.log(`   CONVEX_DEPLOYMENT=prod:quick-caribou-128`);
  console.log(`   NEXT_PUBLIC_CONVEX_URL=https://quick-caribou-128.convex.cloud`);
  console.log();
  console.log("2. Deploy schema to production:");
  console.log(`   npx convex deploy`);
  console.log();
  console.log("3. The dev deployment will keep old data but won't be used.");
  console.log();

  console.log("OPTION 2: Clear dev deployment via dashboard");
  console.log("-".repeat(50));
  console.log("1. Go to https://dashboard.convex.dev");
  console.log("2. Select 'befitting-zebra-214' (dev)");
  console.log("3. Go to Data tab");
  console.log("4. For each table, select all and delete:");
  console.log("   - candles");
  console.log("   - sessions");
  console.log("   - economicEvents");
  console.log("   - eventPriceReactions");
  console.log("   - eventCandleWindows");
  console.log("   - eventTypeStatistics");
  console.log();

  console.log("OPTION 3: Programmatic deletion (slow, use for small data)");
  console.log("-".repeat(50));
  console.log("Create a convex mutation to delete in batches.\n");

  // Show what we'd be deleting
  const client = new ConvexHttpClient(CONVEX_URL);

  console.log("Current data counts (approximate):");
  console.log("-".repeat(50));

  // Note: This would require queries to be defined in Convex
  // For now, just provide manual instructions

  console.log("\nRecommendation: Switch to production (quick-caribou-128)");
  console.log("This gives you a fresh start and keeps dev as backup.\n");
}

main().catch(console.error);
