/**
 * Compute event_type_statistics from event_price_reactions
 * Aggregates statistics per event_type + pair combination
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
  request_timeout: 300000,
});

async function computeStatistics() {
  console.log("Computing event_type_statistics from event_price_reactions...\n");

  // Check reaction counts
  const countResult = await client.query({
    query: "SELECT count() as total FROM event_price_reactions",
    format: "JSONEachRow",
  });
  const countData = await countResult.json<{ total: string }[]>();
  console.log(`Total reactions to aggregate: ${parseInt(countData[0].total).toLocaleString()}`);

  // Clear existing statistics
  console.log("\nClearing existing event_type_statistics...");
  await client.command({
    query: "TRUNCATE TABLE event_type_statistics",
  });

  // Compute statistics using a single SQL aggregation
  // Join with news_events to get event_type and beat/miss classification
  console.log("\nComputing statistics...");

  // Full statistics with all 29 columns including beat/miss breakdown
  const insertQuery = `
    INSERT INTO event_type_statistics (
      event_type, pair, sample_size, date_range_start, date_range_end,
      avg_spike_pips, median_spike_pips, max_spike_pips, min_spike_pips, stddev_spike_pips,
      spike_up_count, spike_down_count, spike_up_pct,
      reversal_within_15m_count, reversal_within_30m_count, reversal_within_60m_count,
      reversal_within_15m_pct, reversal_within_30m_pct, reversal_within_60m_pct,
      final_matches_spike_count, final_matches_spike_pct,
      avg_spike_when_no_surprise, avg_spike_when_surprise,
      beat_count, miss_count, inline_count, avg_spike_on_beat, avg_spike_on_miss,
      last_updated
    )
    SELECT
      e.event_type,
      r.pair,

      -- Sample info
      toUInt32(count()) as sample_size,
      min(e.timestamp) as date_range_start,
      max(e.timestamp) as date_range_end,

      -- Spike statistics
      toDecimal64(avg(r.spike_magnitude_pips), 2) as avg_spike_pips,
      toDecimal64(quantile(0.5)(r.spike_magnitude_pips), 2) as median_spike_pips,
      toDecimal64(max(r.spike_magnitude_pips), 2) as max_spike_pips,
      toDecimal64(min(r.spike_magnitude_pips), 2) as min_spike_pips,
      toDecimal64(stddevPop(r.spike_magnitude_pips), 2) as stddev_spike_pips,

      -- Direction statistics
      toUInt32(countIf(r.spike_direction = 'UP')) as spike_up_count,
      toUInt32(countIf(r.spike_direction = 'DOWN')) as spike_down_count,
      toDecimal64(
        countIf(r.spike_direction = 'UP') * 100.0 / count(),
        2
      ) as spike_up_pct,

      -- Reversal statistics (using did_reverse flag)
      toUInt32(countIf(r.did_reverse = 1)) as reversal_within_15m_count,
      toUInt32(countIf(r.did_reverse = 1)) as reversal_within_30m_count,
      toUInt32(countIf(r.did_reverse = 1)) as reversal_within_60m_count,
      toDecimal64(countIf(r.did_reverse = 1) * 100.0 / count(), 2) as reversal_within_15m_pct,
      toDecimal64(countIf(r.did_reverse = 1) * 100.0 / count(), 2) as reversal_within_30m_pct,
      toDecimal64(countIf(r.did_reverse = 1) * 100.0 / count(), 2) as reversal_within_60m_pct,

      -- Final direction
      toUInt32(countIf(r.final_matches_spike = 1)) as final_matches_spike_count,
      toDecimal64(countIf(r.final_matches_spike = 1) * 100.0 / count(), 2) as final_matches_spike_pct,

      -- Surprise correlation (use if(isFinite) to handle NaN)
      if(isFinite(avgIf(r.spike_magnitude_pips, e.actual = e.forecast OR e.forecast IS NULL)),
         toDecimal64(avgIf(r.spike_magnitude_pips, e.actual = e.forecast OR e.forecast IS NULL), 2),
         toDecimal64(0, 2)) as avg_spike_when_no_surprise,
      if(isFinite(avgIf(r.spike_magnitude_pips, e.actual != e.forecast AND e.forecast IS NOT NULL)),
         toDecimal64(avgIf(r.spike_magnitude_pips, e.actual != e.forecast AND e.forecast IS NOT NULL), 2),
         toDecimal64(0, 2)) as avg_spike_when_surprise,

      -- Beat/Miss breakdown
      toUInt32(countIf(
        e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
        toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) > toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))
      )) as beat_count,
      toUInt32(countIf(
        e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
        toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) < toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))
      )) as miss_count,
      toUInt32(countIf(
        e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
        toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) = toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))
      )) as inline_count,

      -- Avg spike on beat/miss (use if() to handle NaN/Inf)
      if(
        countIf(e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
          toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) > toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))) > 0,
        toDecimal64(avgIf(
          r.spike_magnitude_pips,
          e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
          toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) > toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))
        ), 2),
        null
      ) as avg_spike_on_beat,
      if(
        countIf(e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
          toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) < toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))) > 0,
        toDecimal64(avgIf(
          r.spike_magnitude_pips,
          e.forecast IS NOT NULL AND e.actual IS NOT NULL AND
          toFloat64OrNull(replaceRegexpAll(e.actual, '[^0-9.-]', '')) < toFloat64OrNull(replaceRegexpAll(e.forecast, '[^0-9.-]', ''))
        ), 2),
        null
      ) as avg_spike_on_miss,

      now() as last_updated

    FROM event_price_reactions r
    INNER JOIN news_events e ON r.event_id = e.event_id
    GROUP BY e.event_type, r.pair
    HAVING count() >= 5  -- Only include event types with at least 5 occurrences
  `;

  try {
    await client.command({ query: insertQuery });
    console.log("Statistics computed successfully!");
  } catch (error) {
    console.error("Error computing statistics:", error);
    throw error;
  }

  // Verify results
  const statsCount = await client.query({
    query: "SELECT count() as total FROM event_type_statistics",
    format: "JSONEachRow",
  });
  const statsData = await statsCount.json<{ total: string }[]>();
  console.log(`\nTotal event_type + pair combinations: ${parseInt(statsData[0].total).toLocaleString()}`);

  // Show sample statistics
  const sampleStats = await client.query({
    query: `
      SELECT
        event_type,
        pair,
        sample_size,
        avg_spike_pips,
        spike_up_pct,
        reversal_within_15m_pct
      FROM event_type_statistics
      ORDER BY sample_size DESC
      LIMIT 10
    `,
    format: "JSONEachRow",
  });
  const sampleData = await sampleStats.json();
  console.log("\nTop 10 event types by sample size:");
  console.table(sampleData);

  await client.close();
}

computeStatistics().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
