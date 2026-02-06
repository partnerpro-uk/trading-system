#!/usr/bin/env npx tsx
/**
 * CFTC COT (Commitments of Traders) Data Ingestion
 *
 * Fetches institutional positioning data from CFTC and stores in:
 * - ClickHouse (all historical data since 2006)
 * - TimescaleDB (recent 52 weeks for UI display)
 *
 * Source: CFTC Traders in Financial Futures (TFF) report
 * Schedule: Weekly (data released Friday, as of Tuesday close)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient, ClickHouseClient } from "@clickhouse/client";
import { Pool } from "pg";
import AdmZip from "adm-zip";

// =============================================================================
// Configuration
// =============================================================================

const CFTC_WEEKLY_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt";
const CFTC_HISTORY_URL = (year: number) =>
  `https://www.cftc.gov/files/dea/history/fin_fut_txt_${year}.zip`;

// CME currency futures → our pair names
const CME_TO_PAIR: Record<string, string> = {
  "CANADIAN DOLLAR": "USD_CAD",
  "SWISS FRANC": "USD_CHF",
  "BRITISH POUND": "GBP_USD",
  "JAPANESE YEN": "USD_JPY",
  "EURO FX": "EUR_USD",
  "AUSTRALIAN DOLLAR": "AUD_USD",
  "NZ DOLLAR": "NZD_USD",
};

// Column names matching the CFTC TFF report layout
// The weekly file has NO headers; annual files DO have headers.
// These are used as fallback column names for the headerless weekly file.
const TFF_COLUMNS = [
  "Market_and_Exchange_Names",
  "As_of_Date_In_Form_YYMMDD",
  "Report_Date_as_YYYY-MM-DD",
  "CFTC_Contract_Market_Code",
  "CFTC_Market_Code",
  "CFTC_Region_Code",
  "CFTC_Commodity_Code",
  "Open_Interest_All",
  "Dealer_Positions_Long_All",
  "Dealer_Positions_Short_All",
  "Dealer_Positions_Spread_All",
  "Asset_Mgr_Positions_Long_All",
  "Asset_Mgr_Positions_Short_All",
  "Asset_Mgr_Positions_Spread_All",
  "Lev_Money_Positions_Long_All",
  "Lev_Money_Positions_Short_All",
  "Lev_Money_Positions_Spread_All",
  "Other_Rpt_Positions_Long_All",
  "Other_Rpt_Positions_Short_All",
  "Other_Rpt_Positions_Spread_All",
  "Tot_Rpt_Positions_Long_All",
  "Tot_Rpt_Positions_Short_All",
  "NonRept_Positions_Long_All",
  "NonRept_Positions_Short_All",
];

// =============================================================================
// Types
// =============================================================================

interface COTPosition {
  report_date: string; // YYYY-MM-DD
  pair: string;
  cme_contract: string;
  open_interest: number;
  dealer_long: number;
  dealer_short: number;
  asset_mgr_long: number;
  asset_mgr_short: number;
  lev_money_long: number;
  lev_money_short: number;
  other_rpt_long: number;
  other_rpt_short: number;
  nonrpt_long: number;
  nonrpt_short: number;
  dealer_net_positions: number;
  asset_mgr_net_positions: number;
  lev_money_net_positions: number;
  other_rpt_net_positions: number;
  nonrpt_net_positions: number;
  weekly_change_lev_money: number;
  weekly_change_asset_mgr: number;
}

// =============================================================================
// CSV Parsing
// =============================================================================

/**
 * Parse a CSV line that may contain quoted fields.
 * The CFTC file has the first column quoted: "EURO FX - CHICAGO MERCANTILE EXCHANGE"
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Extract the currency name from the market name field.
 * "EURO FX - CHICAGO MERCANTILE EXCHANGE" → "EURO FX"
 */
function extractCurrencyName(marketName: string): string | null {
  const dashIndex = marketName.indexOf(" - ");
  if (dashIndex === -1) return null;
  return marketName.substring(0, dashIndex).trim();
}

/**
 * Parse CFTC TFF data from text content.
 * Handles both headerless (weekly) and headered (annual) files.
 */
