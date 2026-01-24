/**
 * Extract price reactions from event_candle_windows
 * Populates event_price_reactions table with derived prices
 *
 * Pattern Classification:
 * - spike_reversal: Initial spike fully reverses within T+1hr (opposite direction, >80% magnitude)
 * - continuation: Spike continues in same direction through T+1hr (>80% of spike magnitude)
 * - fade: Partial reversal (30-70% of spike)
 * - range: No significant movement (spike < 10 pips, T+1hr change < 15 pips)
 * - delayed_reaction: Small initial spike but big T+30m move
 * - trap: Default fallback
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
  SPX500_USD: 0.1,
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
    // Pattern classification based on spike vs T+1hr behavior
    const insertQuery = `
      INSERT INTO event_price_reactions (
        event_id, pair, price_at_minus_15m, price_at_minus_5m, price_at_event,
        spike_high, spike_low, spike_direction, spike_magnitude_pips, time_to_spike_seconds,
        price_at_plus_5m, price_at_plus_15m, price_at_plus_30m, price_at_plus_60m, price_at_plus_90m,
        pattern_type, did_reverse, reversal_magnitude_pips, final_matches_spike, window_minutes, created_at
      )
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
        -- Pattern classification based on spike vs T+1hr (or T+30m if no T+60)
        multiIf(
          -- Range: small spike and small T+1hr change
          spike_magnitude_pips < 10 AND abs(t1hr_change_pips) < 15, 'range',
          -- Delayed reaction: small spike but big T+30m move
          spike_magnitude_pips < 15 AND abs(t30m_change_pips) > 30, 'delayed_reaction',
          -- Continuation: T+1hr still moving in spike direction, > 80% of spike magnitude
          (spike_direction = 'UP' AND t1hr_change_pips > spike_magnitude_pips * 0.8) OR
          (spike_direction = 'DOWN' AND t1hr_change_pips < -spike_magnitude_pips * 0.8), 'continuation',
          -- Spike reversal: opposite direction at T+1hr, > 80% of spike magnitude
          (spike_direction = 'UP' AND t1hr_change_pips < -spike_magnitude_pips * 0.8) OR
          (spike_direction = 'DOWN' AND t1hr_change_pips > spike_magnitude_pips * 0.8), 'spike_reversal',
          -- Fade: partial reversal (30-70%)
          (spike_direction = 'UP' AND t1hr_change_pips < -spike_magnitude_pips * 0.3) OR
          (spike_direction = 'DOWN' AND t1hr_change_pips > spike_magnitude_pips * 0.3), 'fade',
          -- Default
          'trap'
        ) as pattern_type,
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

          -- Change from event to T+30m (in pips, for pattern classification)
          toDecimal64(
            if(candle_count >= 46,
              (candle_closes[46] - if(candle_count >= 16, candle_closes[16], candle_closes[toUInt16(candle_count)])) / ${pipValue},
              0
            ),
            2
          ) as t30m_change_pips,

          -- Change from event to T+1hr (in pips, for pattern classification)
          toDecimal64(
            if(candle_count >= 76,
              (candle_closes[76] - if(candle_count >= 16, candle_closes[16], candle_closes[toUInt16(candle_count)])) / ${pipValue},
              if(candle_count >= 46,
                (candle_closes[46] - if(candle_count >= 16, candle_closes[16], candle_closes[toUInt16(candle_count)])) / ${pipValue},
                0
              )
            ),
            2
          ) as t1hr_change_pips,

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

  // Step 2: Populate extended aftermath (T+2hr, T+4hr, T+8hr, T+24hr) from H1 candles
  console.log("\n━━━ Populating extended aftermath from H1 candles ━━━\n");
  await populateExtendedAftermath();

  await client.close();
}

/**
 * Populate T+2hr, T+4hr, T+8hr, T+24hr prices from existing H1 candles
 * Uses the candles table which already has all historical H1 data
 */
