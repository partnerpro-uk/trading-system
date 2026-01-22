/**
 * Backfill missing candles from OANDA
 * Usage: npx ts-node src/backfill-gap.ts
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_API_URL = process.env.OANDA_API_URL || "https://api-fxpractice.oanda.com";
const TIMESCALE_URL = process.env.TIMESCALE_URL!;

interface OandaCandle {
  complete: boolean;
  volume: number;
  time: string;
  mid: { o: string; h: string; l: string; c: string };
}

async function fetchCandlesFromOanda(
  pair: string,
  granularity: string,
  from: string,
  to: string
): Promise<OandaCandle[]> {
  const url = `${OANDA_API_URL}/v3/instruments/${pair}/candles?granularity=${granularity}&from=${from}&to=${to}&price=M`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${OANDA_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OANDA API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.candles || [];
}

async function main() {
  // Gap: Jan 20 10:30 UTC to Jan 21 17:45 UTC
  const from = "2026-01-20T10:30:00Z";
  const to = "2026-01-21T17:45:00Z";

  const pairs = ["XAU_USD", "SPX500_USD"];
  const timeframes = ["M1", "M5", "M15", "M30", "H1", "H4"];

  console.log(`Backfilling from ${from} to ${to}`);

  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });

  try {
    await pool.query("SELECT NOW()");
    console.log("Connected to TimescaleDB");
  } catch (err) {
    console.error("Failed to connect:", err);
    process.exit(1);
  }

  for (const pair of pairs) {
    for (const tf of timeframes) {
      console.log(`\nFetching ${pair} ${tf}...`);

      try {
        const candles = await fetchCandlesFromOanda(pair, tf, from, to);
        console.log(`  Got ${candles.length} candles from OANDA`);

        if (candles.length === 0) continue;

        // Batch insert
        const values: unknown[] = [];
        const placeholders: string[] = [];

        candles.forEach((c, i) => {
          const offset = i * 9;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
          );
          values.push(
            new Date(c.time),
            pair,
            tf,
            parseFloat(c.mid.o),
            parseFloat(c.mid.h),
            parseFloat(c.mid.l),
            parseFloat(c.mid.c),
            c.volume,
            c.complete
          );
        });

        await pool.query(
          `INSERT INTO candles (time, pair, timeframe, open, high, low, close, volume, complete)
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (time, pair, timeframe)
           DO UPDATE SET
             open = EXCLUDED.open,
             high = EXCLUDED.high,
             low = EXCLUDED.low,
             close = EXCLUDED.close,
             volume = EXCLUDED.volume,
             complete = EXCLUDED.complete`,
          values
        );

        console.log(`  Inserted ${candles.length} candles`);
      } catch (err) {
        console.error(`  Error: ${err}`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 200));
    }
  }

  await pool.end();
  console.log("\nBackfill complete!");
}

main().catch(console.error);
