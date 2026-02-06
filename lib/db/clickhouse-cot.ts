/**
 * COT (Commitments of Traders) queries for ClickHouse
 *
 * Handles full historical analytics (2006-present).
 * For recent UI data, use cot.ts (TimescaleDB) instead.
 */

import { getClickHouseClient } from "./index";

// =============================================================================
// Types
// =============================================================================

export interface COTHistoricalPosition {
  report_date: string;
  pair: string;
  cme_contract: string;
  open_interest: number;
  dealer_net_positions: number;
  asset_mgr_net_positions: number;
  lev_money_net_positions: number;
  other_rpt_net_positions: number;
  nonrpt_net_positions: number;
  weekly_change_lev_money: number;
  weekly_change_asset_mgr: number;
}

export interface COTExtremes {
  pair: string;
  lookback_weeks: number;
  max_lev_money_net: number;
  min_lev_money_net: number;
  current_lev_money_net: number;
  current_percentile: number;
  max_asset_mgr_net: number;
  min_asset_mgr_net: number;
  current_asset_mgr_net: number;
}

// =============================================================================
// Queries
// =============================================================================

/**
 * Get full COT history for a pair from ClickHouse.
 * Used by Claude for deep historical analysis.
 */
export async function getCOTHistoryFromClickHouse(
  pair: string,
  startDate?: string,
  endDate?: string,
  limit: number = 1000
): Promise<COTHistoricalPosition[]> {
  const client = getClickHouseClient();

  let whereClause = "WHERE pair = {pair:String}";
  const params: Record<string, string | number> = { pair };

  if (startDate) {
    whereClause += " AND report_date >= {startDate:String}";
    params.startDate = startDate;
  }
  if (endDate) {
    whereClause += " AND report_date <= {endDate:String}";
    params.endDate = endDate;
  }

  const query = await client.query({
    query: `
      SELECT
        report_date,
        pair,
        cme_contract,
        open_interest,
        dealer_net_positions,
        asset_mgr_net_positions,
        lev_money_net_positions,
        other_rpt_net_positions,
        nonrpt_net_positions,
        weekly_change_lev_money,
        weekly_change_asset_mgr
      FROM cot_positions
      ${whereClause}
      ORDER BY report_date ASC
      LIMIT {limit:UInt32}
    `,
    query_params: { ...params, limit },
    format: "JSONEachRow",
  });

  return query.json<COTHistoricalPosition>();
}

/**
 * Get positioning extremes for a pair over a lookback period.
 * Used for extreme detection and contrarian signals.
 */
export async function getCOTExtremes(
  pair: string,
  lookbackWeeks: number = 156 // 3 years
): Promise<COTExtremes | null> {
  const client = getClickHouseClient();

  const query = await client.query({
    query: `
      WITH recent AS (
        SELECT lev_money_net_positions, asset_mgr_net_positions
        FROM cot_positions
        WHERE pair = {pair:String}
        ORDER BY report_date DESC
        LIMIT {lookback:UInt32}
      ),
      current_val AS (
        SELECT lev_money_net_positions, asset_mgr_net_positions
        FROM cot_positions
        WHERE pair = {pair:String}
        ORDER BY report_date DESC
        LIMIT 1
      )
      SELECT
        max(recent.lev_money_net_positions) AS max_lev,
        min(recent.lev_money_net_positions) AS min_lev,
        max(recent.asset_mgr_net_positions) AS max_asset,
        min(recent.asset_mgr_net_positions) AS min_asset,
        (SELECT lev_money_net_positions FROM current_val) AS curr_lev,
        (SELECT asset_mgr_net_positions FROM current_val) AS curr_asset,
        countIf(recent.lev_money_net_positions < (SELECT lev_money_net_positions FROM current_val)) AS below_count,
        count() AS total_count
      FROM recent
    `,
    query_params: { pair, lookback: lookbackWeeks },
    format: "JSONEachRow",
  });

  const rows = await query.json<{
    max_lev: number;
    min_lev: number;
    max_asset: number;
    min_asset: number;
    curr_lev: number;
    curr_asset: number;
    below_count: number;
    total_count: number;
  }>();

  if (rows.length === 0 || rows[0].total_count === 0) return null;

  const row = rows[0];
  return {
    pair,
    lookback_weeks: lookbackWeeks,
    max_lev_money_net: row.max_lev,
    min_lev_money_net: row.min_lev,
    current_lev_money_net: row.curr_lev,
    current_percentile: Math.round((row.below_count / row.total_count) * 100),
    max_asset_mgr_net: row.max_asset,
    min_asset_mgr_net: row.min_asset,
    current_asset_mgr_net: row.curr_asset,
  };
}

/**
 * Get COT data at a specific date for backtesting context.
 */
export async function getCOTAtDate(
  pair: string,
  date: string
): Promise<COTHistoricalPosition | null> {
  const client = getClickHouseClient();

  const query = await client.query({
    query: `
      SELECT
        report_date,
        pair,
        cme_contract,
        open_interest,
        dealer_net_positions,
        asset_mgr_net_positions,
        lev_money_net_positions,
        other_rpt_net_positions,
        nonrpt_net_positions,
        weekly_change_lev_money,
        weekly_change_asset_mgr
      FROM cot_positions
      WHERE pair = {pair:String}
        AND report_date <= {date:String}
      ORDER BY report_date DESC
      LIMIT 1
    `,
    query_params: { pair, date },
    format: "JSONEachRow",
  });

  const rows = await query.json<COTHistoricalPosition>();
  return rows.length > 0 ? rows[0] : null;
}
