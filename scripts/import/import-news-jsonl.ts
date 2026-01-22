/**
 * Import news events from JSONL files to TimescaleDB
 *
 * This script reads the scraper JSONL files and imports them with all timezone data.
 *
 * Run: npx tsx scripts/import-news-jsonl.ts
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";
import { readFileSync } from "fs";

config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

// JSONL files to import (in order)
const JSONL_FILES = [
  "scraper/forex_2007_2011.jsonl",
  "scraper/forex_2012_2016.jsonl",
  "scraper/forex_2017_2021.jsonl",
  "scraper/forex_2022_2026.jsonl",
  "scraper/forex_2026_future.jsonl",
];

interface JsonlEvent {
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

// Map event name to event_type
function getEventType(eventName: string): string {
  return eventName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Get country from currency
function getCountry(currency: string): string {
  const countryMap: Record<string, string> = {
    USD: "US",
    GBP: "GB",
    EUR: "EU",
    JPY: "JP",
    AUD: "AU",
    NZD: "NZ",
    CAD: "CA",
    CHF: "CH",
    CNY: "CN",
  };
  return countryMap[currency] || currency;
}

async function insertBatch(pool: Pool, events: JsonlEvent[]): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  events.forEach((e, i) => {
    const offset = i * 20;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20})`
    );
    values.push(
      e.event_id,
      getEventType(e.event),
      e.event,
      getCountry(e.currency),
      e.currency,
      new Date(e.timestamp_utc),
      e.impact,
      e.actual,
      e.forecast,
      e.previous,
      e.datetime_utc,
      e.datetime_new_york,
      e.datetime_london,
      e.source_tz,
      e.day_of_week,
      e.trading_session,
      e.status,
      e.outcome,
      e.deviation,
      e.deviation_pct
    );
  });

  await pool.query(
    `INSERT INTO news_events (
      event_id, event_type, name, country, currency, timestamp, impact,
      actual, forecast, previous,
      datetime_utc, datetime_new_york, datetime_london, source_tz,
      day_of_week, trading_session, status, outcome, deviation, deviation_pct
    )
    VALUES ${placeholders.join(", ")}
    ON CONFLICT (event_id) DO UPDATE SET
      event_type = EXCLUDED.event_type,
      name = EXCLUDED.name,
      timestamp = EXCLUDED.timestamp,
      impact = EXCLUDED.impact,
      actual = EXCLUDED.actual,
      forecast = EXCLUDED.forecast,
      previous = EXCLUDED.previous,
      datetime_utc = EXCLUDED.datetime_utc,
      datetime_new_york = EXCLUDED.datetime_new_york,
      datetime_london = EXCLUDED.datetime_london,
      source_tz = EXCLUDED.source_tz,
      day_of_week = EXCLUDED.day_of_week,
      trading_session = EXCLUDED.trading_session,
      status = EXCLUDED.status,
      outcome = EXCLUDED.outcome,
      deviation = EXCLUDED.deviation,
      deviation_pct = EXCLUDED.deviation_pct
    `,
    values
  );
}

async function importFile(pool: Pool, filePath: string): Promise<number> {
  const fullPath = resolve(process.cwd(), filePath);
  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const events: JsonlEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip invalid lines
    }
  }

  // Dedupe events by event_id (keep latest)
  const eventMap = new Map<string, JsonlEvent>();
  for (const e of events) {
    eventMap.set(e.event_id, e);
  }
  const uniqueEvents = Array.from(eventMap.values());

  // Insert in batches
  const BATCH_SIZE = 500;
  for (let i = 0; i < uniqueEvents.length; i += BATCH_SIZE) {
    const batch = uniqueEvents.slice(i, i + BATCH_SIZE);
    await insertBatch(pool, batch);
    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, uniqueEvents.length)}/${uniqueEvents.length}`);
  }
  console.log("");

  return uniqueEvents.length;
}

async function main() {
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

  try {
    // Check if we need to add event_id unique constraint
    const constraints = await pool.query(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'news_events' AND constraint_type = 'UNIQUE'
    `);

    const hasEventIdConstraint = constraints.rows.some(
      (r) => r.constraint_name.includes("event_id")
    );

    if (!hasEventIdConstraint) {
      console.log("Adding unique constraint on event_id...");
      try {
        await pool.query(`
          ALTER TABLE news_events ADD CONSTRAINT news_events_event_id_unique UNIQUE (event_id)
        `);
        console.log("  Done");
      } catch (e: any) {
        if (!e.message.includes("already exists")) throw e;
      }
    }

    console.log("=== Importing JSONL Files ===\n");

    let total = 0;
    for (const file of JSONL_FILES) {
      console.log(`Importing ${file}...`);
      const count = await importFile(pool, file);
      console.log(`  Imported ${count} events`);
      total += count;
    }

    console.log(`\n=== Done: ${total} total events imported ===\n`);

    // Show sample of imported data
    const sample = await pool.query(`
      SELECT event_id, name, currency, datetime_utc, datetime_new_york, datetime_london
      FROM news_events
      WHERE currency = 'GBP' AND name LIKE '%Unemployment%'
      ORDER BY timestamp DESC
      LIMIT 3
    `);

    console.log("Sample GBP Unemployment events:");
    for (const row of sample.rows) {
      console.log(
        `  ${row.name}: UTC=${row.datetime_utc} | NY=${row.datetime_new_york} | London=${row.datetime_london}`
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
