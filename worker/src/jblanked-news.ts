#!/usr/bin/env npx tsx
/**
 * JBlanked News API Ingestion Service
 *
 * Fetches economic calendar data from JBlanked API and stores in:
 * - ClickHouse (all historical data)
 * - TimescaleDB (rolling 90 days for operational queries)
 *
 * Sources: MQL5, Forex Factory, FxStreet
 * Historical depth: 2023-01-01 onwards
 * Impact levels: High, Medium, Low, None (backfilled from 2024+)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient, ClickHouseClient } from "@clickhouse/client";
import { Pool } from "pg";
import { format, subDays, addDays, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// =============================================================================
// Configuration
// =============================================================================

const JBLANKED_API_KEY = process.env.JBLANKED_API_KEY || "";
const JBLANKED_BASE_URL = "https://www.jblanked.com/news/api";

// Default impact windows (minutes before/after event)
const IMPACT_WINDOWS: Record<string, { before: number; after: number }> = {
  High: { before: 30, after: 60 },
  Medium: { before: 15, after: 30 },
  Low: { before: 5, after: 15 },
  None: { before: 5, after: 10 },
};

// Currency to country mapping
const CURRENCY_COUNTRY: Record<string, string> = {
  USD: "United States",
  EUR: "Eurozone",
  GBP: "United Kingdom",
  JPY: "Japan",
  AUD: "Australia",
  NZD: "New Zealand",
  CAD: "Canada",
  CHF: "Switzerland",
  CNY: "China",
  CNH: "China",
};

// Unit suffixes for known events (ForexFactory display format)
// These events report values in specific units that should be displayed
const EVENT_UNITS: Record<string, string> = {
  // Job reports - thousands (K)
  "Unemployment Claims": "K",
  "Continuing Claims": "K",
  "ADP Non-Farm Employment Change": "K",
  "Non-Farm Employment Change": "K",
  "Employment Change": "K",
  "Challenger Job Cuts": "K",
  "JOLTS Job Openings": "M", // Millions

  // Trade/Currency reports - billions (B)
  "Trade Balance": "B",
  "Current Account": "B",
  "Budget Balance": "B",
  "Federal Budget Balance": "B",
  "Treasury Currency Report": "B",

  // Percent-based (%)
  "CPI m/m": "%",
  "CPI y/y": "%",
  "CPI q/q": "%",
  "Core CPI m/m": "%",
  "Core CPI y/y": "%",
  "PPI m/m": "%",
  "PPI y/y": "%",
  "Core PPI m/m": "%",
  "GDP q/q": "%",
  "Final GDP q/q": "%",
  "Prelim GDP q/q": "%",
  "GDP y/y": "%",
  "Retail Sales m/m": "%",
  "Core Retail Sales m/m": "%",
  "Industrial Production m/m": "%",
  "Manufacturing Production m/m": "%",
  "Unemployment Rate": "%",
  "Interest Rate": "%",
  "Policy Rate": "%",
  "BOJ Policy Rate": "%",
  "BOE Policy Rate": "%",
  "ECB Main Refinancing Rate": "%",
  "Fed Funds Rate": "%",
  "Cash Rate": "%",
  "NHPI m/m": "%",
  "HPI m/m": "%",
  "Final GDP Price Index q/q": "%",
  "Core PCE Price Index m/m": "%",
  "Personal Income m/m": "%",
  "Personal Spending m/m": "%",
};

// =============================================================================
// Types
// =============================================================================

interface JBlankedEvent {
  Name: string;
  Currency: string;
  Event_ID: number;
  Category: string;
  Impact: "High" | "Medium" | "Low" | "None";
  Date: string; // "2026.01.22 23:45:00"
  Actual: number;
  Forecast: number;
  Previous: number;
  Outcome: string;
  Strength: string;
  Quality: string;
}

interface NewsEvent {
  event_id: string;
  event_type: string;
  name: string;
  country: string;
  currency: string;
  timestamp: Date;
  impact: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  description: string | null;
  datetime_utc: string;
  datetime_new_york: string;
  datetime_london: string;
  source_tz: string;
  trading_session: string;
  window_before_minutes: number;
  window_after_minutes: number;
  raw_source: string;
}

// =============================================================================
// API Client
// =============================================================================

async function fetchJBlankedCalendar(
  source: "mql5" | "forex-factory" | "fxstreet",
  fromDate: string,
  toDate: string
): Promise<JBlankedEvent[]> {
  const url = `${JBLANKED_BASE_URL}/${source}/calendar/range/?from=${fromDate}&to=${toDate}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (JBLANKED_API_KEY) {
    headers["Authorization"] = `Api-Key ${JBLANKED_API_KEY}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`JBlanked API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    console.warn(`Unexpected response format from ${source}:`, typeof data);
    return [];
  }

  return data;
}

async function fetchTodayCalendar(
  source: "mql5" | "forex-factory" | "fxstreet"
): Promise<JBlankedEvent[]> {
  const url = `${JBLANKED_BASE_URL}/${source}/calendar/today/`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (JBLANKED_API_KEY) {
    headers["Authorization"] = `Api-Key ${JBLANKED_API_KEY}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`JBlanked API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// =============================================================================
// Data Transformation
// =============================================================================

/**
 * JBlanked API returns times in EET (Eastern European Time) = UTC+2
 * This is the same timezone used by MetaTrader/MQL5 servers.
 * We need to convert to UTC for storage.
 */
