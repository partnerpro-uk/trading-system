#!/usr/bin/env npx tsx
/**
 * Export news data from Convex:
 * - Economic events → Timescale (news_events)
 * - Event price reactions → Timescale (event_price_reactions)
 * - Event candle windows → ClickHouse (event_candle_windows)
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@clickhouse/client";
import pg from "pg";
import { api } from "../../convex/_generated/api";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const PROGRESS_FILE = join(__dirname, "../../data/migration-progress-news.json");

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
];

// Convex client
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Postgres client
const { Client } = pg;

interface Progress {
  eventsExported: number;
  reactionsExported: number;
  windowsExported: number;
  lastEventId?: string;
  complete: boolean;
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { eventsExported: 0, reactionsExported: 0, windowsExported: 0, complete: false };
}

function saveProgress(progress: Progress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function exportEvents(pgClient: pg.Client): Promise<number> {
  console.log("\n1. Exporting economic events to Timescale...");

  // Get all events from Convex (they use collect())
  const summary = await convex.query(api.newsQueries.getEventsSummary, {});
  console.log(`   Found ${summary.totalEvents} events in Convex`);

  // Since getEventsSummary uses .collect(), we need a different approach
  // Let's use the getUpcomingEvents and getRecentEvents in ranges
  // Actually, looking at the schema, we can query by timestamp ranges

  let totalExported = 0;
  const BATCH_SIZE = 500;

  // We need to iterate through years (2015-2025)
  for (let year = 2015; year <= 2025; year++) {
    const startTime = new Date(`${year}-01-01`).getTime();
    const endTime = new Date(`${year + 1}-01-01`).getTime();

    // Get events for this year using sampleEventsByYear with larger limit
    const events = await convex.query(api.newsQueries.sampleEventsByYear, {
      year,
      limit: 5000,
    });

    if (events.length === 0) continue;

    console.log(`   ${year}: Found ${events.length} events`);

    // For each event, we need the full data - get via eventId
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      const fullEvents = [];

      for (const e of batch) {
        const full = await convex.query(api.newsEvents.getEventById, {
          eventId: e.eventId,
        });
        if (full) fullEvents.push(full);
      }

      // Insert batch to Timescale
      if (fullEvents.length > 0) {
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const e of fullEvents) {
          placeholders.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          values.push(
            e.eventId,
            e.eventType,
            e.name,
            e.country,
            e.currency,
            new Date(e.timestamp).toISOString(),
            e.impact,
            e.actual || null,
            e.forecast || null,
            e.previous || null,
            e.description || null
          );
        }

        await pgClient.query(
          `INSERT INTO news_events (event_id, event_type, name, country, currency, timestamp, impact, actual, forecast, previous, description)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (event_id) DO UPDATE SET
             impact = EXCLUDED.impact,
             actual = EXCLUDED.actual,
             forecast = EXCLUDED.forecast,
             previous = EXCLUDED.previous`,
          values
        );

        totalExported += fullEvents.length;
      }

      // Small delay
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(`   Total events exported: ${totalExported}`);
  return totalExported;
}

async function exportReactions(pgClient: pg.Client): Promise<number> {
  console.log("\n2. Exporting price reactions to Timescale...");

  let totalExported = 0;

  for (const pair of PAIRS) {
    console.log(`   Processing ${pair}...`);

    // Get reactions count first
    const countResult = await convex.query(api.newsQueries.getReactionsCountPerPair, { pair });
    console.log(`   ${pair}: ${countResult.reactions} reactions`);

    // Get all reactions for this pair using historical query
    const eventTypes = ["FOMC", "NFP", "CPI", "ECB", "BOE", "GDP", "UNEMPLOYMENT", "RETAIL_SALES"];

    for (const eventType of eventTypes) {
      const reactions = await convex.query(api.newsQueries.getHistoricalReactions, {
        eventType,
        pair,
        limit: 500,
      });

      if (reactions.length === 0) continue;

      // Insert batch to Timescale
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const r of reactions) {
        const reaction = r.reaction;
        placeholders.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        values.push(
          reaction.eventId || r.event.eventId,
          pair,
          reaction.priceAtMinus15m || reaction.priceAtEvent,
          reaction.priceAtMinus5m || reaction.priceAtEvent,
          reaction.priceAtEvent,
          reaction.spikeHigh,
          reaction.spikeLow,
          reaction.spikeDirection,
          reaction.spikeMagnitudePips,
          reaction.priceAtPlus15m || reaction.priceAtEvent,
          reaction.priceAtPlus30m || reaction.priceAtEvent,
          reaction.patternType,
          reaction.didReverse,
          reaction.finalDirectionMatchesSpike
        );
      }

      if (placeholders.length > 0) {
        await pgClient.query(
          `INSERT INTO event_price_reactions
           (event_id, pair, price_at_minus_15m, price_at_minus_5m, price_at_event, spike_high, spike_low, spike_direction, spike_magnitude_pips, price_at_plus_15m, price_at_plus_30m, pattern_type, did_reverse, final_matches_spike)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (event_id, pair) DO UPDATE SET
             spike_magnitude_pips = EXCLUDED.spike_magnitude_pips,
             pattern_type = EXCLUDED.pattern_type`,
          values
        );

        totalExported += reactions.length;
      }
    }
  }

  console.log(`   Total reactions exported: ${totalExported}`);
  return totalExported;
}

async function exportWindows(): Promise<number> {
  console.log("\n3. Exporting candle windows to ClickHouse...");

  let totalExported = 0;
  const BATCH_SIZE = 100;

  for (const pair of PAIRS) {
    console.log(`   Processing ${pair}...`);

    // We need to get windows - let's query by event
    // First get events that have windows
    const completedResult = await convex.query(api.newsEvents.getCompletedEventIds, {
      limit: 10000,
    });

    console.log(`   Found ${completedResult.eventIds.length} events with windows`);

    for (let i = 0; i < completedResult.eventIds.length; i += BATCH_SIZE) {
      const batchEventIds = completedResult.eventIds.slice(i, i + BATCH_SIZE);
      const rows = [];

      for (const eventId of batchEventIds) {
        const window = await convex.query(api.newsEvents.getCandleWindow, {
          eventId,
          pair,
        });

        if (window && window.candles.length > 0) {
          // Transform for ClickHouse parallel arrays
          rows.push({
            event_id: eventId,
            pair,
            window_start: new Date(window.windowStart).toISOString().replace("T", " ").replace("Z", ""),
            window_end: new Date(window.windowEnd).toISOString().replace("T", " ").replace("Z", ""),
            candle_times: window.candles.map((c: any) =>
              new Date(c.timestamp).toISOString().replace("T", " ").replace("Z", "")
            ),
            candle_opens: window.candles.map((c: any) => c.open),
            candle_highs: window.candles.map((c: any) => c.high),
            candle_lows: window.candles.map((c: any) => c.low),
            candle_closes: window.candles.map((c: any) => c.close),
            candle_volumes: window.candles.map((c: any) => c.volume || 0),
            candle_count: window.candles.length,
          });
        }
      }

      if (rows.length > 0) {
        await clickhouse.insert({
          table: "event_candle_windows",
          values: rows,
          format: "JSONEachRow",
        });
        totalExported += rows.length;
      }

      // Progress log every 500
      if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= completedResult.eventIds.length) {
        console.log(`   ${pair}: ${Math.min(i + BATCH_SIZE, completedResult.eventIds.length)}/${completedResult.eventIds.length} events processed`);
      }

      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(`   Total windows exported: ${totalExported}`);
  return totalExported;
}

async function main() {
  console.log("Starting news data migration...\n");

  // Test connections
  const pgClient = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  console.log("Connected to Timescale Cloud");

  const version = await clickhouse.query({
    query: "SELECT version()",
    format: "JSONEachRow",
  });
  console.log("Connected to ClickHouse");

  const progress = loadProgress();

  if (!progress.complete) {
    // Export events
    const eventsExported = await exportEvents(pgClient);
    progress.eventsExported = eventsExported;
    saveProgress(progress);

    // Export reactions
    const reactionsExported = await exportReactions(pgClient);
    progress.reactionsExported = reactionsExported;
    saveProgress(progress);

    // Export windows
    const windowsExported = await exportWindows();
    progress.windowsExported = windowsExported;
    progress.complete = true;
    saveProgress(progress);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`News migration complete!`);
  console.log(`  Events exported: ${progress.eventsExported}`);
  console.log(`  Reactions exported: ${progress.reactionsExported}`);
  console.log(`  Windows exported: ${progress.windowsExported}`);
  console.log(`${"=".repeat(60)}\n`);

  // Verify counts
  console.log("Verifying counts...\n");

  const eventsCount = await pgClient.query("SELECT count(*) FROM news_events");
  console.log(`  Timescale news_events: ${eventsCount.rows[0].count}`);

  const reactionsCount = await pgClient.query("SELECT count(*) FROM event_price_reactions");
  console.log(`  Timescale event_price_reactions: ${reactionsCount.rows[0].count}`);

  const windowsCount = await clickhouse.query({
    query: "SELECT count(*) as count FROM event_candle_windows",
    format: "JSONEachRow",
  });
  const windowsData = await windowsCount.json();
  console.log(`  ClickHouse event_candle_windows: ${(windowsData as any)[0].count}`);

  await pgClient.end();
  await clickhouse.close();
  console.log("\nDone!");
}

main().catch(console.error);
