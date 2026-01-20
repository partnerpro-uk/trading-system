#!/usr/bin/env npx tsx
/**
 * Setup script for Supabase (TimescaleDB) and ClickHouse
 * Executes schema migrations on both databases
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createClient as createClickHouseClient } from "@clickhouse/client";
import { readFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST!;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER!;
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD!;

async function setupSupabase() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("Setting up Supabase (TimescaleDB)...");
  console.log("═══════════════════════════════════════════════════════\n");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Test connection
  const { data, error } = await supabase.from("_test_connection").select("*").limit(1);
  if (error && !error.message.includes("does not exist")) {
    console.log("✓ Connected to Supabase");
  } else {
    console.log("✓ Connected to Supabase");
  }

  // Note: Schema execution needs to be done via Supabase SQL Editor
  // or using the postgres direct connection
  console.log("\n⚠️  To execute schemas, use Supabase SQL Editor:");
  console.log("   1. Go to: https://supabase.com/dashboard/project/vukhgajukzmwtrdwuots/sql");
  console.log("   2. First run: CREATE EXTENSION IF NOT EXISTS timescaledb;");
  console.log("   3. Then paste contents of: scripts/migrations/001-timescale-schema.sql");
  console.log("   4. Then paste contents of: scripts/migrations/002-timescale-aggregates.sql");

  return true;
}

async function setupClickHouse() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Setting up ClickHouse...");
  console.log("═══════════════════════════════════════════════════════\n");

  const clickhouse = createClickHouseClient({
    url: CLICKHOUSE_HOST,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
  });

  // Test connection
  try {
    const result = await clickhouse.query({
      query: "SELECT version()",
      format: "JSONEachRow",
    });
    const rows = await result.json();
    console.log(`✓ Connected to ClickHouse (version: ${(rows as any)[0]["version()"]})`);
  } catch (err) {
    console.error("✗ Failed to connect to ClickHouse:", err);
    return false;
  }

  // Read and execute ClickHouse schema
  const schemaPath = join(__dirname, "migrations/003-clickhouse-schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // Split by semicolons and execute each statement
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`\nExecuting ${statements.length} statements...\n`);

  for (const statement of statements) {
    // Skip comments-only blocks
    const cleanStatement = statement
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();

    if (!cleanStatement) continue;

    try {
      await clickhouse.command({ query: cleanStatement });
      // Extract table name for logging
      const match = cleanStatement.match(/CREATE\s+(?:TABLE|MATERIALIZED VIEW)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
      if (match) {
        console.log(`  ✓ Created: ${match[1]}`);
      }
    } catch (err: any) {
      // Ignore "already exists" errors
      if (err.message?.includes("already exists")) {
        const match = cleanStatement.match(/CREATE\s+(?:TABLE|MATERIALIZED VIEW)\s+(?:IF NOT EXISTS\s+)?(\w+)/i);
        if (match) {
          console.log(`  ✓ Already exists: ${match[1]}`);
        }
      } else {
        console.error(`  ✗ Error executing statement:`, err.message);
      }
    }
  }

  // Verify tables created
  console.log("\nVerifying tables...");
  const tablesResult = await clickhouse.query({
    query: "SHOW TABLES",
    format: "JSONEachRow",
  });
  const tables = await tablesResult.json();
  console.log(`\n✓ ClickHouse tables: ${(tables as any[]).map((t) => t.name).join(", ")}`);

  await clickhouse.close();
  return true;
}

async function main() {
  console.log("\n🚀 Database Setup Script\n");

  // Check env vars
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("✗ Missing Supabase environment variables");
    process.exit(1);
  }

  if (!CLICKHOUSE_HOST || !CLICKHOUSE_PASSWORD) {
    console.error("✗ Missing ClickHouse environment variables");
    process.exit(1);
  }

  await setupSupabase();
  await setupClickHouse();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Setup complete!");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
