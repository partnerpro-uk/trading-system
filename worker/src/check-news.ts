/**
 * Check news data in TimescaleDB
 */

import { config } from "dotenv";
import { Pool } from "pg";
import { resolve } from "path";

config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;

async function checkNews() {
  const connUrl = TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
  const pool = new Pool({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // List all tables
    const tables = await pool.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    console.log("\n=== Tables in TimescaleDB ===");
    for (const t of tables.rows) {
      console.log(" -", t.tablename);
    }

    // Check news_events table
    const count = await pool.query("SELECT COUNT(*) as cnt FROM news_events");
    console.log("\nnews_events count:", count.rows[0].cnt);

    // Check event_price_reactions table
    const reactionsCount = await pool.query("SELECT COUNT(*) as cnt FROM event_price_reactions");
    console.log("event_price_reactions count:", reactionsCount.rows[0].cnt);

    // Get sample reaction
    const sampleReaction = await pool.query("SELECT * FROM event_price_reactions LIMIT 1");
    console.log("\nSample reaction:");
    console.log(JSON.stringify(sampleReaction.rows[0], null, 2));

    // Get reaction columns
    const reactionCols = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'event_price_reactions'
      ORDER BY ordinal_position
    `);
    console.log("\nevent_price_reactions columns:");
    for (const c of reactionCols.rows) {
      console.log(` - ${c.column_name}: ${c.data_type}`);
    }

  } finally {
    await pool.end();
  }
}

checkNews().catch(console.error);
