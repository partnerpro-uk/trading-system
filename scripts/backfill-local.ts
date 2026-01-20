#!/usr/bin/env npx tsx
/**
 * Local Backfill: Fetch OANDA candles locally with high parallelism
 *
 * This script:
 * 1. Reads events from local data/events.jsonl
 * 2. Fetches candle windows from OANDA directly (bypasses Convex limits)
 * 3. Saves to data/candle-windows.jsonl (resumable checkpoint)
 * 4. Uploads to Convex in batches
 *
 * Usage:
 *   npx tsx scripts/backfill-local.ts                    # Full run
 *   npx tsx scripts/backfill-local.ts --fetch-only       # Only fetch, no upload
 *   npx tsx scripts/backfill-local.ts --upload-only      # Only upload existing JSONL
 *   npx tsx scripts/backfill-local.ts --parallel 20      # Set parallelism (default 15)
 *   npx tsx scripts/backfill-local.ts --impact high      # Only process specific impact
 *   npx tsx scripts/backfill-local.ts --from 2020        # Start year
 *   npx tsx scripts/backfill-local.ts --limit 1000       # Limit events
 */

import { config } from "dotenv";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "fs";
import { createInterface } from "readline";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const PAIRS = ["EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD", "USD_CAD", "NZD_USD"] as const;
const OANDA_DELAY_MS = 35; // Balance between speed and rate limits

const EVENTS_FILE = "data/events.jsonl";
const WINDOWS_FILE = "data/candle-windows.jsonl";
const PROGRESS_FILE = "data/backfill-progress.json";

// Extended window events get T+90
const EXTENDED_WINDOW_EVENTS = ["FOMC_PRESSER", "ECB_PRESSER"];

function getWindowMinutes(eventType: string, impact: string): number {
  if (EXTENDED_WINDOW_EVENTS.includes(eventType)) return 90;
  if (impact === "high") return 60;
  return 15;
}

// Map event names to eventType (simplified version of what Convex does)
function deriveEventType(eventName: string): string {
  const name = eventName.toLowerCase();
  if (name.includes("fomc") && name.includes("press")) return "FOMC_PRESSER";
  if (name.includes("ecb") && name.includes("press")) return "ECB_PRESSER";
  if (name.includes("fomc")) return "FOMC";
  if (name.includes("non-farm") || name.includes("nonfarm")) return "NFP";
  if (name.includes("cpi")) return "CPI";
  if (name.includes("gdp")) return "GDP";
  if (name.includes("pmi")) return "PMI";
  return eventName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase().slice(0, 30);
}

// ═══════════════════════════════════════════════════════════════════════════
// OANDA FETCH
// ═══════════════════════════════════════════════════════════════════════════

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

