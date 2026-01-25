/**
 * Simple Extended Aftermath Population
 * Fetches reaction + event data, looks up H1 candles, updates in batches
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

async function getH1Close(pair: string, afterTime: Date): Promise<number | null> {
  const timeStr = afterTime.toISOString().replace("T", " ").slice(0, 19);
  const result = await client.query({
    query: `
      SELECT close FROM candles
      WHERE pair = {pair:String} AND timeframe = 'H1'
        AND time >= parseDateTimeBestEffort({timeStr:String})
      ORDER BY time ASC LIMIT 1
    `,
    query_params: { pair, timeStr },
    format: "JSONEachRow",
  });
  const rows = await result.json<Array<{ close: string }>>();
  return rows.length > 0 ? parseFloat(rows[0].close) : null;
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

  // spike_trend: continues in spike direction
  if (
    (spikeDir === "UP" && priceAt24hr > priceAtEvent) ||
    (spikeDir === "DOWN" && priceAt24hr < priceAtEvent)
  ) {
    return "spike_trend";
  }

  // mean_reversion: returns to baseline
  if (Math.abs(priceAt24hr - priceAtMinus15m) < spikeRange * 0.3) {
    return "mean_reversion";
  }

  // spike_trap_trend: reverses then reverses again
  if (priceAt8hr !== null) {
    if (
      (spikeDir === "UP" && priceAt8hr < priceAtEvent && priceAt24hr > priceAtEvent) ||
      (spikeDir === "DOWN" && priceAt8hr > priceAtEvent && priceAt24hr < priceAtEvent)
    ) {
      return "spike_trap_trend";
    }
  }

  // new_range: stays near event price
  if (Math.abs(priceAt24hr - priceAtEvent) < spikeRange * 0.5) {
    return "new_range";
  }

  return "";
}

async function main() {
  console.log("Populating extended aftermath (simple approach)...\n");

  // Get all reactions with event timestamps
  const reactionsResult = await client.query({
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
      WHERE r.price_t_plus_2hr IS NULL
      ORDER BY r.pair, e.timestamp
    `,
    format: "JSONEachRow",
  });
  const reactions = await reactionsResult.json<Reaction[]>();
  console.log(`Found ${reactions.length} reactions to process\n`);

  let processed = 0;
  let updated = 0;
  const batchSize = 100;
  const updates: Array<{
    event_id: string;
    pair: string;
    p2hr: number | null;
    p4hr: number | null;
    p8hr: number | null;
    p24hr: number | null;
    pattern: string;
  }> = [];

  for (const r of reactions) {
    const eventTime = new Date(r.event_time);

    // Get H1 closes at +2hr, +4hr, +8hr, +24hr
    const t2hr = new Date(eventTime.getTime() + 2 * 60 * 60 * 1000);
    const t4hr = new Date(eventTime.getTime() + 4 * 60 * 60 * 1000);
    const t8hr = new Date(eventTime.getTime() + 8 * 60 * 60 * 1000);
    const t24hr = new Date(eventTime.getTime() + 24 * 60 * 60 * 1000);

    const [p2hr, p4hr, p8hr, p24hr] = await Promise.all([
      getH1Close(r.pair, t2hr),
      getH1Close(r.pair, t4hr),
      getH1Close(r.pair, t8hr),
      getH1Close(r.pair, t24hr),
    ]);

    const pattern = classifyExtendedPattern(
      r.spike_direction,
      r.price_at_event,
      r.price_at_minus_15m,
      r.spike_high,
      r.spike_low,
      p8hr,
      p24hr
    );

    updates.push({ event_id: r.event_id, pair: r.pair, p2hr, p4hr, p8hr, p24hr, pattern });
    processed++;

    // Batch update
    if (updates.length >= batchSize || processed === reactions.length) {
      // Build UPDATE query for batch
      for (const u of updates) {
        try {
          await client.command({
            query: `
              ALTER TABLE event_price_reactions UPDATE
                price_t_plus_2hr = ${u.p2hr !== null ? u.p2hr : "NULL"},
                price_t_plus_4hr = ${u.p4hr !== null ? u.p4hr : "NULL"},
                price_t_plus_8hr = ${u.p8hr !== null ? u.p8hr : "NULL"},
                price_t_plus_24hr = ${u.p24hr !== null ? u.p24hr : "NULL"},
                extended_pattern_type = '${u.pattern}'
              WHERE event_id = '${u.event_id}' AND pair = '${u.pair}'
            `,
          });
          updated++;
        } catch (err) {
          // Skip errors
        }
      }
      updates.length = 0;

      if (processed % 500 === 0 || processed === reactions.length) {
        console.log(`Processed ${processed}/${reactions.length} (${updated} updated)`);
      }
    }
  }

  // Final check
  console.log("\nWaiting for mutations...");
  await new Promise((r) => setTimeout(r, 5000));

  const finalResult = await client.query({
    query: `
      SELECT
        count() as total,
        countIf(price_t_plus_2hr IS NOT NULL) as has_2hr,
        countIf(price_t_plus_24hr IS NOT NULL) as has_24hr
      FROM event_price_reactions
    `,
    format: "JSONEachRow",
  });
  const final = await finalResult.json<Array<{ total: string; has_2hr: string; has_24hr: string }>>();
  console.log(`\nFinal: ${final[0].total} total, ${final[0].has_2hr} with T+2hr, ${final[0].has_24hr} with T+24hr`);

  await client.close();
}

main().catch(console.error);