function parseCOTFile(text: string, hasHeaders: boolean): COTPosition[] {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Determine column mapping
  let colMap: Record<string, number>;
  let dataStartIndex: number;

  if (hasHeaders) {
    const headerFields = parseCSVLine(lines[0]);
    colMap = {};
    headerFields.forEach((name, idx) => {
      colMap[name.trim()] = idx;
    });
    dataStartIndex = 1;
  } else {
    colMap = {};
    TFF_COLUMNS.forEach((name, idx) => {
      colMap[name] = idx;
    });
    dataStartIndex = 0;
  }

  // Helper to get column index (try exact match, then partial)
  const col = (name: string): number => {
    if (colMap[name] !== undefined) return colMap[name];
    // Try partial match for slight header variations across years
    const key = Object.keys(colMap).find(
      (k) => k.toLowerCase().replace(/\s+/g, "_") === name.toLowerCase().replace(/\s+/g, "_")
    );
    return key !== undefined ? colMap[key] : -1;
  };

  const positions: COTPosition[] = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 24) continue;

    // Extract market name and check if it's a currency future we track
    const marketName = fields[col("Market_and_Exchange_Names")] || "";
    const currencyName = extractCurrencyName(marketName);
    if (!currencyName || !CME_TO_PAIR[currencyName]) continue;

    // Must be on CHICAGO MERCANTILE EXCHANGE
    if (!marketName.includes("CHICAGO MERCANTILE EXCHANGE")) continue;

    const pair = CME_TO_PAIR[currencyName];
    const reportDate = fields[col("Report_Date_as_YYYY-MM-DD")] || "";
    if (!reportDate || !reportDate.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    const num = (idx: number): number => {
      const val = fields[idx];
      if (val === undefined) return 0;
      return parseInt(val.replace(/\s/g, ""), 10) || 0;
    };

    const dealerLong = num(col("Dealer_Positions_Long_All"));
    const dealerShort = num(col("Dealer_Positions_Short_All"));
    const assetMgrLong = num(col("Asset_Mgr_Positions_Long_All"));
    const assetMgrShort = num(col("Asset_Mgr_Positions_Short_All"));
    const levMoneyLong = num(col("Lev_Money_Positions_Long_All"));
    const levMoneyShort = num(col("Lev_Money_Positions_Short_All"));
    const otherRptLong = num(col("Other_Rpt_Positions_Long_All"));
    const otherRptShort = num(col("Other_Rpt_Positions_Short_All"));
    const nonrptLong = num(col("NonRept_Positions_Long_All"));
    const nonrptShort = num(col("NonRept_Positions_Short_All"));

    positions.push({
      report_date: reportDate,
      pair,
      cme_contract: currencyName,
      open_interest: num(col("Open_Interest_All")),
      dealer_long: dealerLong,
      dealer_short: dealerShort,
      asset_mgr_long: assetMgrLong,
      asset_mgr_short: assetMgrShort,
      lev_money_long: levMoneyLong,
      lev_money_short: levMoneyShort,
      other_rpt_long: otherRptLong,
      other_rpt_short: otherRptShort,
      nonrpt_long: nonrptLong,
      nonrpt_short: nonrptShort,
      dealer_net_positions: dealerLong - dealerShort,
      asset_mgr_net_positions: assetMgrLong - assetMgrShort,
      lev_money_net_positions: levMoneyLong - levMoneyShort,
      other_rpt_net_positions: otherRptLong - otherRptShort,
      nonrpt_net_positions: nonrptLong - nonrptShort,
      weekly_change_lev_money: 0, // Calculated after sorting
      weekly_change_asset_mgr: 0,
    });
  }

  return positions;
}

/**
 * Calculate weekly changes by comparing each week to the prior week.
 * Positions must be sorted by pair then by report_date ascending.
 */
function calculateWeeklyChanges(positions: COTPosition[]): void {
  // Group by pair
  const byPair = new Map<string, COTPosition[]>();
  for (const p of positions) {
    const list = byPair.get(p.pair) || [];
    list.push(p);
    byPair.set(p.pair, list);
  }

  for (const [, pairPositions] of byPair) {
    pairPositions.sort((a, b) => a.report_date.localeCompare(b.report_date));
    for (let i = 1; i < pairPositions.length; i++) {
      const prev = pairPositions[i - 1];
      const curr = pairPositions[i];
      curr.weekly_change_lev_money = curr.lev_money_net_positions - prev.lev_money_net_positions;
      curr.weekly_change_asset_mgr = curr.asset_mgr_net_positions - prev.asset_mgr_net_positions;
    }
  }
}

// =============================================================================
// Database Writers
// =============================================================================

