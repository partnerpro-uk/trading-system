/**
 * Batch Extended Aftermath Population
 *
 * Fetches H1 candles in bulk per pair, then updates reactions individually.
 * Uses in-memory lookup for fast candle matching.
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), "../.env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300_000,
});

interface Reaction {
  event_id: string;
  pair: string;
  event_time: string;
  spike_direction: string;
  price_at_event: number;
  price_at_minus_15m: number;
  spike_high: number;
  spike_low: number;
}

interface H1Candle {
  time: string;
  close: number;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retryQuery<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 5000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      console.error(`  Attempt ${i + 1}/${retries} failed:`, (err as Error).message);
      if (i < retries - 1) {
        await sleep(delay);
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw new Error("Unreachable");
}

function classifyExtendedPattern(
  spikeDir: string,
  priceAtEvent: number,
  priceAtMinus15m: number,
  spikeHigh: number,
  spikeLow: number,
  priceAt8hr: number | null,
  priceAt24hr: number | null
): string {
  if (priceAt24hr === null) return "";
  const spikeRange = Math.abs(spikeHigh - spikeLow);

  if (
    (spikeDir === "UP" && priceAt24hr > priceAtEvent) ||
    (spikeDir === "DOWN" && priceAt24hr < priceAtEvent)
  ) {
    return "spike_trend";
  }
  if (Math.abs(priceAt24hr - priceAtMinus15m) < spikeRange * 0.3) {
    return "mean_reversion";
  }
  if (priceAt8hr !== null) {
    if (
      (spikeDir === "UP" && priceAt8hr < priceAtEvent && priceAt24hr > priceAtEvent) ||
      (spikeDir === "DOWN" && priceAt8hr > priceAtEvent && priceAt24hr < priceAtEvent)
    ) {
      return "spike_trap_trend";
    }
  }
  if (Math.abs(priceAt24hr - priceAtEvent) < spikeRange * 0.5) {
    return "new_range";
  }
  return "";
}

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD", "SPX500_USD",
];

async function main() {
  console.log("Populating extended aftermath (batch approach)...\n");

  // Check current status
  const statusResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(price_t_plus_2hr IS NOT NULL) as has_2hr,
        countIf(price_t_plus_24hr IS NOT NULL) as has_24hr
      FROM event_price_reactions
    `,
    format: "JSONEachRow",
  });
  const status = await statusResult.json<Array<{ total: string; has_2hr: string; has_24hr: string }>>();
  console.log(`Current: ${status[0].total} reactions, ${status[0].has_2hr} with T+2hr\n`);

  for (const pair of PAIRS) {
    console.log(`\n=== Processing ${pair} ===`);

    // Get reactions needing processing for this pair
    const reactionsResult = await retryQuery(async () => {
      const r = await client.query({
        query: `
          SELECT
            r.event_id,
            r.pair,
            toString(e.timestamp) as event_time,
            r.spike_direction,
            toFloat64(r.price_at_event) as price_at_event,
            toFloat64(r.price_at_minus_15m) as price_at_minus_15m,
            toFloat64(r.spike_high) as spike_high,
            toFloat64(r.spike_low) as spike_low
          FROM event_price_reactions r
          INNER JOIN news_events e ON r.event_id = e.event_id
          WHERE r.pair = '${pair}' AND r.price_t_plus_2hr IS NULL
          ORDER BY e.timestamp
        `,
        format: "JSONEachRow",
      });
      return r.json<Reaction[]>();
    });

    console.log(`  ${reactionsResult.length} reactions need processing`);
    if (reactionsResult.length === 0) continue;

    // Get time range for H1 candles we need
    const minTime = new Date(reactionsResult[0].event_time);
    const maxTime = new Date(reactionsResult[reactionsResult.length - 1].event_time);
    const candleStart = new Date(minTime.getTime() + 2 * 60 * 60 * 1000);
    const candleEnd = new Date(maxTime.getTime() + 25 * 60 * 60 * 1000);

    // Fetch all H1 candles we need in one query
    console.log(`  Fetching H1 candles...`);
    const startStr = candleStart.toISOString().slice(0, 19).replace("T", " ");
    const endStr = candleEnd.toISOString().slice(0, 19).replace("T", " ");
    const candlesResult = await retryQuery(async () => {
      const r = await client.query({
        query: `
          SELECT time, toFloat64(close) as close
          FROM candles
          WHERE pair = '${pair}' AND timeframe = 'H1'
            AND time >= parseDateTime64BestEffort('${startStr}', 3)
            AND time <= parseDateTime64BestEffort('${endStr}', 3)
          ORDER BY time
        `,
        format: "JSONEachRow",
      });
      return r.json<H1Candle[]>();
    });

    console.log(`  Fetched ${candlesResult.length} H1 candles`);

    // Build a map for fast lookups: timestamp -> close price
    const candleMap = new Map<number, number>();
    for (const c of candlesResult) {
      const ts = new Date(c.time).getTime();
      candleMap.set(ts, c.close);
    }

    // Helper to find first candle at or after a time
    function findCandleClose(afterTime: Date): number | null {
      // H1 candles are on hour boundaries, so round up to next hour
      const startTs = Math.ceil(afterTime.getTime() / 3600000) * 3600000;
      // Check next few hours in case of gaps
      for (let offset = 0; offset < 3 * 3600000; offset += 3600000) {
        const price = candleMap.get(startTs + offset);
        if (price !== undefined) return price;
      }
      return null;
    }

    // Process reactions and build update statements
    let processed = 0;
    let updated = 0;

    for (const r of reactionsResult) {
      const eventTime = new Date(r.event_time);
      const t2hr = new Date(eventTime.getTime() + 2 * 60 * 60 * 1000);
      const t4hr = new Date(eventTime.getTime() + 4 * 60 * 60 * 1000);
      const t8hr = new Date(eventTime.getTime() + 8 * 60 * 60 * 1000);
      const t24hr = new Date(eventTime.getTime() + 24 * 60 * 60 * 1000);

      const p2hr = findCandleClose(t2hr);
      const p4hr = findCandleClose(t4hr);
      const p8hr = findCandleClose(t8hr);
      const p24hr = findCandleClose(t24hr);

      const pattern = classifyExtendedPattern(
        r.spike_direction,
        r.price_at_event,
        r.price_at_minus_15m,
        r.spike_high,
        r.spike_low,
        p8hr,
        p24hr
      );

      // Individual UPDATE without FROM clause
      try {
        await client.command({
          query: `
            ALTER TABLE event_price_reactions UPDATE
              price_t_plus_2hr = ${p2hr ?? "NULL"},
              price_t_plus_4hr = ${p4hr ?? "NULL"},
              price_t_plus_8hr = ${p8hr ?? "NULL"},
              price_t_plus_24hr = ${p24hr ?? "NULL"},
              extended_pattern_type = '${pattern}'
            WHERE event_id = '${r.event_id}' AND pair = '${r.pair}'
          `,
        });
        updated++;
      } catch (err) {
        // Skip errors silently for individual updates
      }

      processed++;
      if (processed % 500 === 0 || processed === reactionsResult.length) {
        console.log(`  Processed ${processed}/${reactionsResult.length} (${updated} updated)`);
      }
    }

    console.log(`  ${pair} complete: ${updated} updated`);
    await sleep(1000);
  }

  // Wait for mutations
  console.log("\nWaiting for mutations...");
  await sleep(15000);

  // Final status
  const finalResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(price_t_plus_2hr IS NOT NULL) as has_2hr,
        countIf(price_t_plus_24hr IS NOT NULL) as has_24hr,
        countIf(extended_pattern_type != '') as has_pattern
      FROM event_price_reactions
    `,
    format: "JSONEachRow",
  });
  const final = await finalResult.json<Array<{
    total: string;
    has_2hr: string;
    has_24hr: string;
    has_pattern: string;
  }>>();

  console.log(`\n=== Final Results ===`);
  console.log(`Total reactions: ${final[0].total}`);
  console.log(`With T+2hr:      ${final[0].has_2hr}`);
  console.log(`With T+24hr:     ${final[0].has_24hr}`);
  console.log(`With pattern:    ${final[0].has_pattern}`);

  await client.close();
  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
