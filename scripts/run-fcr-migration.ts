#!/usr/bin/env npx tsx
/**
 * Run FCR ClickHouse Migration
 *
 * Executes the FCR candle windows table creation in ClickHouse.
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, "../.env.local") });

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║             FCR CLICKHOUSE MIGRATION                              ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  if (!process.env.CLICKHOUSE_HOST) {
    throw new Error("CLICKHOUSE_HOST environment variable is not set");
  }

  const client = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
    request_timeout: 60000,
  });

  // Test connection
  try {
    await client.query({ query: "SELECT 1", format: "JSON" });
    console.log("[DB] ClickHouse connection OK\n");
  } catch (error) {
    console.error("[DB] ClickHouse connection failed:", error);
    process.exit(1);
  }

  // Read migration SQL
  const migrationPath = join(__dirname, "migrations/008-clickhouse-fcr-windows.sql");
  const migrationSQL = readFileSync(migrationPath, "utf-8");

  // Split by CREATE statements (each is a separate command)
  const statements = migrationSQL
    .split(/(?=CREATE )/i)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("CREATE"));

  console.log(`Found ${statements.length} CREATE statements to execute\n`);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    // Extract table name for logging
    const tableMatch = statement.match(/CREATE\s+(?:TABLE|MATERIALIZED VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    const tableName = tableMatch ? tableMatch[1] : `statement ${i + 1}`;

    console.log(`[${i + 1}/${statements.length}] Creating ${tableName}...`);

    try {
      await client.command({ query: statement });
      console.log(`  ✓ ${tableName} created\n`);
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        console.log(`  ⚠ ${tableName} already exists (skipped)\n`);
      } else {
        console.error(`  ✗ Failed to create ${tableName}:`, error.message);
        process.exit(1);
      }
    }
  }

  // Verify tables exist
  console.log("─".repeat(60));
  console.log("Verifying tables...\n");

  const tables = ["fcr_candle_windows", "fcr_statistics"];
  for (const table of tables) {
    try {
      const result = await client.query({
        query: `SELECT count() as count FROM ${table}`,
        format: "JSONEachRow",
      });
      const rows = await result.json<{ count: string }>();
      console.log(`  ✓ ${table}: ${rows[0]?.count || 0} rows`);
    } catch (error: any) {
      console.log(`  ✗ ${table}: ${error.message}`);
    }
  }

  console.log("\n" + "═".repeat(60));
  console.log("  FCR MIGRATION COMPLETE");
  console.log("═".repeat(60));

  await client.close();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
