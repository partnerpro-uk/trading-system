#!/usr/bin/env npx tsx
import { config } from "dotenv";
import { createClient } from "@clickhouse/client";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../../../.env.local") });

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  // Count events by year
  const result = await client.query({
    query: `
      SELECT
        toYear(timestamp) as year,
        impact,
        count() as cnt
      FROM news_events
      WHERE impact != 'non_economic'
      GROUP BY year, impact
      ORDER BY year, impact
    `,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ year: string; impact: string; cnt: string }>();

  // Aggregate by year
  const byYear: Record<string, { high: number; medium: number; low: number; total: number }> = {};
  rows.forEach((r) => {
    if (!byYear[r.year]) byYear[r.year] = { high: 0, medium: 0, low: 0, total: 0 };
    byYear[r.year][r.impact as "high" | "medium" | "low"] = parseInt(r.cnt);
    byYear[r.year].total += parseInt(r.cnt);
  });

  console.log("Events by year:");
  let runningTotal = 0;
  Object.keys(byYear)
    .sort()
    .forEach((year) => {
      const y = byYear[year];
      runningTotal += y.total;
      console.log(
        `  ${year}: ${y.total.toLocaleString().padStart(5)} (H:${y.high} M:${y.medium} L:${y.low}) | Running: ${runningTotal.toLocaleString()}`
      );
    });

  console.log("\nTotal events to process:", runningTotal.toLocaleString());
  console.log("Total windows needed:", (runningTotal * 9).toLocaleString());

  // Check existing windows
  const existingResult = await client.query({
    query: "SELECT count() as cnt FROM event_candle_windows",
    format: "JSONEachRow",
  });
  const existing = await existingResult.json<{ cnt: string }>();
  console.log("Existing windows:", parseInt(existing[0].cnt).toLocaleString());
  console.log("Remaining windows:", (runningTotal * 9 - parseInt(existing[0].cnt)).toLocaleString());

  await client.close();
}
main();
