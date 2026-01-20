/**
 * Check candle data in TimescaleDB
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

async function checkData() {
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Get counts by timeframe
    const result = await pool.query(`
      SELECT timeframe, count(*) as cnt, min(time) as oldest, max(time) as newest
      FROM candles
      GROUP BY timeframe
      ORDER BY timeframe
    `);

    console.log("\n=== Candle Data Summary ===\n");
    console.log("Timeframe | Count  | Oldest               | Newest");
    console.log("----------|--------|----------------------|----------------------");

    for (const row of result.rows) {
      const tf = row.timeframe.padEnd(9);
      const cnt = String(row.cnt).padStart(6);
      const oldest = row.oldest ? new Date(row.oldest).toISOString() : "N/A";
      const newest = row.newest ? new Date(row.newest).toISOString() : "N/A";
      console.log(`${tf} | ${cnt} | ${oldest} | ${newest}`);
    }

    // Get total
    const totalResult = await pool.query("SELECT count(*) as total FROM candles");
    console.log(`\nTotal candles: ${totalResult.rows[0].total}`);

    // Get pair counts
    const pairResult = await pool.query(`
      SELECT pair, count(*) as cnt
      FROM candles
      GROUP BY pair
      ORDER BY pair
    `);
    console.log("\n=== By Pair ===\n");
    for (const row of pairResult.rows) {
      console.log(`${row.pair}: ${row.cnt}`);
    }

  } finally {
    await pool.end();
  }
}

checkData().catch(console.error);
