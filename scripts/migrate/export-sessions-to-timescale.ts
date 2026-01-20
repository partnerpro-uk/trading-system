#!/usr/bin/env npx tsx
/**
 * Export sessions from Convex to Timescale
 * Maps Convex sessions (one row per session) to Timescale session_levels (one row per date)
 */

import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
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

// Convex client
const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Postgres client
const { Client } = pg;

interface ConvexSession {
  pair: string;
  date: string;
  session: string;
  high: number;
  low: number;
  highTime: number;
  lowTime: number;
  startTime: number;
  endTime: number;
  complete: boolean;
}

async function main() {
  console.log("═".repeat(60));
  console.log("  EXPORT SESSIONS: Convex → Timescale");
  console.log("═".repeat(60));
  console.log();

  const pgClient = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await pgClient.connect();
  console.log("✓ Connected to Timescale Cloud");
  console.log("✓ Connected to Convex\n");

  let totalExported = 0;
  let totalDates = 0;

  for (const pair of PAIRS) {
    console.log(`\n${pair}:`);

    // Get date range - last 2 years of trading days
    const dates: string[] = [];
    const now = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);

    // Generate all dates in range
    const current = new Date(startDate);
    while (current <= now) {
      // Skip weekends
      if (current.getDay() !== 0 && current.getDay() !== 6) {
        dates.push(current.toISOString().split("T")[0]);
      }
      current.setDate(current.getDate() + 1);
    }

    console.log(`  Fetching sessions for ${dates.length} trading days...`);

    // Fetch sessions in batches
    const batchSize = 30; // ~1 month at a time
    let exportedForPair = 0;

    for (let i = 0; i < dates.length; i += batchSize) {
      const batchDates = dates.slice(i, i + batchSize);

      // Group sessions by date
      const sessionsByDate: Record<string, { ASIA?: ConvexSession; LONDON?: ConvexSession; NY?: ConvexSession }> = {};

      for (const date of batchDates) {
        try {
          const sessions = await convex.query(api.sessions.getSessionsForDate, {
            pair,
            date,
          });

          if (sessions.length > 0) {
            if (!sessionsByDate[date]) sessionsByDate[date] = {};

            for (const s of sessions) {
              const session = s as unknown as ConvexSession;
              if (session.session === "ASIA") sessionsByDate[date].ASIA = session;
              else if (session.session === "LONDON") sessionsByDate[date].LONDON = session;
              else if (session.session === "NY") sessionsByDate[date].NY = session;
            }
          }
        } catch (err) {
          // Skip dates with no sessions
        }
      }

      // Insert/update in Timescale
      for (const [date, sessions] of Object.entries(sessionsByDate)) {
        const asia = sessions.ASIA;
        const london = sessions.LONDON;
        const ny = sessions.NY;

        // Calculate daily high/low from all sessions
        const allHighs = [asia?.high, london?.high, ny?.high].filter((v): v is number => v !== undefined);
        const allLows = [asia?.low, london?.low, ny?.low].filter((v): v is number => v !== undefined);

        const dailyHigh = allHighs.length > 0 ? Math.max(...allHighs) : null;
        const dailyLow = allLows.length > 0 ? Math.min(...allLows) : null;

        try {
          await pgClient.query(
            `INSERT INTO session_levels (pair, date, asia_high, asia_low, london_high, london_low, ny_high, ny_low, daily_high, daily_low)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (pair, date) DO UPDATE SET
               asia_high = EXCLUDED.asia_high,
               asia_low = EXCLUDED.asia_low,
               london_high = EXCLUDED.london_high,
               london_low = EXCLUDED.london_low,
               ny_high = EXCLUDED.ny_high,
               ny_low = EXCLUDED.ny_low,
               daily_high = EXCLUDED.daily_high,
               daily_low = EXCLUDED.daily_low`,
            [
              pair,
              date,
              asia?.high ?? null,
              asia?.low ?? null,
              london?.high ?? null,
              london?.low ?? null,
              ny?.high ?? null,
              ny?.low ?? null,
              dailyHigh,
              dailyLow,
            ]
          );
          exportedForPair++;
          totalDates++;
        } catch (err: any) {
          console.log(`    Error inserting ${date}: ${err.message}`);
        }
      }

      process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, dates.length)}/${dates.length} dates checked, ${exportedForPair} exported    `);

      // Small delay
      await new Promise((r) => setTimeout(r, 50));
    }

    console.log(`\n  Exported ${exportedForPair} session days`);
    totalExported += exportedForPair;
  }

  console.log();
  console.log("═".repeat(60));
  console.log(`  EXPORT COMPLETE`);
  console.log("═".repeat(60));
  console.log(`  Total dates with sessions: ${totalDates}`);
  console.log();

  // Verify counts
  console.log("Verifying Timescale counts...\n");
  const result = await pgClient.query(`
    SELECT pair, count(*) as count,
           min(date) as oldest, max(date) as newest
    FROM session_levels
    GROUP BY pair
    ORDER BY pair
  `);

  for (const row of result.rows) {
    console.log(`  ${row.pair}: ${row.count} days (${row.oldest} → ${row.newest})`);
  }

  await pgClient.end();
  console.log("\nDone!");
}

main().catch(console.error);
