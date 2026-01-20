#!/usr/bin/env npx tsx
/**
 * Verify migration data integrity
 * Compares counts between Convex and new databases
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@clickhouse/client";
import pg from "pg";
import { api } from "../../convex/_generated/api";

config({ path: ".env.local" });

const PAIRS = [
  "EUR_USD",
  "GBP_USD",
  "USD_JPY",
  "USD_CHF",
  "AUD_USD",
  "USD_CAD",
  "NZD_USD",
];

const TIMEFRAMES = ["M5", "M15", "H1", "H4", "D"];

// Convex client
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Postgres client
const { Client } = pg;

async function main() {
  console.log("═".repeat(60));
  console.log("  MIGRATION VERIFICATION");
  console.log("═".repeat(60));
  console.log();

  // Connect to databases
  const pgClient = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  console.log("✓ Connected to Timescale Cloud");
  console.log("✓ Connected to ClickHouse");
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // CANDLES VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("─".repeat(60));
  console.log("CANDLES");
  console.log("─".repeat(60));
  console.log();

  console.log("Convex candle counts (sampled):");
  for (const pair of PAIRS.slice(0, 3)) {
    for (const tf of TIMEFRAMES.slice(0, 2)) {
      const stats = await convex.query(api.candles.getCandleStats, { pair, timeframe: tf });
      console.log(`  ${pair} ${tf}: ${stats.oldest?.date} to ${stats.newest?.date}`);
    }
  }
  console.log();

  console.log("ClickHouse candle counts:");
  const chCandleCount = await clickhouse.query({
    query: `
      SELECT pair, timeframe, count(*) as count,
             min(time) as oldest, max(time) as newest
      FROM candles
      GROUP BY pair, timeframe
      ORDER BY pair, timeframe
    `,
    format: "JSONEachRow",
  });
  const chCandles = (await chCandleCount.json()) as any[];
  let totalChCandles = 0;
  for (const row of chCandles) {
    console.log(`  ${row.pair} ${row.timeframe}: ${row.count} (${row.oldest} to ${row.newest})`);
    totalChCandles += parseInt(row.count);
  }
  console.log(`  TOTAL: ${totalChCandles.toLocaleString()}`);
  console.log();

  console.log("Timescale candle counts (recent):");
  const tsCandleCount = await pgClient.query(`
    SELECT pair, timeframe, count(*) as count,
           min(time) as oldest, max(time) as newest
    FROM candles
    GROUP BY pair, timeframe
    ORDER BY pair, timeframe
  `);
  let totalTsCandles = 0;
  for (const row of tsCandleCount.rows) {
    console.log(`  ${row.pair} ${row.timeframe}: ${row.count}`);
    totalTsCandles += parseInt(row.count);
  }
  console.log(`  TOTAL: ${totalTsCandles.toLocaleString()}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // NEWS VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("─".repeat(60));
  console.log("NEWS EVENTS");
  console.log("─".repeat(60));
  console.log();

  // Convex event counts
  const convexEventSummary = await convex.query(api.newsQueries.getEventsSummary, {});
  console.log(`Convex events: ${convexEventSummary.totalEvents}`);

  // Timescale event counts
  const tsEventCount = await pgClient.query("SELECT count(*) FROM news_events");
  console.log(`Timescale events: ${tsEventCount.rows[0].count}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // REACTIONS VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("─".repeat(60));
  console.log("PRICE REACTIONS");
  console.log("─".repeat(60));
  console.log();

  // Convex reaction counts
  const convexReactions = await convex.query(api.newsQueries.getTotalReactionsCount, {});
  console.log(`Convex reactions: ${convexReactions.totalReactions}`);

  // Timescale reaction counts
  const tsReactionCount = await pgClient.query("SELECT count(*) FROM event_price_reactions");
  console.log(`Timescale reactions: ${tsReactionCount.rows[0].count}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // CANDLE WINDOWS VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("─".repeat(60));
  console.log("CANDLE WINDOWS");
  console.log("─".repeat(60));
  console.log();

  // Convex window counts (completed events)
  const convexWindows = await convex.query(api.newsEvents.getCompletedEventIds, { limit: 100000 });
  console.log(`Convex completed events: ${convexWindows.eventIds.length}`);

  // ClickHouse window counts
  const chWindowCount = await clickhouse.query({
    query: "SELECT count(*) as count FROM event_candle_windows",
    format: "JSONEachRow",
  });
  const chWindows = (await chWindowCount.json()) as any[];
  console.log(`ClickHouse windows: ${chWindows[0].count}`);
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTINUOUS AGGREGATES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("─".repeat(60));
  console.log("CONTINUOUS AGGREGATES");
  console.log("─".repeat(60));
  console.log();

  const aggregates = ["candles_m5", "candles_m15", "candles_h1", "candles_h4", "candles_d1"];
  for (const agg of aggregates) {
    try {
      const result = await pgClient.query(`SELECT count(*) FROM ${agg}`);
      console.log(`  ${agg}: ${result.rows[0].count} rows`);
    } catch (err: any) {
      console.log(`  ${agg}: Error - ${err.message}`);
    }
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("═".repeat(60));
  console.log("  VERIFICATION SUMMARY");
  console.log("═".repeat(60));
  console.log();

  const issues = [];

  if (totalChCandles < 7000000) {
    issues.push(`ClickHouse candles: ${totalChCandles.toLocaleString()} (expected ~7.8M)`);
  }

  if (parseInt(tsEventCount.rows[0].count) < 15000) {
    issues.push(`Timescale events: ${tsEventCount.rows[0].count} (expected ~18K)`);
  }

  if (parseInt(chWindows[0].count) < 400000) {
    issues.push(`ClickHouse windows: ${chWindows[0].count} (expected ~580K)`);
  }

  if (issues.length === 0) {
    console.log("✓ All data counts look healthy!");
  } else {
    console.log("⚠️ Potential issues found:");
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }
  console.log();

  await pgClient.end();
  await clickhouse.close();
}

main().catch(console.error);