const JBLANKED_TIMEZONE = "Europe/Helsinki"; // EET/EEST (UTC+2/+3)

function parseJBlankedDate(dateStr: string): Date {
  // Format: "2026.01.22 23:45:00" - in EET (UTC+2)
  // Convert to ISO format for parsing
  const normalized = dateStr.replace(/\./g, "-").replace(" ", "T");

  // Parse as EET and convert to UTC
  const eetDate = fromZonedTime(normalized, JBLANKED_TIMEZONE);
  return eetDate;
}

/**
 * Check if a date is in DST for a given timezone
 * Uses the timezone offset difference between the date and January 1st
 */
function isInDst(date: Date, timezone: string): boolean {
  // Get offset for current date
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  });
  const currentOffset = formatter.formatToParts(date).find(p => p.type === "timeZoneName")?.value || "";

  // Get offset for January 1st (winter time)
  const jan1 = new Date(date.getFullYear(), 0, 1);
  const winterOffset = formatter.formatToParts(jan1).find(p => p.type === "timeZoneName")?.value || "";

  // If offset differs from winter, we're in DST
  return currentOffset !== winterOffset;
}

/**
 * DST-aware trading session calculator
 *
 * Sessions (UTC, winter time):
 * - Sydney: 22:00 - 07:00 (crosses midnight)
 * - Tokyo: 00:00 - 09:00 (Japan has no DST)
 * - London: 08:00 - 16:00 (shifts to 07:00-15:00 in UK DST)
 * - New York: 13:00 - 21:00 (shifts to 12:00-20:00 in US DST)
 */
function getTradingSession(timestamp: Date): string {
  const hour = timestamp.getUTCHours();

  // Check DST status for London and New York
  const isUkDst = isInDst(timestamp, "Europe/London");
  const isUsDst = isInDst(timestamp, "America/New_York");

  // Adjust session boundaries based on DST
  // London: 08:00-16:00 winter, 07:00-15:00 summer (UTC)
  const londonStart = isUkDst ? 7 : 8;
  const londonEnd = isUkDst ? 15 : 16;

  // New York: 13:00-21:00 winter, 12:00-20:00 summer (UTC)
  const nyStart = isUsDst ? 12 : 13;
  const nyEnd = isUsDst ? 20 : 21;

  // Determine session (priority: NY > London > Tokyo > Sydney)
  if (hour >= nyStart && hour < nyEnd) return "New York";
  if (hour >= londonStart && hour < londonEnd) return "London";
  if (hour >= 0 && hour < 9) return "Tokyo";
  if (hour >= 22 || hour < 7) return "Sydney";

  // Overlap periods
  if (hour >= londonStart && hour < nyEnd) return "London/NY Overlap";

  return "Sydney";
}

/**
 * Extract currency code from JBlanked format
 * JBlanked returns "CURRENCY_USD", "CURRENCY_EUR", etc.
 */
function extractCurrency(raw: string | null): string {
  if (!raw) return "";
  // Handle "CURRENCY_XXX" format
  if (raw.startsWith("CURRENCY_")) {
    return raw.replace("CURRENCY_", "");
  }
  return raw;
}

/**
 * Format a numeric value with its unit suffix based on event name.
 * Examples: 200 -> "200K" for Unemployment Claims, 0.3 -> "0.3%" for CPI m/m
 */
function formatValueWithUnit(value: number, eventName: string): string | null {
  if (value === 0) return null;

  const unit = EVENT_UNITS[eventName];
  if (unit) {
    return `${value}${unit}`;
  }
  return String(value);
}

function isValidEvent(event: JBlankedEvent): boolean {
  // Skip events without required fields
  const currency = extractCurrency(event.Currency);
  return !!(event.Name && currency && event.Date);
}

