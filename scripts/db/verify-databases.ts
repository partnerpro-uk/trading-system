#!/usr/bin/env npx tsx
/**
 * Verify database state after migration
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";
import pg from "pg";

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

async function main() {
  console.log("═".repeat(60));
  console.log("  DATABASE VERIFICATION");
  console.log("═".repeat(60));
  console.log();

  // ClickHouse client
  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER!,
    password: process.env.CLICKHOUSE_PASSWORD!,
  });

  // Postgres client
  const pgClient = new pg.Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pgClient.connect();

  // ═══════════════════════════════════════════════════════════════
  // CLICKHOUSE: Candles
  // ═══════════════════════════════════════════════════════════════
  console.log("CLICKHOUSE - CANDLES:");
  console.log("-".repeat(50));

  const chCandlesResult = await clickhouse.query({
    query: `
      SELECT
        pair,
        timeframe,
        count(*) as count,
        min(time) as first,
        max(time) as last
      FROM candles
      GROUP BY pair, timeframe
      ORDER BY pair, timeframe
    `,
    format: "JSONEachRow",
  });

  const chCandles = await chCandlesResult.json<{
    pair: string;
    timeframe: string;
    count: string;
    first: string;
    last: string;
  }>();

  let totalCandles = 0;
  for (const row of chCandles) {
    const count = parseInt(row.count);
    totalCandles += count;
    console.log(
      `  ${row.pair.padEnd(10)} ${row.timeframe.padEnd(5)} ${count.toLocaleString().padStart(12)} candles  (${row.first.slice(0, 10)} to ${row.last.slice(0, 10)})`
    );
  }
  console.log(`\n  TOTAL: ${totalCandles.toLocaleString()} candles\n`);

  // ═══════════════════════════════════════════════════════════════
  // CLICKHOUSE: Event Windows
  // ═══════════════════════════════════════════════════════════════
  console.log("CLICKHOUSE - EVENT WINDOWS:");
  console.log("-".repeat(50));

  const chWindowsResult = await clickhouse.query({
    query: `SELECT count(*) as count FROM event_candle_windows`,
    format: "JSONEachRow",
  });
  const chWindows = await chWindowsResult.json<{ count: string }>();
  console.log(`  Total: ${parseInt(chWindows[0].count).toLocaleString()} event windows\n`);

  // ═══════════════════════════════════════════════════════════════
  // TIMESCALE: News Events
  // ═══════════════════════════════════════════════════════════════
  console.log("TIMESCALE - NEWS EVENTS:");
  console.log("-".repeat(50));

  const newsResult = await pgClient.query(`
    SELECT
      currency,
      impact,
      count(*) as count
    FROM news_events
    GROUP BY currency, impact
    ORDER BY count DESC
    LIMIT 10
  `);

  const totalNewsResult = await pgClient.query(`SELECT count(*) FROM news_events`);
  console.log(`  Total: ${parseInt(totalNewsResult.rows[0].count).toLocaleString()} events`);
  console.log(`  Top currencies/impacts:`);
  for (const row of newsResult.rows) {
    console.log(`    ${row.currency} ${row.impact}: ${parseInt(row.count).toLocaleString()}`);
  }
  console.log();

  // ═══════════════════════════════════════════════════════════════
  // TIMESCALE: Sessions
  // ═══════════════════════════════════════════════════════════════
  console.log("TIMESCALE - SESSION LEVELS:");
  console.log("-".repeat(50));

  const sessionsResult = await pgClient.query(`
    SELECT
      pair,
      count(*) as count,
      min(date) as first,
      max(date) as last
    FROM session_levels
    GROUP BY pair
    ORDER BY pair
  `);

  let totalSessions = 0;
  for (const row of sessionsResult.rows) {
    const count = parseInt(row.count);
    totalSessions += count;
    console.log(
      `  ${row.pair.padEnd(10)} ${count.toLocaleString().padStart(6)} days  (${row.first.toISOString().slice(0, 10)} to ${row.last.toISOString().slice(0, 10)})`
    );
  }
  console.log(`\n  TOTAL: ${totalSessions.toLocaleString()} session days\n`);

  // ═══════════════════════════════════════════════════════════════
  // TIMESCALE: Price Reactions
  // ═══════════════════════════════════════════════════════════════
  console.log("TIMESCALE - PRICE REACTIONS:");
  console.log("-".repeat(50));

  const reactionsResult = await pgClient.query(`
    SELECT
      pair,
      count(*) as count
    FROM event_price_reactions
    GROUP BY pair
    ORDER BY pair
  `);

  let totalReactions = 0;
  for (const row of reactionsResult.rows) {
    const count = parseInt(row.count);
    totalReactions += count;
    console.log(`  ${row.pair.padEnd(10)} ${count.toLocaleString().padStart(8)} reactions`);
  }
  console.log(`\n  TOTAL: ${totalReactions.toLocaleString()} price reactions\n`);

  // ═══════════════════════════════════════════════════════════════
  // TIMESCALE: Candles (live data)
  // ═══════════════════════════════════════════════════════════════
  console.log("TIMESCALE - CANDLES (Live):");
  console.log("-".repeat(50));

  const tsCandlesResult = await pgClient.query(`
    SELECT
      pair,
      timeframe,
      count(*) as count
    FROM candles
    GROUP BY pair, timeframe
    ORDER BY pair, timeframe
  `);

  let tsTotal = 0;
  for (const row of tsCandlesResult.rows) {
    const count = parseInt(row.count);
    tsTotal += count;
    console.log(`  ${row.pair.padEnd(10)} ${row.timeframe.padEnd(5)} ${count.toLocaleString().padStart(8)} candles`);
  }
  console.log(`\n  TOTAL: ${tsTotal.toLocaleString()} candles\n`);

  // Summary
  console.log("═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  console.log(`  ClickHouse candles:      ${totalCandles.toLocaleString()}`);
  console.log(`  ClickHouse event windows: ${parseInt(chWindows[0].count).toLocaleString()}`);
  console.log(`  Timescale news events:   ${parseInt(totalNewsResult.rows[0].count).toLocaleString()}`);
  console.log(`  Timescale sessions:      ${totalSessions.toLocaleString()}`);
  console.log(`  Timescale reactions:     ${totalReactions.toLocaleString()}`);
  console.log(`  Timescale candles:       ${tsTotal.toLocaleString()}`);
  console.log("═".repeat(60));

  await pgClient.end();
  await clickhouse.close();
}

main().catch(console.error);