async function fetchOandaWindow(
  pair: string,
  eventTimestamp: number,
  windowMinutes: number,
  retries = 3
): Promise<{ success: boolean; candles?: Candle[]; error?: string }> {
  const apiKey = process.env.OANDA_API_KEY;
  const apiUrl = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";

  if (!apiKey) {
    return { success: false, error: "OANDA_API_KEY not set" };
  }

  const windowStart = eventTimestamp - 15 * 60 * 1000; // T-15
  const windowEnd = eventTimestamp + windowMinutes * 60 * 1000;

  const params = new URLSearchParams({
    granularity: "M1",
    from: new Date(windowStart).toISOString(),
    to: new Date(windowEnd).toISOString(),
    price: "M",
  });

  try {
    const response = await fetch(`${apiUrl}/v3/instruments/${pair}/candles?${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      // Retry on rate limit (429) or server errors (5xx)
      if ((response.status === 429 || response.status >= 500) && retries > 0) {
        await new Promise((r) => setTimeout(r, 1000 * (4 - retries))); // Exponential backoff
        return fetchOandaWindow(pair, eventTimestamp, windowMinutes, retries - 1);
      }
      return { success: false, error: `${response.status}: ${text.slice(0, 100)}` };
    }

    const data = await response.json();

    if (!data.candles || data.candles.length === 0) {
      return { success: false, error: "No candles returned" };
    }

    const candles: Candle[] = data.candles.map((c: any) => ({
      timestamp: new Date(c.time).getTime(),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume,
    }));

    return { success: true, candles };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVEX HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function fetchCompletedEventsFromConvex(): Promise<Set<string>> {
  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) return new Set();

  const client = new ConvexHttpClient(CONVEX_URL);
  const completed = new Set<string>();

  console.log("Fetching completed events from Convex...");

  // Paginate through all events with windowsComplete = true
  let cursor: string | null = null;
  let totalFetched = 0;

  while (true) {
    try {
      const result = await client.query(api.newsEvents.getCompletedEventIds, {
        cursor,
        limit: 1000,
      });

      for (const eventId of result.eventIds) {
        completed.add(eventId);
      }

      totalFetched += result.eventIds.length;
      process.stdout.write(`\r  Fetched ${totalFetched} completed event IDs from Convex...`);

      if (!result.hasMore) break;
      cursor = result.nextCursor;
    } catch (err) {
      console.log(`\n  Warning: Could not fetch from Convex: ${err}`);
      break;
    }
  }

  console.log(`\n  Found ${completed.size} events already complete in Convex\n`);
  return completed;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN LOGIC
// ═══════════════════════════════════════════════════════════════════════════

interface RawEvent {
  event_id: string;
  timestamp_utc: number;
  currency: string;
  impact: string;
  event: string;
  day_of_week: string;
  status: string;
}

interface WindowRecord {
  eventId: string;
  pair: string;
  eventTimestamp: number;
  windowStart: number;
  windowEnd: number;
  candles: Candle[];
}

async function loadProcessedEventPairs(): Promise<Set<string>> {
  const processed = new Set<string>();

  if (!existsSync(WINDOWS_FILE)) return processed;

  const rl = createInterface({
    input: createReadStream(WINDOWS_FILE),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record: WindowRecord = JSON.parse(line);
      processed.add(`${record.eventId}:${record.pair}`);
    } catch {
      // Skip malformed lines
    }
  }

  return processed;
}

async function loadEvents(options: {
  impactFilter?: string;
  fromYear?: number;
  toYear?: number;
  limit?: number;
}): Promise<RawEvent[]> {
  const events: RawEvent[] = [];

  const rl = createInterface({
    input: createReadStream(EVENTS_FILE),
    crlfDelay: Infinity,
  });

  const fromTs = options.fromYear ? new Date(`${options.fromYear}-01-01`).getTime() : 0;
  const toTs = options.toYear ? new Date(`${options.toYear + 1}-01-01`).getTime() : Infinity;

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (options.limit && events.length >= options.limit) break;

    try {
      const raw = JSON.parse(line);

      // Filter out weekends
      if (raw.day_of_week === "Sat" || raw.day_of_week === "Sun") continue;

      // Filter out non_economic
      if (raw.impact === "non_economic") continue;

      // Filter by impact
      if (options.impactFilter && raw.impact !== options.impactFilter) continue;

      // Filter by year
      if (raw.timestamp_utc < fromTs || raw.timestamp_utc >= toTs) continue;

      events.push({
        event_id: raw.event_id,
        timestamp_utc: raw.timestamp_utc,
        currency: raw.currency,
        impact: raw.impact,
        event: raw.event,
        day_of_week: raw.day_of_week,
        status: raw.status,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

async function fetchWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  delayMs = OANDA_DELAY_MS
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
      // Small delay to avoid rate limiting
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let fetchOnly = false;
  let uploadOnly = false;
  let parallel = 18;
  let impactFilter: string | undefined;
  let fromYear: number | undefined;
  let toYear: number | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fetch-only") fetchOnly = true;
    else if (args[i] === "--upload-only") uploadOnly = true;
    else if (args[i] === "--parallel" && args[i + 1]) parallel = parseInt(args[++i], 10);
    else if (args[i] === "--impact" && args[i + 1]) impactFilter = args[++i];
    else if (args[i] === "--from" && args[i + 1]) fromYear = parseInt(args[++i], 10);
    else if (args[i] === "--to" && args[i + 1]) toYear = parseInt(args[++i], 10);
    else if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
  }

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║              LOCAL BACKFILL: OANDA → JSONL → CONVEX              ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  console.log("Configuration:");
  console.log(`  Parallelism:    ${parallel}`);
  console.log(`  Impact filter:  ${impactFilter || "all"}`);
  console.log(`  Year range:     ${fromYear || 2007}-${toYear || 2026}`);
  console.log(`  Limit:          ${limit || "none"}`);
  console.log(`  Mode:           ${fetchOnly ? "fetch-only" : uploadOnly ? "upload-only" : "full"}\n`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: FETCH FROM OANDA
  // ─────────────────────────────────────────────────────────────────────────

  if (!uploadOnly) {
    console.log("━━━ STEP 1: Fetch candles from OANDA ━━━\n");

    // Load already processed locally
    const processedLocally = await loadProcessedEventPairs();
    console.log(`Already have ${processedLocally.size} event-pair windows locally`);

    // Load completed events from Convex (skip entire events that are done)
    const completedInConvex = await fetchCompletedEventsFromConvex();

    // Load events
    const events = await loadEvents({ impactFilter, fromYear, toYear, limit });
    console.log(`Loaded ${events.length} events from ${EVENTS_FILE}\n`);

    if (events.length === 0) {
      console.log("No events to process. Done!");
      return;
    }

    // Build work items (event + pair combinations)
    // Skip events already complete in Convex (all 7 pairs done)
    const workItems: { event: RawEvent; pair: string }[] = [];
    let skippedConvex = 0;
    for (const event of events) {
      // Skip if already complete in Convex
      if (completedInConvex.has(event.event_id)) {
        skippedConvex++;
        continue;
      }
      for (const pair of PAIRS) {
        const key = `${event.event_id}:${pair}`;
        if (!processedLocally.has(key)) {
          workItems.push({ event, pair });
        }
      }
    }

    console.log(`Skipped ${skippedConvex} events already complete in Convex`);
    console.log(`Need to fetch ${workItems.length} windows\n`);

    if (workItems.length === 0) {
      console.log("All windows already fetched!");
    } else {
      // Open output file for appending
      const outStream = createWriteStream(WINDOWS_FILE, { flags: "a" });

      let fetched = 0;
      let errors = 0;
      const startTime = Date.now();

      // Process with concurrency
      await fetchWithConcurrency(workItems, parallel, async ({ event, pair }) => {
        const eventType = deriveEventType(event.event);
        const windowMinutes = getWindowMinutes(eventType, event.impact);

        const result = await fetchOandaWindow(pair, event.timestamp_utc, windowMinutes);

        if (result.success && result.candles) {
          const record: WindowRecord = {
            eventId: event.event_id,
            pair,
            eventTimestamp: event.timestamp_utc,
            windowStart: event.timestamp_utc - 15 * 60 * 1000,
            windowEnd: event.timestamp_utc + windowMinutes * 60 * 1000,
            candles: result.candles,
          };
          outStream.write(JSON.stringify(record) + "\n");
          fetched++;
        } else {
          errors++;
          // Log first few errors to diagnose
          if (errors <= 5) {
            console.log(`\n  ERROR ${errors}: ${pair} @ ${new Date(event.timestamp_utc).toISOString()} - ${result.error}`);
          }
        }

        // Progress every 100
        const total = fetched + errors;
        if (total % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = total / elapsed;
          const remaining = workItems.length - total;
          const eta = remaining / rate / 60;
          process.stdout.write(
            `\r  Progress: ${total}/${workItems.length} | ${fetched} OK, ${errors} ERR | ${rate.toFixed(1)}/s | ETA: ${eta.toFixed(1)}m   `
          );
        }
      });

      outStream.end();

      const totalTime = (Date.now() - startTime) / 1000;
      console.log(`\n\n  Fetched: ${fetched} windows`);
      console.log(`  Errors:  ${errors}`);
      console.log(`  Time:    ${(totalTime / 60).toFixed(1)} minutes`);
      console.log(`  Rate:    ${((fetched + errors) / totalTime).toFixed(1)} windows/sec\n`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: UPLOAD TO CONVEX
  // ─────────────────────────────────────────────────────────────────────────

  if (!fetchOnly) {
    console.log("━━━ STEP 2: Upload to Convex ━━━\n");

    if (!existsSync(WINDOWS_FILE)) {
      console.log("No windows file found. Run fetch first.");
      return;
    }

    const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!CONVEX_URL) {
      console.log("NEXT_PUBLIC_CONVEX_URL not set");
      return;
    }

    const client = new ConvexHttpClient(CONVEX_URL);

    // Count lines
    const rl = createInterface({
      input: createReadStream(WINDOWS_FILE),
      crlfDelay: Infinity,
    });

    let totalLines = 0;
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    const startTime = Date.now();

    for await (const line of rl) {
      if (!line.trim()) continue;
      totalLines++;

      try {
        const record: WindowRecord = JSON.parse(line);

        await client.mutation(api.newsEvents.uploadEventCandleWindow, {
          eventId: record.eventId,
          pair: record.pair,
          eventTimestamp: record.eventTimestamp,
          windowStart: record.windowStart,
          windowEnd: record.windowEnd,
          candles: record.candles,
        });

        uploaded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("already exists") || msg.includes("Duplicate")) {
          skipped++;
        } else {
          errors++;
        }
      }

      // Progress every 100
      if ((uploaded + skipped + errors) % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (uploaded + skipped + errors) / elapsed;
        process.stdout.write(
          `\r  Progress: ${uploaded + skipped + errors}/${totalLines} | ${uploaded} new, ${skipped} skip, ${errors} err | ${rate.toFixed(1)}/s   `
        );
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`\n\n  Uploaded: ${uploaded}`);
    console.log(`  Skipped:  ${skipped}`);
    console.log(`  Errors:   ${errors}`);
    console.log(`  Time:     ${(totalTime / 60).toFixed(1)} minutes\n`);
  }

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("                            DONE!");
  console.log("═══════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