/**
 * Generate a deterministic event ID based on event content.
 * Format: jb_{source}_{name}_{currency}_{timestamp_ms}
 * This ensures the same event always gets the same ID.
 */
function generateEventId(
  source: string,
  name: string,
  currency: string,
  timestamp: Date
): string {
  // Normalize name: remove spaces, lowercase, truncate
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .substring(0, 20);
  const timestampMs = timestamp.getTime();
  return `jb_${source}_${normalizedName}_${currency}_${timestampMs}`;
}

function transformEvent(event: JBlankedEvent, source: string): NewsEvent | null {
  // Validate before transforming
  if (!isValidEvent(event)) {
    return null;
  }

  const timestamp = parseJBlankedDate(event.Date);
  const impact = event.Impact || "None";
  const windows = IMPACT_WINDOWS[impact] || IMPACT_WINDOWS.None;
  const currency = extractCurrency(event.Currency);

  return {
    event_id: generateEventId(source, event.Name, currency, timestamp),
    event_type: event.Category || "Unknown",
    name: event.Name,
    country: CURRENCY_COUNTRY[currency] || currency || "Unknown",
    currency: currency.substring(0, 5), // Max 5 chars for TimescaleDB
    timestamp,
    impact,
    actual: formatValueWithUnit(event.Actual, event.Name),
    forecast: formatValueWithUnit(event.Forecast, event.Name),
    previous: formatValueWithUnit(event.Previous, event.Name),
    description: event.Outcome !== "Data Not Loaded" ? event.Outcome : null,
    datetime_utc: formatInTimeZone(timestamp, "UTC", "yyyy-MM-dd HH:mm:ss"),
    datetime_new_york: formatInTimeZone(timestamp, "America/New_York", "yyyy-MM-dd HH:mm:ss"),
    datetime_london: formatInTimeZone(timestamp, "Europe/London", "yyyy-MM-dd HH:mm:ss"),
    source_tz: "EET", // JBlanked uses EET (UTC+2), converted to UTC for storage
    trading_session: getTradingSession(timestamp),
    window_before_minutes: windows.before,
    window_after_minutes: windows.after,
    raw_source: `jb_${source.substring(0, 16)}`, // Max 20 chars for TimescaleDB
  };
}

// =============================================================================
// Database Writers
// =============================================================================

async function writeToClickHouse(
  client: ClickHouseClient,
  events: NewsEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  const rows = events.map((e) => ({
    event_id: e.event_id,
    event_type: e.event_type,
    name: e.name,
    country: e.country,
    currency: e.currency,
    timestamp: e.timestamp.toISOString(),
    impact: e.impact,
    actual: e.actual,
    forecast: e.forecast,
    previous: e.previous,
    description: e.description,
    datetime_utc: e.datetime_utc,
    datetime_new_york: e.datetime_new_york,
    datetime_london: e.datetime_london,
    source_tz: e.source_tz,
    trading_session: e.trading_session,
    window_before_minutes: e.window_before_minutes,
    window_after_minutes: e.window_after_minutes,
    raw_source: e.raw_source,
    created_at: new Date().toISOString(),
  }));

  await client.insert({
    table: "news_events",
    values: rows,
    format: "JSONEachRow",
  });

  return rows.length;
}

async function writeToTimescale(
  pool: Pool,
  events: NewsEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  const client = await pool.connect();
  try {
    let inserted = 0;

    for (const e of events) {
      await client.query(
        `INSERT INTO news_events (
          event_id, event_type, name, country, currency, timestamp,
          impact, actual, forecast, previous, description,
          datetime_utc, datetime_new_york, datetime_london, source_tz,
          trading_session, window_before_minutes, window_after_minutes, raw_source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (event_id) DO UPDATE SET
          actual = EXCLUDED.actual,
          forecast = EXCLUDED.forecast,
          previous = EXCLUDED.previous,
          impact = EXCLUDED.impact`,
        [
          e.event_id, e.event_type, e.name, e.country, e.currency, e.timestamp,
          e.impact, e.actual, e.forecast, e.previous, e.description,
          e.datetime_utc, e.datetime_new_york, e.datetime_london, e.source_tz,
          e.trading_session, e.window_before_minutes, e.window_after_minutes, e.raw_source,
        ]
      );
      inserted++;
    }

    return inserted;
  } finally {
    client.release();
  }
}

// =============================================================================
// Main Operations
// =============================================================================

