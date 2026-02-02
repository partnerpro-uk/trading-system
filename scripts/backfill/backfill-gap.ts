#!/usr/bin/env npx tsx
/**
 * Backfill Gap: OANDA REST API → ClickHouse
 *
 * Fills the gap between last ClickHouse data and when streaming started.
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID!;
const OANDA_REST_URL = "https://api-fxpractice.oanda.com";

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST!;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER!;
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD!;

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "XAU_USD",
  "XAG_USD",
  "SPX500_USD",
];

const TIMEFRAMES = [
  { oanda: "M5", db: "M5" },
  { oanda: "M15", db: "M15" },
  { oanda: "M30", db: "M30" },
  { oanda: "H1", db: "H1" },
  { oanda: "H4", db: "H4" },
];

interface OandaCandle {
  time: string;
  mid: {
    o: string;
    h: string;
    l: string;
    c: string;
  };
  volume: number;
  complete: boolean;
}

async function fetchOandaCandles(
  pair: string,
  granularity: string,
  from: Date,
  to: Date
): Promise<OandaCandle[]> {
  const url = `${OANDA_REST_URL}/v3/instruments/${pair}/candles?granularity=${granularity}&from=${from.toISOString()}&to=${to.toISOString()}&price=M`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.candles || [];
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Backfill Gap: OANDA → ClickHouse");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Gap: 01:30 UTC to 10:35 UTC today
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const gapStart = new Date(today);
  gapStart.setUTCHours(1, 30, 0, 0);

  const gapEnd = new Date(today);
  gapEnd.setUTCHours(10, 35, 0, 0);

  console.log(`Gap period: ${gapStart.toISOString()} to ${gapEnd.toISOString()}\n`);

  const clickhouse = createClient({
    url: CLICKHOUSE_HOST,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
  });

  let totalInserted = 0;

  for (const pair of PAIRS) {
    console.log(`\n--- ${pair} ---`);

    for (const tf of TIMEFRAMES) {
      try {
        const candles = await fetchOandaCandles(pair, tf.oanda, gapStart, gapEnd);

        if (candles.length === 0) {
          console.log(`  ${tf.db}: No candles`);
          continue;
        }

        // Filter complete candles only
        const completeCandles = candles.filter(c => c.complete);

        if (completeCandles.length === 0) {
          console.log(`  ${tf.db}: No complete candles`);
          continue;
        }

        // Prepare for ClickHouse insert
        const values = completeCandles.map(c => ({
          time: c.time.replace("T", " ").replace(".000000000Z", ""),
          pair,
          timeframe: tf.db,
          open: parseFloat(c.mid.o),
          high: parseFloat(c.mid.h),
          low: parseFloat(c.mid.l),
          close: parseFloat(c.mid.c),
          volume: c.volume,
        }));

        await clickhouse.insert({
          table: "candles",
          values,
          format: "JSONEachRow",
        });

        console.log(`  ${tf.db}: Inserted ${values.length} candles`);
        totalInserted += values.length;

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      } catch (error: any) {
        console.log(`  ${tf.db}: ERROR - ${error.message}`);
      }
    }
  }

  await clickhouse.close();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  Total inserted: ${totalInserted} candles`);
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
