#!/usr/bin/env npx tsx
/**
 * Setup script for Timescale Cloud and ClickHouse
 * Executes schema migrations on both databases
 */

import { config } from "dotenv";
import { Client } from "pg";
import { createClient as createClickHouseClient } from "@clickhouse/client";
import { readFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const TIMESCALE_URL = process.env.TIMESCALE_URL!;
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST!;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER!;
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD!;

async function setupTimescale() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("Setting up Timescale Cloud...");
  console.log("═══════════════════════════════════════════════════════\n");

  const client = new Client({
    connectionString: TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    // Test connection
    const result = await client.query("SELECT version()");
    console.log(`✓ Connected to Timescale Cloud (PostgreSQL ${result.rows[0].version.split(" ")[1]})`);

    // Check TimescaleDB extension
    const extResult = await client.query(
      "SELECT installed_version FROM pg_available_extensions WHERE name = 'timescaledb'"
    );
    if (extResult.rows.length > 0 && extResult.rows[0].installed_version) {
      console.log(`✓ TimescaleDB extension v${extResult.rows[0].installed_version}`);
    } else {
      console.log("⚠️  TimescaleDB extension not installed. Run:");
      console.log("   CREATE EXTENSION IF NOT EXISTS timescaledb;");
    }

    // Read and execute Timescale schema
    const schemaPath = join(__dirname, "migrations/001-timescale-schema.sql");
    if (require("fs").existsSync(schemaPath)) {
      console.log("\nExecuting Timescale schema...");
      const schema = readFileSync(schemaPath, "utf-8");

      // Execute the schema
      try {
        await client.query(schema);
        console.log("✓ Timescale schema executed successfully");
      } catch (err: any) {
        if (err.message.includes("already exists")) {
          console.log("✓ Tables already exist");
        } else {
          console.error("⚠️  Schema error:", err.message);
        }
      }
    }

    // Verify tables
    const tablesResult = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`\n✓ Timescale tables: ${tablesResult.rows.map(r => r.table_name).join(", ")}`);

  } catch (err) {
    console.error("✗ Failed to connect to Timescale:", err);
    return false;
  } finally {
    await client.end();
  }

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
  if (!TIMESCALE_URL) {
    console.error("✗ Missing TIMESCALE_URL environment variable");
    process.exit(1);
  }

  if (!CLICKHOUSE_HOST || !CLICKHOUSE_PASSWORD) {
    console.error("✗ Missing ClickHouse environment variables");
    process.exit(1);
  }

  await setupTimescale();
  await setupClickHouse();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("Setup complete!");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
