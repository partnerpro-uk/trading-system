/**
 * Populate Extended Aftermath (T+2hr, T+4hr, T+8hr, T+24hr)
 *
 * Uses arrayJoin approach to avoid JOIN limitations in ClickHouse
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), "../.env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 600_000, // 10 minutes
});

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
  "XAU_USD",
  "SPX500_USD",
];

async function populateExtendedAftermath() {
  console.log("Populating extended aftermath prices from H1 candles...\n");

  try {
    // Get the count of reactions needing extended data
    const countResult = await client.query({
      query: `
        SELECT
          count() as total,
          countIf(price_t_plus_2hr IS NOT NULL) as has_2hr,
          countIf(price_t_plus_24hr IS NOT NULL) as has_24hr
        FROM event_price_reactions
      `,
      format: "JSONEachRow",
    });
    const countData = await countResult.json<Array<{ total: string; has_2hr: string; has_24hr: string }>>();
    console.log(`Current state: ${countData[0].total} reactions, ${countData[0].has_2hr} with T+2hr, ${countData[0].has_24hr} with T+24hr\n`);

    // For each pair, fetch reactions with event timestamps, then for each one look up H1 candles
    for (const pair of PAIRS) {
      console.log(`Processing ${pair}...`);

      // Get all reactions for this pair with event timestamps
      const reactionsResult = await client.query({
        query: `
          SELECT
            r.event_id,
            e.timestamp as event_time,
            r.spike_direction,
            r.price_at_event,
            r.price_at_minus_15m,
            r.spike_high,
            r.spike_low
          FROM event_price_reactions r
          INNER JOIN news_events e ON r.event_id = e.event_id
          WHERE r.pair = {pair:String}
        `,
        query_params: { pair },
        format: "JSONEachRow",
      });
      const reactions = await reactionsResult.json<Array<{
        event_id: string;
        event_time: string;
        spike_direction: string;
        price_at_event: string;
        price_at_minus_15m: string;
        spike_high: string;
        spike_low: string;
      }>>();

      console.log(`  ${reactions.length} reactions to process`);

      if (reactions.length === 0) continue;

      // Create staging table
      const tableName = `temp_ext_${pair.replace("_", "")}`;
      await client.command({
        query: `
          CREATE TABLE IF NOT EXISTS ${tableName} (
            event_id String,
            price_t_plus_2hr Nullable(Decimal(10, 5)),
            price_t_plus_4hr Nullable(Decimal(10, 5)),
            price_t_plus_8hr Nullable(Decimal(10, 5)),
            price_t_plus_24hr Nullable(Decimal(10, 5)),
            extended_pattern_type LowCardinality(String)
          ) ENGINE = MergeTree() ORDER BY event_id
        `,
      });
      await client.command({ query: `TRUNCATE TABLE ${tableName}` });

      // Process in batches of 500
      const batchSize = 500;
      let processed = 0;

      for (let i = 0; i < reactions.length; i += batchSize) {
        const batch = reactions.slice(i, i + batchSize);

        // Build a UNION ALL query to lookup each candle
        const lookups = batch.map((r) => {
          const eventTime = r.event_time.replace("T", " ").replace("Z", "");
          return `
            SELECT
              '${r.event_id}' as event_id,
              (SELECT close FROM candles WHERE pair = '${pair}' AND timeframe = 'H1'
                AND time >= parseDateTimeBestEffort('${eventTime}') + INTERVAL 2 HOUR
                AND time < parseDateTimeBestEffort('${eventTime}') + INTERVAL 3 HOUR LIMIT 1) as price_t_plus_2hr,
              (SELECT close FROM candles WHERE pair = '${pair}' AND timeframe = 'H1'
                AND time >= parseDateTimeBestEffort('${eventTime}') + INTERVAL 4 HOUR
                AND time < parseDateTimeBestEffort('${eventTime}') + INTERVAL 5 HOUR LIMIT 1) as price_t_plus_4hr,
              (SELECT close FROM candles WHERE pair = '${pair}' AND timeframe = 'H1'
                AND time >= parseDateTimeBestEffort('${eventTime}') + INTERVAL 8 HOUR
                AND time < parseDateTimeBestEffort('${eventTime}') + INTERVAL 9 HOUR LIMIT 1) as price_t_plus_8hr,
              (SELECT close FROM candles WHERE pair = '${pair}' AND timeframe = 'H1'
                AND time >= parseDateTimeBestEffort('${eventTime}') + INTERVAL 24 HOUR
                AND time < parseDateTimeBestEffort('${eventTime}') + INTERVAL 25 HOUR LIMIT 1) as price_t_plus_24hr,
              multiIf(
                price_t_plus_24hr IS NOT NULL AND (
                  ('${r.spike_direction}' = 'UP' AND price_t_plus_24hr > ${r.price_at_event}) OR
                  ('${r.spike_direction}' = 'DOWN' AND price_t_plus_24hr < ${r.price_at_event})
                ), 'spike_trend',
                price_t_plus_24hr IS NOT NULL AND abs(price_t_plus_24hr - ${r.price_at_minus_15m}) < abs(${r.spike_high} - ${r.spike_low}) * 0.3, 'mean_reversion',
                price_t_plus_8hr IS NOT NULL AND price_t_plus_24hr IS NOT NULL AND (
                  ('${r.spike_direction}' = 'UP' AND price_t_plus_8hr < ${r.price_at_event} AND price_t_plus_24hr > ${r.price_at_event}) OR
                  ('${r.spike_direction}' = 'DOWN' AND price_t_plus_8hr > ${r.price_at_event} AND price_t_plus_24hr < ${r.price_at_event})
                ), 'spike_trap_trend',
                price_t_plus_24hr IS NOT NULL AND abs(price_t_plus_24hr - ${r.price_at_event}) < abs(${r.spike_high} - ${r.spike_low}) * 0.5, 'new_range',
                ''
              ) as extended_pattern_type
          `;
        });

        const insertQuery = `INSERT INTO ${tableName} ${lookups.join(" UNION ALL ")}`;

        try {
          await client.command({ query: insertQuery });
        } catch (err) {
          console.error(`  Error in batch at index ${i}:`, err);
        }

        processed += batch.length;
        if (processed % 1000 === 0 || processed === reactions.length) {
          console.log(`  Processed ${processed}/${reactions.length}`);
        }
      }

      // Apply updates from staging table
      console.log(`  Applying updates...`);
      await client.command({
        query: `
          ALTER TABLE event_price_reactions
          UPDATE
            price_t_plus_2hr = t.price_t_plus_2hr,
            price_t_plus_4hr = t.price_t_plus_4hr,
            price_t_plus_8hr = t.price_t_plus_8hr,
            price_t_plus_24hr = t.price_t_plus_24hr,
            extended_pattern_type = t.extended_pattern_type
          FROM ${tableName} t
          WHERE event_price_reactions.event_id = t.event_id
            AND event_price_reactions.pair = '${pair}'
        `,
      });

      // Drop staging table
      await client.command({ query: `DROP TABLE IF EXISTS ${tableName}` });

      console.log(`  ${pair} done\n`);
    }

    // Wait for mutations
    console.log("Waiting for mutations to complete...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // Final count
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
    const finalData = await finalResult.json<Array<{ total: string; has_2hr: string; has_24hr: string; has_pattern: string }>>();
    console.log(`\nFinal state: ${finalData[0].total} reactions`);
    console.log(`  With T+2hr:  ${finalData[0].has_2hr}`);
    console.log(`  With T+24hr: ${finalData[0].has_24hr}`);
    console.log(`  With extended pattern: ${finalData[0].has_pattern}`);

    console.log("\nDone!");

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
  }
}

populateExtendedAftermath().catch(console.error);