export async function backfillHistorical(
  startDate: string = "2023-01-01",
  endDate?: string
): Promise<void> {
  console.log("=".repeat(60));
  console.log("JBlanked Historical Backfill");
  console.log("=".repeat(60));

  if (!JBLANKED_API_KEY) {
    throw new Error("JBLANKED_API_KEY environment variable is required");
  }

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  const end = endDate ? parseISO(endDate) : new Date();
  let current = parseISO(startDate);
  let totalEvents = 0;
  const source = "forex-factory"; // Primary source

  try {
    while (current < end) {
      // Fetch one month at a time
      const monthEnd = addDays(current, 30);
      const actualEnd = monthEnd > end ? end : monthEnd;

      const fromStr = format(current, "yyyy-MM-dd");
      const toStr = format(actualEnd, "yyyy-MM-dd");

      console.log(`\nFetching ${fromStr} to ${toStr}...`);

      try {
        const rawEvents = await fetchJBlankedCalendar(source, fromStr, toStr);
        const events = rawEvents.map((e) => transformEvent(e, source)).filter((e): e is NewsEvent => e !== null);

        if (events.length > 0) {
          const written = await writeToClickHouse(clickhouse, events);
          totalEvents += written;
          console.log(`  → Wrote ${written} events to ClickHouse`);
        } else {
          console.log(`  → No events found`);
        }

        // Rate limit: 1 request per second
        await new Promise((r) => setTimeout(r, 1000));
      } catch (error) {
        console.error(`  → Error fetching ${fromStr}: ${error}`);
      }

      current = addDays(actualEnd, 1);
    }

    console.log("\n" + "=".repeat(60));
    console.log(`Backfill complete: ${totalEvents.toLocaleString()} total events`);
    console.log("=".repeat(60));
  } finally {
    await clickhouse.close();
  }
}

export async function forwardFill(): Promise<void> {
  console.log("=".repeat(60));
  console.log("JBlanked Forward Fill (Today + This Week)");
  console.log("=".repeat(60));

  if (!JBLANKED_API_KEY) {
    throw new Error("JBLANKED_API_KEY environment variable is required");
  }

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  const timescaleUrl = process.env.TIMESCALE_URL?.replace(/[?&]sslmode=[^&]+/, "");
  const timescale = timescaleUrl
    ? new Pool({ connectionString: timescaleUrl, ssl: { rejectUnauthorized: false } })
    : null;

  const source = "forex-factory";

  try {
    // Fetch today's events
    console.log("\nFetching today's events...");
    const todayEvents = await fetchTodayCalendar(source);
    const transformedToday = todayEvents.map((e) => transformEvent(e, source)).filter((e): e is NewsEvent => e !== null);

    if (transformedToday.length > 0) {
      const chWritten = await writeToClickHouse(clickhouse, transformedToday);
      console.log(`  → ClickHouse: ${chWritten} events`);

      if (timescale) {
        const tsWritten = await writeToTimescale(timescale, transformedToday);
        console.log(`  → TimescaleDB: ${tsWritten} events`);
      }
    }

    // Fetch week ahead (for forward-looking data)
    console.log("\nFetching week ahead...");
    const today = new Date();
    const weekAhead = addDays(today, 7);
    const weekEvents = await fetchJBlankedCalendar(
      source,
      format(today, "yyyy-MM-dd"),
      format(weekAhead, "yyyy-MM-dd")
    );
    const transformedWeek = weekEvents.map((e) => transformEvent(e, source)).filter((e): e is NewsEvent => e !== null);

    if (transformedWeek.length > 0) {
      const chWritten = await writeToClickHouse(clickhouse, transformedWeek);
      console.log(`  → ClickHouse: ${chWritten} events`);

      if (timescale) {
        const tsWritten = await writeToTimescale(timescale, transformedWeek);
        console.log(`  → TimescaleDB: ${tsWritten} events`);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("Forward fill complete");
    console.log("=".repeat(60));
  } finally {
    await clickhouse.close();
    if (timescale) await timescale.end();
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "forward";

  switch (command) {
    case "backfill":
      const startDate = args[1] || "2023-01-01";
      const endDate = args[2];
      await backfillHistorical(startDate, endDate);
      break;

    case "forward":
      await forwardFill();
      break;

    default:
      console.log("Usage:");
      console.log("  npx tsx jblanked-news.ts backfill [startDate] [endDate]");
      console.log("  npx tsx jblanked-news.ts forward");
      console.log("");
      console.log("Examples:");
      console.log("  npx tsx jblanked-news.ts backfill 2023-01-01");
      console.log("  npx tsx jblanked-news.ts backfill 2024-01-01 2024-06-30");
      console.log("  npx tsx jblanked-news.ts forward");
  }
}

// Run standalone if executed directly (ESM compatible)
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
