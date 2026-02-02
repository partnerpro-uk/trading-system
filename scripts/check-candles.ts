#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";
import { config } from "dotenv";

config({ path: ".env.local" });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function check() {
  const result = await clickhouse.query({
    query: `
      SELECT
        pair,
        timeframe,
        count(*) as candles,
        min(time) as earliest,
        max(time) as latest
      FROM candles
      GROUP BY pair, timeframe
      ORDER BY pair, timeframe
    `,
    format: "JSONEachRow"
  });
  const rows = await result.json() as any[];
  console.log("All Candle Data by Pair & Timeframe:");
  console.log("─".repeat(80));
  let currentPair = "";
  for (const row of rows) {
    if (row.pair !== currentPair) {
      if (currentPair) console.log("");
      currentPair = row.pair;
      console.log(`${row.pair}:`);
    }
    const earliest = row.earliest.split("T")[0];
    const latest = row.latest.split("T")[0];
    console.log(`  ${row.timeframe.padEnd(4)} | ${Number(row.candles).toLocaleString().padStart(10)} candles | ${earliest} -> ${latest}`);
  }
  await clickhouse.close();
}
check();