async function writeToClickHouse(
  client: ClickHouseClient,
  positions: COTPosition[]
): Promise<number> {
  if (positions.length === 0) return 0;

  const rows = positions.map((p) => ({
    report_date: p.report_date,
    pair: p.pair,
    cme_contract: p.cme_contract,
    open_interest: p.open_interest,
    dealer_net_positions: p.dealer_net_positions,
    asset_mgr_net_positions: p.asset_mgr_net_positions,
    lev_money_net_positions: p.lev_money_net_positions,
    other_rpt_net_positions: p.other_rpt_net_positions,
    nonrpt_net_positions: p.nonrpt_net_positions,
    dealer_long: p.dealer_long,
    dealer_short: p.dealer_short,
    asset_mgr_long: p.asset_mgr_long,
    asset_mgr_short: p.asset_mgr_short,
    lev_money_long: p.lev_money_long,
    lev_money_short: p.lev_money_short,
    other_rpt_long: p.other_rpt_long,
    other_rpt_short: p.other_rpt_short,
    nonrpt_long: p.nonrpt_long,
    nonrpt_short: p.nonrpt_short,
    weekly_change_lev_money: p.weekly_change_lev_money,
    weekly_change_asset_mgr: p.weekly_change_asset_mgr,
  }));

  await client.insert({
    table: "cot_positions",
    values: rows,
    format: "JSONEachRow",
  });

  return rows.length;
}

async function writeToTimescale(
  pool: Pool,
  positions: COTPosition[],
  percentiles: Map<string, { levMoney: number; assetMgr: number }>
): Promise<number> {
  if (positions.length === 0) return 0;

  const client = await pool.connect();
  try {
    let inserted = 0;

    for (const p of positions) {
      const pctl = percentiles.get(p.pair) || { levMoney: 50, assetMgr: 50 };

      await client.query(
        `INSERT INTO cot_positions (
          report_date, pair, cme_contract, open_interest,
          dealer_net_positions, asset_mgr_net_positions, lev_money_net_positions,
          other_rpt_net_positions, nonrpt_net_positions,
          dealer_long, dealer_short, asset_mgr_long, asset_mgr_short,
          lev_money_long, lev_money_short, other_rpt_long, other_rpt_short,
          nonrpt_long, nonrpt_short,
          weekly_change_lev_money, weekly_change_asset_mgr,
          lev_money_percentile, asset_mgr_percentile
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (report_date, pair) DO UPDATE SET
          open_interest = EXCLUDED.open_interest,
          dealer_net_positions = EXCLUDED.dealer_net_positions,
          asset_mgr_net_positions = EXCLUDED.asset_mgr_net_positions,
          lev_money_net_positions = EXCLUDED.lev_money_net_positions,
          other_rpt_net_positions = EXCLUDED.other_rpt_net_positions,
          nonrpt_net_positions = EXCLUDED.nonrpt_net_positions,
          dealer_long = EXCLUDED.dealer_long,
          dealer_short = EXCLUDED.dealer_short,
          asset_mgr_long = EXCLUDED.asset_mgr_long,
          asset_mgr_short = EXCLUDED.asset_mgr_short,
          lev_money_long = EXCLUDED.lev_money_long,
          lev_money_short = EXCLUDED.lev_money_short,
          other_rpt_long = EXCLUDED.other_rpt_long,
          other_rpt_short = EXCLUDED.other_rpt_short,
          nonrpt_long = EXCLUDED.nonrpt_long,
          nonrpt_short = EXCLUDED.nonrpt_short,
          weekly_change_lev_money = EXCLUDED.weekly_change_lev_money,
          weekly_change_asset_mgr = EXCLUDED.weekly_change_asset_mgr,
          lev_money_percentile = EXCLUDED.lev_money_percentile,
          asset_mgr_percentile = EXCLUDED.asset_mgr_percentile`,
        [
          p.report_date, p.pair, p.cme_contract, p.open_interest,
          p.dealer_net_positions, p.asset_mgr_net_positions, p.lev_money_net_positions,
          p.other_rpt_net_positions, p.nonrpt_net_positions,
          p.dealer_long, p.dealer_short, p.asset_mgr_long, p.asset_mgr_short,
          p.lev_money_long, p.lev_money_short, p.other_rpt_long, p.other_rpt_short,
          p.nonrpt_long, p.nonrpt_short,
          p.weekly_change_lev_money, p.weekly_change_asset_mgr,
          pctl.levMoney, pctl.assetMgr,
        ]
      );
      inserted++;
    }

    return inserted;
  } finally {
    client.release();
  }
}

// =============================================================================
// Percentile Calculation
// =============================================================================

