#!/usr/bin/env npx tsx
/**
 * Backfill GPR (Geopolitical Risk) Index data to Timescale
 *
 * Data source: https://www.matteoiacoviello.com/gpr.htm
 * The GPR Index is an academic-grade metric used by IMF/Fed researchers.
 *
 * Usage:
 *   1. Download the Excel file from the source URL
 *   2. Save as data/gpr_index/gpr_data.xlsx
 *   3. Run: npx tsx scripts/backfill-gpr-index.ts
 *
 * The script parses the Excel and inserts monthly GPR values into Timescale.
 */

import { config } from "dotenv";
import pg from "pg";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";

config({ path: ".env.local" });

const { Client } = pg;

interface GPRRow {
  month: Date;
  gpr_global: number;
  gpr_us?: number;
  gpr_threats?: number;
  gpr_acts?: number;
}

async function main() {
  const dataPath = join(process.cwd(), "data", "gpr_index", "gpr_data.xlsx");

  if (!existsSync(dataPath)) {
    console.log("GPR Index data file not found.");
    console.log("\nTo backfill GPR data:");
    console.log("1. Download Excel from: https://www.matteoiacoviello.com/gpr.htm");
    console.log("2. Save to: data/gpr_index/gpr_data.xlsx");
    console.log("3. Run this script again");
    console.log("\nAlternatively, you can manually insert data or skip GPR backfill.");
    process.exit(0);
  }

  const client = new Client({
    connectionString: process.env.TIMESCALE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log("📊 Backfilling GPR Index to Timescale...\n");

  await client.connect();
  console.log("✓ Connected to Timescale\n");

  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS gpr_index (
      month DATE PRIMARY KEY,
      gpr_global DECIMAL(8, 2) NOT NULL,
      gpr_us DECIMAL(8, 2),
      gpr_threats DECIMAL(8, 2),
      gpr_acts DECIMAL(8, 2),
      synced_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Read Excel file
  console.log("Reading GPR data from Excel...");
  const workbook = XLSX.readFile(dataPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

  // Find header row and column indices
  let headerRowIndex = -1;
  let monthCol = -1;
  let gprCol = -1;
  let gprUSCol = -1;
  let threatsCol = -1;
  let actsCol = -1;

  for (let i = 0; i < Math.min(rawData.length, 20); i++) {
    const row = rawData[i];
    if (!row) continue;

    const rowStr = row.map((c) => String(c || "").toLowerCase());

    // Look for date/month column
    const dateIdx = rowStr.findIndex(
      (c) => c.includes("date") || c.includes("month") || c === "year"
    );
    const gprIdx = rowStr.findIndex(
      (c) => c === "gpr" || c.includes("gpr_") || c.includes("geopolitical")
    );

    if (dateIdx >= 0 && gprIdx >= 0) {
      headerRowIndex = i;
      monthCol = dateIdx;
      gprCol = gprIdx;

      // Try to find other columns
      gprUSCol = rowStr.findIndex((c) => c.includes("gpr_us") || c.includes("usa"));
      threatsCol = rowStr.findIndex((c) => c.includes("threat"));
      actsCol = rowStr.findIndex((c) => c.includes("act"));

      break;
    }
  }

  if (headerRowIndex < 0) {
    // Try alternative: assume first column is date, second is GPR
    console.log("Could not detect headers, assuming standard format (date, gpr)...");
    headerRowIndex = 0;
    monthCol = 0;
    gprCol = 1;
  }

  // Parse data rows
  const gprData: GPRRow[] = [];

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    // Parse date
    let month: Date | null = null;
    const dateVal = row[monthCol];

    if (typeof dateVal === "number") {
      // Excel serial date
      month = XLSX.SSF.parse_date_code(dateVal) as unknown as Date;
      if (month && typeof month === "object" && "y" in month) {
        const parsed = month as { y: number; m: number; d: number };
        month = new Date(parsed.y, parsed.m - 1, 1);
      }
    } else if (typeof dateVal === "string") {
      // Try to parse string date
      const parsed = new Date(dateVal);
      if (!isNaN(parsed.getTime())) {
        month = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
      }
    }

    if (!month || isNaN(month.getTime())) continue;

    // Parse GPR value
    const gprVal = parseFloat(String(row[gprCol]));
    if (isNaN(gprVal)) continue;

    const entry: GPRRow = {
      month,
      gpr_global: gprVal,
    };

    // Parse optional columns
    if (gprUSCol >= 0 && row[gprUSCol] !== undefined) {
      const val = parseFloat(String(row[gprUSCol]));
      if (!isNaN(val)) entry.gpr_us = val;
    }
    if (threatsCol >= 0 && row[threatsCol] !== undefined) {
      const val = parseFloat(String(row[threatsCol]));
      if (!isNaN(val)) entry.gpr_threats = val;
    }
    if (actsCol >= 0 && row[actsCol] !== undefined) {
      const val = parseFloat(String(row[actsCol]));
      if (!isNaN(val)) entry.gpr_acts = val;
    }

    gprData.push(entry);
  }

  console.log(`✓ Parsed ${gprData.length} monthly GPR readings\n`);

  if (gprData.length === 0) {
    console.log("No data to insert. Check the Excel file format.");
    await client.end();
    return;
  }

  // Show date range
  const sorted = gprData.sort((a, b) => a.month.getTime() - b.month.getTime());
  const firstMonth = sorted[0].month;
  const lastMonth = sorted[sorted.length - 1].month;
  console.log(
    `Date range: ${firstMonth.toISOString().slice(0, 7)} to ${lastMonth.toISOString().slice(0, 7)}`
  );

  // Insert data
  console.log("\nInserting GPR data...");
  let insertCount = 0;

  for (const entry of gprData) {
    const monthStr = entry.month.toISOString().slice(0, 10);

    await client.query(
      `
      INSERT INTO gpr_index (month, gpr_global, gpr_us, gpr_threats, gpr_acts, synced_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (month) DO UPDATE SET
        gpr_global = EXCLUDED.gpr_global,
        gpr_us = EXCLUDED.gpr_us,
        gpr_threats = EXCLUDED.gpr_threats,
        gpr_acts = EXCLUDED.gpr_acts,
        synced_at = NOW()
      `,
      [monthStr, entry.gpr_global, entry.gpr_us || null, entry.gpr_threats || null, entry.gpr_acts || null]
    );
    insertCount++;

    if (insertCount % 100 === 0) {
      process.stdout.write(`  ${insertCount}/${gprData.length}\r`);
    }
  }

  console.log(`✓ Inserted ${insertCount} GPR readings\n`);

  // Verify
  const result = await client.query("SELECT COUNT(*) FROM gpr_index");
  const recentResult = await client.query(
    "SELECT month, gpr_global FROM gpr_index ORDER BY month DESC LIMIT 5"
  );

  console.log("═══════════════════════════════════════════");
  console.log("GPR Index backfill complete:");
  console.log(`  Total rows: ${result.rows[0].count}`);
  console.log("\nMost recent readings:");
  for (const row of recentResult.rows) {
    console.log(`  ${row.month.toISOString().slice(0, 7)}: ${row.gpr_global}`);
  }
  console.log("═══════════════════════════════════════════\n");

  await client.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
