#!/usr/bin/env npx tsx
/**
 * Run migration 005 to add missing news_events columns
 */

import { config } from "dotenv";
import pg from "pg";
import { readFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const { Client } = pg;

async function main() {
  // Remove sslmode from URL and handle SSL manually to allow self-signed certs
  const connUrl = (process.env.TIMESCALE_URL || "").replace(/[?&]sslmode=[^&\\]+/, "");
  const client = new Client({
    connectionString: connUrl,
    ssl: { rejectUnauthorized: false },
  });

  console.log("🔄 Running migration 005: Add missing news_events columns\n");

  await client.connect();
  console.log("✓ Connected to TimescaleDB\n");

  // Read and execute migration
  const migrationPath = join(
    process.cwd(),
    "scripts",
    "migrations",
    "005-timescale-news-columns.sql"
  );
  const sql = readFileSync(migrationPath, "utf-8");

  // Split by semicolons and execute each statement
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));

  for (const statement of statements) {
    if (!statement) continue;
    try {
      console.log(`Executing: ${statement.slice(0, 60)}...`);
      await client.query(statement);
      console.log("  ✓ Done");
    } catch (error: unknown) {
      const err = error as Error;
      // Ignore "already exists" errors
      if (err.message.includes("already exists")) {
        console.log("  ⚠ Already exists (skipped)");
      } else {
        console.error(`  ✗ Error: ${err.message}`);
      }
    }
  }

  // Verify the columns
  console.log("\n═══════════════════════════════════════════");
  console.log("Verifying news_events columns:");
  const result = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'news_events'
    ORDER BY ordinal_position
  `);

  for (const row of result.rows) {
    console.log(`  ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
  }
  console.log("═══════════════════════════════════════════\n");

  await client.end();
  console.log("✓ Migration 005 complete");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
