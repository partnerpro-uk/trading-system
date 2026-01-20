#!/usr/bin/env npx tsx
/**
 * Import news data from local JSONL files
 * Much faster than querying Convex
 *
 * Files:
 * - data/events.jsonl → Timescale news_events
 * - data/reactions.jsonl → Timescale event_price_reactions
 * - data/candle-windows.jsonl → ClickHouse event_candle_windows
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";
import pg from "pg";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { join } from "path";

config({ path: ".env.local" });

const DATA_DIR = join(__dirname, "../../data");

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Postgres client
const { Client } = pg;

interface EventRow {
  event_id: string;
  status: string;
  timestamp_utc: number;
  scraped_at: number;
  day_of_week: string;
  trading_session: string;
  currency: string;
  impact: string;
  event: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
}

interface ReactionRow {
  eventId: string;
  pair: string;
  eventTimestamp: number;
  priceAtMinus15m: number;
  priceAtMinus5m: number;
  priceAtEvent: number;
  spikeHigh: number;
  spikeLow: number;
  spikeDirection: string;
  spikeMagnitudePips: number;
  priceAtPlus15m: number;
  priceAtPlus30m: number;
  patternType: string;
  didReverse: boolean;
  finalDirectionMatchesSpike: boolean;
}

interface WindowRow {
  eventId: string;
  pair: string;
  eventTimestamp: number;
  windowStart: number;
  windowEnd: number;
  candles: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
}

function currencyToCountry(currency: string): string {
  const map: Record<string, string> = {
    USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", AUD: "AU",
    NZD: "NZ", CAD: "CA", CHF: "CH", CNY: "CN",
  };
  return map[currency] || currency;
}

function normalizeEventType(name: string): string {
  const mapping: Record<string, string> = {
    "FOMC Statement": "FOMC",
    "Federal Funds Rate": "FOMC",
    "Non-Farm Employment Change": "NFP",
    "Nonfarm Payrolls": "NFP",
    "Unemployment Rate": "UNEMPLOYMENT",
    "CPI m/m": "CPI_MOM",
    "CPI y/y": "CPI_YOY",
    "Core CPI m/m": "CORE_CPI_MOM",
    "Advance GDP q/q": "GDP",
    "Retail Sales m/m": "RETAIL_SALES",
    "Main Refinancing Rate": "ECB",
    "Official Bank Rate": "BOE",
  };
  return mapping[name] || name.toUpperCase().replace(/\s+/g, "_");
}

async function importEvents(pgClient: pg.Client): Promise<number> {
  console.log("\n1. Importing events from events.jsonl to Timescale...");

  const filePath = join(DATA_DIR, "events.jsonl");
  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let count = 0;
  let batch: EventRow[] = [];
  const BATCH_SIZE = 500;

  const flushBatch = async () => {
    if (batch.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const e of batch) {
      placeholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        e.event_id,
        normalizeEventType(e.event),
        e.event,
        currencyToCountry(e.currency),
        e.currency,
        new Date(e.timestamp_utc).toISOString(),
        e.impact,
        e.actual,
        e.forecast,
        e.previous,
        null // description
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

    count += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as EventRow;
      batch.push(event);
      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
        if (count % 5000 === 0) {
          console.log(`   Imported ${count} events...`);
        }
      }
    } catch (err) {
      // Skip malformed lines
    }
  }

  await flushBatch();
  console.log(`   Total events imported: ${count}`);
  return count;
}

async function importReactions(pgClient: pg.Client): Promise<number> {
  console.log("\n2. Importing reactions from reactions.jsonl to Timescale...");

  const filePath = join(DATA_DIR, "reactions.jsonl");
  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let count = 0;
  let batch: ReactionRow[] = [];
  const BATCH_SIZE = 500;

  const flushBatch = async () => {
    if (batch.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const r of batch) {
      placeholders.push(
        `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
      );
      values.push(
        r.eventId,
        r.pair,
        r.priceAtMinus15m,
        r.priceAtMinus5m,
        r.priceAtEvent,
        r.spikeHigh,
        r.spikeLow,
        r.spikeDirection,
        r.spikeMagnitudePips,
        r.priceAtPlus15m,
        r.priceAtPlus30m,
        r.patternType,
        r.didReverse,
        r.finalDirectionMatchesSpike
      );
    }

    await pgClient.query(
      `INSERT INTO event_price_reactions
       (event_id, pair, price_at_minus_15m, price_at_minus_5m, price_at_event, spike_high, spike_low, spike_direction, spike_magnitude_pips, price_at_plus_15m, price_at_plus_30m, pattern_type, did_reverse, final_matches_spike)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (event_id, pair) DO UPDATE SET
         spike_magnitude_pips = EXCLUDED.spike_magnitude_pips,
         pattern_type = EXCLUDED.pattern_type`,
      values
    );

    count += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const reaction = JSON.parse(line) as ReactionRow;
      batch.push(reaction);
      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
        if (count % 10000 === 0) {
          console.log(`   Imported ${count} reactions...`);
        }
      }
    } catch (err) {
      // Skip malformed lines
    }
  }

  await flushBatch();
  console.log(`   Total reactions imported: ${count}`);
  return count;
}

async function importWindows(): Promise<number> {
  console.log("\n3. Importing candle windows from candle-windows.jsonl to ClickHouse...");

  const filePath = join(DATA_DIR, "candle-windows.jsonl");
  const fileStream = createReadStream(filePath);
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let count = 0;
  let batch: any[] = [];
  const BATCH_SIZE = 100;

  const flushBatch = async () => {
    if (batch.length === 0) return;

    const rows = batch.map((w) => ({
      event_id: w.eventId,
      pair: w.pair,
      window_start: new Date(w.windowStart).toISOString().replace("T", " ").replace("Z", ""),
      window_end: new Date(w.windowEnd).toISOString().replace("T", " ").replace("Z", ""),
      candle_times: w.candles.map((c: any) =>
        new Date(c.timestamp).toISOString().replace("T", " ").replace("Z", "")
      ),
      candle_opens: w.candles.map((c: any) => c.open),
      candle_highs: w.candles.map((c: any) => c.high),
      candle_lows: w.candles.map((c: any) => c.low),
      candle_closes: w.candles.map((c: any) => c.close),
      candle_volumes: w.candles.map((c: any) => c.volume || 0),
      candle_count: w.candles.length,
    }));

    await clickhouse.insert({
      table: "event_candle_windows",
      values: rows,
      format: "JSONEachRow",
    });

    count += batch.length;
    batch = [];
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const window = JSON.parse(line) as WindowRow;
      batch.push(window);
      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
        if (count % 5000 === 0) {
          console.log(`   Imported ${count} windows...`);
        }
      }
    } catch (err) {
      // Skip malformed lines
    }
  }

  await flushBatch();
  console.log(`   Total windows imported: ${count}`);
  return count;
}

async function main() {
  console.log("═".repeat(60));
  console.log("  IMPORT FROM LOCAL FILES");
  console.log("═".repeat(60));

  // Connect to databases
  const pgClient = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  console.log("✓ Connected to Timescale Cloud");
  console.log("✓ Connected to ClickHouse");

  const startTime = Date.now();

  // Import all data
  const eventsCount = await importEvents(pgClient);
  const reactionsCount = await importReactions(pgClient);
  const windowsCount = await importWindows();

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  IMPORT COMPLETE (${elapsed} minutes)`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Events:    ${eventsCount.toLocaleString()}`);
  console.log(`  Reactions: ${reactionsCount.toLocaleString()}`);
  console.log(`  Windows:   ${windowsCount.toLocaleString()}`);

  // Verify counts
  console.log("\nVerifying...");

  const tsEvents = await pgClient.query("SELECT count(*) FROM news_events");
  const tsReactions = await pgClient.query("SELECT count(*) FROM event_price_reactions");
  console.log(`  Timescale news_events: ${tsEvents.rows[0].count}`);
  console.log(`  Timescale reactions: ${tsReactions.rows[0].count}`);

  const chWindows = await clickhouse.query({
    query: "SELECT count(*) as count FROM event_candle_windows",
    format: "JSONEachRow",
  });
  const windowData = await chWindows.json();
  console.log(`  ClickHouse windows: ${(windowData as any)[0].count}`);

  await pgClient.end();
  await clickhouse.close();
  console.log("\nDone!");
}

main().catch(console.error);
