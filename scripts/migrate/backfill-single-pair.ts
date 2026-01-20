#!/usr/bin/env npx tsx
/**
 * Backfill a single pair from OANDA to ClickHouse
 * Usage: npx tsx scripts/migrate/backfill-single-pair.ts AUD_USD
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const PAIR = process.argv[2];
if (!PAIR) {
  console.error("Usage: npx tsx backfill-single-pair.ts <PAIR>");
  console.error("Example: npx tsx backfill-single-pair.ts AUD_USD");
  process.exit(1);
}

const TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4", "D", "W", "M"] as const;
const OANDA_GRANULARITY: Record<string, string> = {
  M5: "M5", M15: "M15", M30: "M30", H1: "H1", H4: "H4", D: "D", W: "W", M: "M",
};
const MAX_CANDLES = 5000;
const DELAY_MS = 150; // Slightly slower to avoid conflicts with main backfill
const START_YEAR = 2007;

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_API_URL = "https://api-fxpractice.oanda.com";

async function fetchCandles(pair: string, granularity: string, from: Date, _to: Date) {
  // Note: OANDA doesn't allow both 'to' and 'count' - use 'from' + 'count' only
  const url = `${OANDA_API_URL}/v3/instruments/${pair}/candles?granularity=${granularity}&from=${from.toISOString()}&count=${MAX_CANDLES}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${OANDA_API_KEY}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.candles || [];
}

async function insertToClickHouse(candles: any[], pair: string, timeframe: string) {
  if (candles.length === 0) return;

  // Group by month for partitions
  const byMonth: Record<string, any[]> = {};
  for (const c of candles) {
    const yyyymm = c.time.slice(0, 7).replace("-", "");
    if (!byMonth[yyyymm]) byMonth[yyyymm] = [];
    byMonth[yyyymm].push(c);
  }

  for (const monthCandles of Object.values(byMonth)) {
    const rows = monthCandles.map((c: any) => ({
      time: c.time.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", ""),
      pair,
      timeframe,
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: c.volume || 0,
    }));

    await clickhouse.insert({
      table: "candles",
      values: rows,
      format: "JSONEachRow",
    });
  }
}

async function backfillTimeframe(pair: string, timeframe: string) {
  const granularity = OANDA_GRANULARITY[timeframe];
  let from = new Date(START_YEAR, 0, 1);
  const end = new Date();
  let total = 0;

  console.log(`  ${pair} ${timeframe}: Starting...`);

  while (from < end) {
    try {
      const candles = await fetchCandles(pair, granularity, from, end);

      if (candles.length === 0) break;

      await insertToClickHouse(candles, pair, timeframe);
      total += candles.length;

      const lastTime = candles[candles.length - 1].time;
      from = new Date(lastTime);
      from.setSeconds(from.getSeconds() + 1);

      process.stdout.write(`\r  ${pair} ${timeframe}: ${total.toLocaleString()} candles (${lastTime.slice(0, 10)})    `);

      if (candles.length < MAX_CANDLES) break;

      await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err: any) {
      console.error(`\n  Error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`\n  ${pair} ${timeframe}: Complete (${total.toLocaleString()} candles)`);
  return total;
}

async function main() {
  console.log(`\n=== Backfilling ${PAIR} ===\n`);

  let grandTotal = 0;
  for (const tf of TIMEFRAMES) {
    const count = await backfillTimeframe(PAIR, tf);
    grandTotal += count;
  }

  console.log(`\n=== ${PAIR} Complete: ${grandTotal.toLocaleString()} candles ===\n`);
  await clickhouse.close();
}

main().catch(console.error);
