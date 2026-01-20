#!/usr/bin/env npx tsx
/**
 * Import Economic Events from ForexFactory Scraper JSONL
 *
 * Reads JSONL output from the Python scraper and uploads to Convex.
 * Supports incremental imports with smart upsert (only updates if scraped_at is newer).
 *
 * Usage:
 *   npx tsx scripts/import-events-jsonl.ts path/to/forex_factory_catalog.jsonl
 *   npx tsx scripts/import-events-jsonl.ts path/to/forex_factory_catalog.jsonl --dry-run
 *   npx tsx scripts/import-events-jsonl.ts path/to/forex_factory_catalog.jsonl --batch-size 100
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import * as fs from "fs";
import * as readline from "readline";

config({ path: ".env.local" });

interface ScraperEvent {
  event_id: string;
  status: string;
  timestamp_utc: number;
  scraped_at: number;
  datetime_utc: string;
  datetime_new_york: string;
  datetime_london: string;
  day_of_week: string;
  trading_session: string;
  currency: string;
  source_tz: string;
  impact: string;
  event: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  deviation: number | null;
  deviation_pct: number | null;
  outcome: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonlPath = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  let batchSize = 50;
  let concurrency = 5; // Number of parallel uploads

  // Parse batch size
  const batchArg = args.find((a) => a.startsWith("--batch-size"));
  if (batchArg) {
    const idx = args.indexOf(batchArg);
    if (args[idx + 1]) {
      batchSize = parseInt(args[idx + 1], 10);
    }
  }

  // Parse concurrency
  const concurrencyArg = args.find((a) => a.startsWith("--concurrency"));
  if (concurrencyArg) {
    const idx = args.indexOf(concurrencyArg);
    if (args[idx + 1]) {
      concurrency = parseInt(args[idx + 1], 10);
    }
  }

  if (!jsonlPath) {
    console.log("Usage: npx tsx scripts/import-events-jsonl.ts <path/to/events.jsonl> [--dry-run] [--batch-size N] [--concurrency N]");
    console.log("\nExpected JSONL format from ForexFactory scraper.");
    process.exit(1);
  }

  console.log("=== Import Economic Events from JSONL ===\n");
  console.log(`File: ${jsonlPath}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Concurrency: ${concurrency}\n`);

  // Check file exists
  if (!fs.existsSync(jsonlPath)) {
    console.error(`File not found: ${jsonlPath}`);
    process.exit(1);
  }

  // Read and parse JSONL
  const events: ScraperEvent[] = [];
  const fileStream = fs.createReadStream(jsonlPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let parseErrors = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line) as ScraperEvent;
      events.push(event);
    } catch (e) {
      parseErrors++;
      if (parseErrors <= 3) {
        console.error(`  Parse error line ${lineNum}: ${e}`);
      }
    }
  }

  console.log(`Parsed ${events.length} events (${parseErrors} parse errors)\n`);

  // Count by impact
  const impactCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const e of events) {
    impactCounts[e.impact] = (impactCounts[e.impact] || 0) + 1;
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  }

  console.log("Impact breakdown:");
  for (const [impact, count] of Object.entries(impactCounts).sort()) {
    console.log(`  ${impact}: ${count}`);
  }

  console.log("\nStatus breakdown:");
  for (const [status, count] of Object.entries(statusCounts).sort()) {
    console.log(`  ${status}: ${count}`);
  }

  if (dryRun) {
    console.log("\n=== DRY RUN - Sample Events ===\n");
    for (const event of events.slice(0, 10)) {
      console.log(`  ${event.event_id} | ${event.impact} | ${event.status} | ${event.event}`);
    }
    console.log("\nRun without --dry-run to upload.");
    return;
  }

  // Upload to Convex
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL not set");
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  console.log("\nUploading to Convex (parallel)...");

  let uploaded = 0;
  let errors = 0;
  let processed = 0;

  // Create all batches first
  const batches: ScraperEvent[][] = [];
  for (let i = 0; i < events.length; i += batchSize) {
    batches.push(events.slice(i, i + batchSize));
  }

  // Process function for a single batch
  async function processBatch(batch: ScraperEvent[]): Promise<{ uploaded: number; errors: number }> {
    try {
      const result = await client.action(api.newsEvents.uploadEvents, {
        events: batch.map((e) => ({
          event_id: e.event_id,
          status: e.status,
          timestamp_utc: e.timestamp_utc,
          scraped_at: e.scraped_at,
          day_of_week: e.day_of_week,
          trading_session: e.trading_session,
          currency: e.currency,
          impact: e.impact,
          event: e.event,
          actual: e.actual,
          forecast: e.forecast,
          previous: e.previous,
          deviation: e.deviation,
          deviation_pct: e.deviation_pct,
          outcome: e.outcome,
        })),
      });
      return { uploaded: result.uploaded, errors: 0 };
    } catch (e) {
      console.error(`  Batch error: ${e}`);
      return { uploaded: 0, errors: batch.length };
    }
  }

  // Process batches with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(processBatch));

    for (const result of results) {
      uploaded += result.uploaded;
      errors += result.errors;
    }
    processed += chunk.length * batchSize;

    // Progress every chunk
    console.log(`  Progress: ${Math.min(processed, events.length)}/${events.length} (uploaded: ${uploaded}, errors: ${errors})`);
  }

  console.log(`\n✓ Done!`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Errors: ${errors}`);
}

main().catch(console.error);