async function populateExtendedAftermath() {
  console.log("Joining event_price_reactions with H1 candles for extended aftermath...\n");

  // For each reaction, find the H1 candles at T+2, T+4, T+8, T+24 hours
  // We need to get the event timestamp from news_events and find matching H1 candles
  const updateQuery = `
    ALTER TABLE event_price_reactions
    UPDATE
      price_t_plus_2hr = h2.close,
      price_t_plus_4hr = h4.close,
      price_t_plus_8hr = h8.close,
      price_t_plus_24hr = h24.close,
      extended_pattern_type = multiIf(
        -- spike_trend: spike direction continues through T+24hr
        h24.close IS NOT NULL AND (
          (r.spike_direction = 'UP' AND h24.close > r.price_at_event) OR
          (r.spike_direction = 'DOWN' AND h24.close < r.price_at_event)
        ), 'spike_trend',
        -- mean_reversion: returns to pre-event price by T+24hr
        h24.close IS NOT NULL AND abs(h24.close - r.price_at_minus_15m) < abs(r.spike_high - r.spike_low) * 0.3, 'mean_reversion',
        -- spike_trap_trend: spike reverses, then reverses again to original direction
        h8.close IS NOT NULL AND h24.close IS NOT NULL AND (
          (r.spike_direction = 'UP' AND h8.close < r.price_at_event AND h24.close > r.price_at_event) OR
          (r.spike_direction = 'DOWN' AND h8.close > r.price_at_event AND h24.close < r.price_at_event)
        ), 'spike_trap_trend',
        -- new_range: establishes new range at spike level
        h24.close IS NOT NULL AND abs(h24.close - r.price_at_event) < abs(r.spike_high - r.spike_low) * 0.5, 'new_range',
        ''
      )
    FROM event_price_reactions r
    INNER JOIN news_events e ON r.event_id = e.event_id
    LEFT JOIN candles h2 ON h2.pair = r.pair AND h2.timeframe = 'H1'
      AND h2.time >= e.timestamp + INTERVAL 2 HOUR
      AND h2.time < e.timestamp + INTERVAL 3 HOUR
    LEFT JOIN candles h4 ON h4.pair = r.pair AND h4.timeframe = 'H1'
      AND h4.time >= e.timestamp + INTERVAL 4 HOUR
      AND h4.time < e.timestamp + INTERVAL 5 HOUR
    LEFT JOIN candles h8 ON h8.pair = r.pair AND h8.timeframe = 'H1'
      AND h8.time >= e.timestamp + INTERVAL 8 HOUR
      AND h8.time < e.timestamp + INTERVAL 9 HOUR
    LEFT JOIN candles h24 ON h24.pair = r.pair AND h24.timeframe = 'H1'
      AND h24.time >= e.timestamp + INTERVAL 24 HOUR
      AND h24.time < e.timestamp + INTERVAL 25 HOUR
    WHERE r.event_id = event_price_reactions.event_id
      AND r.pair = event_price_reactions.pair
  `;

  try {
    // ClickHouse doesn't support UPDATE with JOINs directly, so we use a different approach
    // We'll do this in batches using INSERT ... SELECT with REPLACE semantics

    console.log("Fetching extended aftermath prices from H1 candles...");

    // First, create a temp table with the extended data
    await client.command({
      query: `
        CREATE TEMPORARY TABLE IF NOT EXISTS temp_extended_aftermath (
          event_id String,
          pair LowCardinality(String),
          price_t_plus_2hr Nullable(Decimal(10, 5)),
          price_t_plus_4hr Nullable(Decimal(10, 5)),
          price_t_plus_8hr Nullable(Decimal(10, 5)),
          price_t_plus_24hr Nullable(Decimal(10, 5)),
          extended_pattern_type LowCardinality(String)
        )
      `,
    });

    // Populate temp table with H1 data
    const populateTemp = `
      INSERT INTO temp_extended_aftermath
      SELECT
        r.event_id,
        r.pair,
        h2.close as price_t_plus_2hr,
        h4.close as price_t_plus_4hr,
        h8.close as price_t_plus_8hr,
        h24.close as price_t_plus_24hr,
        multiIf(
          -- spike_trend: spike direction continues through T+24hr
          h24.close IS NOT NULL AND (
            (r.spike_direction = 'UP' AND h24.close > r.price_at_event) OR
            (r.spike_direction = 'DOWN' AND h24.close < r.price_at_event)
          ), 'spike_trend',
          -- mean_reversion: returns to pre-event price by T+24hr
          h24.close IS NOT NULL AND abs(h24.close - r.price_at_minus_15m) < abs(r.spike_high - r.spike_low) * 0.3, 'mean_reversion',
          -- spike_trap_trend: spike reverses, then reverses again
          h8.close IS NOT NULL AND h24.close IS NOT NULL AND (
            (r.spike_direction = 'UP' AND h8.close < r.price_at_event AND h24.close > r.price_at_event) OR
            (r.spike_direction = 'DOWN' AND h8.close > r.price_at_event AND h24.close < r.price_at_event)
          ), 'spike_trap_trend',
          -- new_range: establishes new range at spike level
          h24.close IS NOT NULL AND abs(h24.close - r.price_at_event) < abs(r.spike_high - r.spike_low) * 0.5, 'new_range',
          ''
        ) as extended_pattern_type
      FROM event_price_reactions r
      INNER JOIN news_events e ON r.event_id = e.event_id
      LEFT JOIN (
        SELECT pair, time, close
        FROM candles
        WHERE timeframe = 'H1'
      ) h2 ON h2.pair = r.pair
        AND h2.time >= toDateTime64(e.timestamp, 3) + INTERVAL 2 HOUR
        AND h2.time < toDateTime64(e.timestamp, 3) + INTERVAL 3 HOUR
      LEFT JOIN (
        SELECT pair, time, close
        FROM candles
        WHERE timeframe = 'H1'
      ) h4 ON h4.pair = r.pair
        AND h4.time >= toDateTime64(e.timestamp, 3) + INTERVAL 4 HOUR
        AND h4.time < toDateTime64(e.timestamp, 3) + INTERVAL 5 HOUR
      LEFT JOIN (
        SELECT pair, time, close
        FROM candles
        WHERE timeframe = 'H1'
      ) h8 ON h8.pair = r.pair
        AND h8.time >= toDateTime64(e.timestamp, 3) + INTERVAL 8 HOUR
        AND h8.time < toDateTime64(e.timestamp, 3) + INTERVAL 9 HOUR
      LEFT JOIN (
        SELECT pair, time, close
        FROM candles
        WHERE timeframe = 'H1'
      ) h24 ON h24.pair = r.pair
        AND h24.time >= toDateTime64(e.timestamp, 3) + INTERVAL 24 HOUR
        AND h24.time < toDateTime64(e.timestamp, 3) + INTERVAL 25 HOUR
    `;

    console.log("  Building extended aftermath data from H1 candles...");
    await client.command({ query: populateTemp });

    // Count how many we got
    const countResult = await client.query({
      query: "SELECT count() as total, countIf(price_t_plus_24hr IS NOT NULL) as with_24hr FROM temp_extended_aftermath",
      format: "JSONEachRow",
    });
    const countData = await countResult.json<{ total: string; with_24hr: string }[]>();
    console.log(`  Computed ${countData[0].total} extended aftermath records (${countData[0].with_24hr} with T+24hr data)`);

    // Update the main table using ALTER TABLE UPDATE
    console.log("  Updating event_price_reactions with extended data...");
    await client.command({
      query: `
        ALTER TABLE event_price_reactions
        UPDATE
          price_t_plus_2hr = t.price_t_plus_2hr,
          price_t_plus_4hr = t.price_t_plus_4hr,
          price_t_plus_8hr = t.price_t_plus_8hr,
          price_t_plus_24hr = t.price_t_plus_24hr,
          extended_pattern_type = t.extended_pattern_type
        FROM temp_extended_aftermath t
        WHERE event_price_reactions.event_id = t.event_id
          AND event_price_reactions.pair = t.pair
      `,
    });

    console.log("  Extended aftermath populated successfully!");
  } catch (error) {
    console.error("Error populating extended aftermath:", error);
    // Non-fatal - the core reactions are already inserted
  }
}

extractReactions().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
