/**
 * Extract price reactions from event_candle_windows
 * Populates event_price_reactions table with derived prices
 */

import { createClient } from "@clickhouse/client";
import * as dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env from project root
dotenv.config({ path: resolve(__dirname, "../../../.env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000, // 5 minutes for large queries
});

// Pip values for each pair
const PIP_VALUES: Record<string, number> = {
  EUR_USD: 0.0001,
  GBP_USD: 0.0001,
  USD_JPY: 0.01,
  USD_CHF: 0.0001,
  AUD_USD: 0.0001,
  USD_CAD: 0.0001,
  NZD_USD: 0.0001,
  EUR_GBP: 0.0001,
  EUR_JPY: 0.01,
  GBP_JPY: 0.01,
  XAU_USD: 0.01,
};

function getPipValue(pair: string): number {
  return PIP_VALUES[pair] || 0.0001;
}

async function extractReactions() {
  console.log("Starting price reaction extraction from event_candle_windows...\n");

  // First, check how many windows we have
  const countResult = await client.query({
    query: "SELECT count() as total FROM event_candle_windows",
    format: "JSONEachRow",
  });
  const countData = await countResult.json<{ total: string }[]>();
  const totalWindows = parseInt(countData[0].total);
  console.log(`Total windows to process: ${totalWindows.toLocaleString()}`);

  // Clear existing reactions
  console.log("\nClearing existing event_price_reactions...");
  await client.command({
    query: "TRUNCATE TABLE event_price_reactions",
  });

  // Process in batches by pair for efficiency
  const pairs = Object.keys(PIP_VALUES);
  let totalProcessed = 0;

  for (const pair of pairs) {
    const pipValue = getPipValue(pair);
    console.log(`\nProcessing ${pair} (pip value: ${pipValue})...`);

    // Insert reactions directly using ClickHouse SQL with subquery
    // This extracts prices from the candle arrays at specific indices
    const insertQuery = `
      INSERT INTO event_price_reactions
      SELECT
        event_id,
        pair,
        price_at_minus_15m,
        price_at_minus_5m,
        price_at_event,
        spike_high,
        spike_low,
        spike_direction,
        spike_magnitude_pips,
        time_to_spike_seconds,
        price_at_plus_5m,
        price_at_plus_15m,
        price_at_plus_30m,
        price_at_plus_60m,
        price_at_plus_90m,
        pattern_type,
        -- Did reverse: price at T+15 moved opposite to spike direction
        if(
          price_at_plus_15m IS NOT NULL,
          if(
            (spike_direction = 'UP' AND price_at_plus_15m < price_at_event) OR
            (spike_direction = 'DOWN' AND price_at_plus_15m > price_at_event),
            1,
            0
          ),
          0
        ) as did_reverse,
        -- Reversal magnitude
        if(
          price_at_plus_15m IS NOT NULL AND
          ((spike_direction = 'UP' AND price_at_plus_15m < price_at_event) OR
           (spike_direction = 'DOWN' AND price_at_plus_15m > price_at_event)),
          toDecimal64(abs(price_at_plus_15m - price_at_event) / ${pipValue}, 2),
          null
        ) as reversal_magnitude_pips,
        -- Final matches spike: settlement in same direction as spike from baseline
        if(
          price_at_plus_15m IS NOT NULL,
          if(
            (spike_direction = 'UP' AND price_at_plus_15m > price_at_minus_15m) OR
            (spike_direction = 'DOWN' AND price_at_plus_15m < price_at_minus_15m),
            1,
            0
          ),
          1
        ) as final_matches_spike,
        window_minutes,
        created_at
      FROM (
        SELECT
          w.event_id,
          w.pair,

          -- T-15 baseline (index 1 in 1-indexed array)
          candle_closes[1] as price_at_minus_15m,

          -- T-5 (index 11 for 30-min window)
          if(candle_count >= 11, candle_closes[11], null) as price_at_minus_5m,

          -- T+0 event time (index 16 for standard window - 15 minutes after start)
          if(candle_count >= 16, candle_closes[16], candle_closes[toUInt16(candle_count)]) as price_at_event,

          -- Spike high/low (max/min in first 21 candles, covering T-15 to T+5)
          arrayMax(arraySlice(candle_highs, 1, toUInt16(least(candle_count, 21)))) as spike_high,
          arrayMin(arraySlice(candle_lows, 1, toUInt16(least(candle_count, 21)))) as spike_low,

          -- Spike direction
          if(
            arrayMax(arraySlice(candle_highs, 1, toUInt16(least(candle_count, 21)))) - candle_closes[1] >
            candle_closes[1] - arrayMin(arraySlice(candle_lows, 1, toUInt16(least(candle_count, 21)))),
            'UP',
            'DOWN'
          ) as spike_direction,

          -- Spike magnitude in pips
          toDecimal64(
            greatest(
              arrayMax(arraySlice(candle_highs, 1, toUInt16(least(candle_count, 21)))) - candle_closes[1],
              candle_closes[1] - arrayMin(arraySlice(candle_lows, 1, toUInt16(least(candle_count, 21))))
            ) / ${pipValue},
            2
          ) as spike_magnitude_pips,

          -- Time to spike (simplified)
          toUInt32(300) as time_to_spike_seconds,

          -- T+5 settlement (index 21)
          if(candle_count >= 21, candle_closes[21], null) as price_at_plus_5m,

          -- T+15 settlement (index 31)
          if(candle_count >= 31, candle_closes[31], null) as price_at_plus_15m,

          -- T+30 settlement (index 46)
          if(candle_count >= 46, candle_closes[46], null) as price_at_plus_30m,

          -- T+60 settlement (index 76)
          if(candle_count >= 76, candle_closes[76], null) as price_at_plus_60m,

          -- T+90 settlement (index 106)
          if(candle_count >= 106, candle_closes[106], null) as price_at_plus_90m,

          -- Pattern type
          'SPIKE' as pattern_type,

          -- Window minutes
          toUInt16(candle_count) as window_minutes,

          now() as created_at

        FROM event_candle_windows w
        WHERE w.pair = '${pair}'
          AND candle_count >= 16
      )
    `;

    try {
      await client.command({ query: insertQuery });

      // Count inserted for this pair
      const pairCount = await client.query({
        query: `SELECT count() as cnt FROM event_price_reactions WHERE pair = '${pair}'`,
        format: "JSONEachRow",
      });
      const pairData = await pairCount.json<{ cnt: string }[]>();
      const inserted = parseInt(pairData[0].cnt);
      totalProcessed += inserted;
      console.log(`  Inserted ${inserted.toLocaleString()} reactions for ${pair}`);
    } catch (error) {
      console.error(`  Error processing ${pair}:`, error);
    }
  }

  console.log(`\nTotal reactions inserted: ${totalProcessed.toLocaleString()}`);

  // Verify final count
  const finalCount = await client.query({
    query: "SELECT count() as total FROM event_price_reactions",
    format: "JSONEachRow",
  });
  const finalData = await finalCount.json<{ total: string }[]>();
  console.log(`Verified count: ${parseInt(finalData[0].total).toLocaleString()}`);

  await client.close();
}

extractReactions().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
