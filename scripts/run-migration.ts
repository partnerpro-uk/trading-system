import { readFileSync } from "fs";
import pg from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const pool = new pg.Pool({
    host: process.env.TIMESCALE_HOST?.trim(),
    port: parseInt(process.env.TIMESCALE_PORT?.trim() || "5432"),
    user: process.env.TIMESCALE_USER?.trim(),
    password: process.env.TIMESCALE_PASSWORD?.trim(),
    database: process.env.TIMESCALE_DATABASE?.trim(),
    ssl: { rejectUnauthorized: false },
  });

  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error("Usage: npx tsx scripts/run-migration.ts <migration-file>");
    process.exit(1);
  }

  const sql = readFileSync(migrationFile, "utf-8");

  try {
    await pool.query(sql);
    console.log(`Migration ${migrationFile} completed successfully`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