/**
 * Calculate percentile rankings for current positions by querying
 * the last 52 weeks of data from ClickHouse.
 */
async function calculatePercentiles(
  clickhouse: ClickHouseClient,
  currentPositions: COTPosition[]
): Promise<Map<string, { levMoney: number; assetMgr: number }>> {
  const result = new Map<string, { levMoney: number; assetMgr: number }>();

  for (const pos of currentPositions) {
    try {
      const query = await clickhouse.query({
        query: `
          SELECT lev_money_net_positions, asset_mgr_net_positions
          FROM cot_positions
          WHERE pair = {pair:String}
          ORDER BY report_date DESC
          LIMIT 52
        `,
        query_params: { pair: pos.pair },
        format: "JSONEachRow",
      });

      const rows = await query.json<{ lev_money_net_positions: number; asset_mgr_net_positions: number }>();

      if (rows.length < 2) {
        result.set(pos.pair, { levMoney: 50, assetMgr: 50 });
        continue;
      }

      // Calculate percentile: what % of values are BELOW the current
      const levValues = rows.map((r) => r.lev_money_net_positions).sort((a, b) => a - b);
      const assetValues = rows.map((r) => r.asset_mgr_net_positions).sort((a, b) => a - b);

      const levPctl = Math.round(
        (levValues.filter((v) => v < pos.lev_money_net_positions).length / levValues.length) * 100
      );
      const assetPctl = Math.round(
        (assetValues.filter((v) => v < pos.asset_mgr_net_positions).length / assetValues.length) * 100
      );

      result.set(pos.pair, { levMoney: levPctl, assetMgr: assetPctl });
    } catch (err) {
      console.error(`[COT] Error calculating percentile for ${pos.pair}:`, err);
      result.set(pos.pair, { levMoney: 50, assetMgr: 50 });
    }
  }

  return result;
}

// =============================================================================
// Fetch Previous Week (for weekly change calculation)
// =============================================================================

async function getPreviousWeekPositions(
  clickhouse: ClickHouseClient
): Promise<Map<string, { levMoney: number; assetMgr: number }>> {
  const result = new Map<string, { levMoney: number; assetMgr: number }>();

  try {
    const query = await clickhouse.query({
      query: `
        SELECT pair, lev_money_net_positions, asset_mgr_net_positions
        FROM cot_positions
        WHERE (pair, report_date) IN (
          SELECT pair, max(report_date)
          FROM cot_positions
          GROUP BY pair
        )
      `,
      format: "JSONEachRow",
    });

    const rows = await query.json<{
      pair: string;
      lev_money_net_positions: number;
      asset_mgr_net_positions: number;
    }>();

    for (const row of rows) {
      result.set(row.pair, {
        levMoney: row.lev_money_net_positions,
        assetMgr: row.asset_mgr_net_positions,
      });
    }
  } catch {
    // No previous data yet — that's fine for first run
  }

  return result;
}

// =============================================================================
// Main Operations
// =============================================================================

/**
 * Backfill historical COT data from CFTC yearly ZIP files.
 * Writes to ClickHouse only (bulk historical data).
 */
export async function backfillHistorical(startYear: number = 2006): Promise<void> {
  console.log("=".repeat(60));
  console.log("CFTC COT Historical Backfill");
  console.log("=".repeat(60));

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  const currentYear = new Date().getFullYear();
  let totalPositions = 0;

  // Collect ALL positions across all years for proper weekly change calculation
  const allPositions: COTPosition[] = [];

  try {
    for (let year = startYear; year <= currentYear; year++) {
      const url = CFTC_HISTORY_URL(year);
      console.log(`\nFetching ${year}... (${url})`);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`  → Skipping ${year}: HTTP ${response.status}`);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();

        if (entries.length === 0) {
          console.log(`  → Skipping ${year}: empty ZIP`);
          continue;
        }

        // The ZIP contains one text file
        const textContent = entries[0].getData().toString("utf8");
        const positions = parseCOTFile(textContent, true); // Annual files have headers

        allPositions.push(...positions);
        console.log(`  → Parsed ${positions.length} positions for ${year}`);

        // Rate limit between years
        await new Promise((r) => setTimeout(r, 1000));
      } catch (error) {
        console.error(`  → Error processing ${year}:`, error);
      }
    }

    // Calculate weekly changes across the full dataset
    calculateWeeklyChanges(allPositions);

    // Write all to ClickHouse in batches
    const BATCH_SIZE = 1000;
    for (let i = 0; i < allPositions.length; i += BATCH_SIZE) {
      const batch = allPositions.slice(i, i + BATCH_SIZE);
      const written = await writeToClickHouse(clickhouse, batch);
      totalPositions += written;
      process.stdout.write(`\r  Writing to ClickHouse: ${totalPositions.toLocaleString()} positions`);
    }

    console.log("\n\n" + "=".repeat(60));
    console.log(`Backfill complete: ${totalPositions.toLocaleString()} total positions`);
    console.log(`Years: ${startYear}-${currentYear}`);
    console.log(`Pairs: ${Object.values(CME_TO_PAIR).join(", ")}`);
    console.log("=".repeat(60));
  } finally {
    await clickhouse.close();
  }
}

/**
 * Fetch the latest weekly COT report.
 * Writes to both ClickHouse (archive) and TimescaleDB (UI display).
 */
export async function fetchLatestCOT(): Promise<void> {
  console.log("=".repeat(60));
  console.log("CFTC COT Weekly Update");
  console.log("=".repeat(60));

  const clickhouse = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || "default",
    password: process.env.CLICKHOUSE_PASSWORD || "",
  });

  const timescaleUrl = process.env.TIMESCALE_URL?.replace(/[?&]sslmode=[^&]+/, "");
  const timescale = timescaleUrl
    ? new Pool({ connectionString: timescaleUrl, ssl: { rejectUnauthorized: false } })
    : null;

  try {
    // Fetch current week's data
    console.log(`\nFetching ${CFTC_WEEKLY_URL}...`);
    const response = await fetch(CFTC_WEEKLY_URL);
    if (!response.ok) {
      throw new Error(`CFTC fetch failed: HTTP ${response.status}`);
    }

    const text = await response.text();
    const positions = parseCOTFile(text, false); // Weekly file has no headers

    if (positions.length === 0) {
      console.log("  → No currency futures data found in weekly file");
      return;
    }

    console.log(`  → Parsed ${positions.length} positions`);

    // Get previous week's data for weekly change calculation
    const prevWeek = await getPreviousWeekPositions(clickhouse);
    for (const pos of positions) {
      const prev = prevWeek.get(pos.pair);
      if (prev) {
        pos.weekly_change_lev_money = pos.lev_money_net_positions - prev.levMoney;
        pos.weekly_change_asset_mgr = pos.asset_mgr_net_positions - prev.assetMgr;
      }
    }

    // Write to ClickHouse
    const chWritten = await writeToClickHouse(clickhouse, positions);
    console.log(`  → ClickHouse: ${chWritten} positions`);

    // Calculate percentiles and write to TimescaleDB
    if (timescale) {
      const percentiles = await calculatePercentiles(clickhouse, positions);
      const tsWritten = await writeToTimescale(timescale, positions, percentiles);
      console.log(`  → TimescaleDB: ${tsWritten} positions (with percentiles)`);
    }

    // Log summary
    const reportDate = positions[0]?.report_date || "unknown";
    console.log(`\n  Report date: ${reportDate}`);
    for (const pos of positions) {
      const dir = pos.lev_money_net_positions > 0 ? "LONG" : "SHORT";
      const absNet = Math.abs(pos.lev_money_net_positions).toLocaleString();
      const change = pos.weekly_change_lev_money;
      const changeStr = change > 0 ? `+${change.toLocaleString()}` : change.toLocaleString();
      console.log(
        `  ${pos.pair.padEnd(8)} Smart Money: ${dir} ${absNet.padStart(8)} (${changeStr})`
      );
    }

    console.log("\n" + "=".repeat(60));
    console.log("Weekly update complete");
    console.log("=".repeat(60));
  } finally {
    await clickhouse.close();
    if (timescale) await timescale.end();
  }
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "latest";

  switch (command) {
    case "backfill": {
      const startYear = parseInt(args[1] || "2006", 10);
      await backfillHistorical(startYear);
      break;
    }

    case "latest":
      await fetchLatestCOT();
      break;

    default:
      console.log("Usage:");
      console.log("  npx tsx cot-data.ts backfill [startYear]");
      console.log("  npx tsx cot-data.ts latest");
      console.log("");
      console.log("Examples:");
      console.log("  npx tsx cot-data.ts backfill 2006");
      console.log("  npx tsx cot-data.ts backfill 2020");
      console.log("  npx tsx cot-data.ts latest");
  }
}

// Run standalone if executed directly (ESM compatible)
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
