/**
 * COT (Commitments of Traders) queries for TimescaleDB
 *
 * Handles recent data (last 52 weeks) for UI display.
 * For full historical queries, use clickhouse-cot.ts instead.
 */

import { getTimescalePool } from "./index";

// =============================================================================
// Types
// =============================================================================

export interface COTPosition {
  report_date: string;
  pair: string;
  cme_contract: string;
  open_interest: number;
  dealer_net_positions: number;
  asset_mgr_net_positions: number;
  lev_money_net_positions: number;
  other_rpt_net_positions: number;
  nonrpt_net_positions: number;
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
  weekly_change_lev_money: number;
  weekly_change_asset_mgr: number;
  lev_money_percentile: number;
  asset_mgr_percentile: number;
}

export interface SentimentResult {
  sentiment: "bullish" | "bearish" | "neutral";
  strength: "strong" | "moderate" | "weak";
  isExtreme: boolean;
  extremeType?: "overbought" | "oversold";
}

export interface COTPositionWithSentiment extends COTPosition {
  sentiment: SentimentResult;
}

// =============================================================================
// Sentiment Classification
// =============================================================================

export function classifySentiment(position: COTPosition): SentimentResult {
  const { lev_money_net_positions, lev_money_percentile } = position;

  const isBullish = lev_money_net_positions > 0;

  // Strength from percentile distance from 50 (neutral)
  const distFromNeutral = Math.abs(lev_money_percentile - 50);
  const strength: SentimentResult["strength"] =
    distFromNeutral > 35 ? "strong" : distFromNeutral > 15 ? "moderate" : "weak";

  // Extreme: top/bottom 10th percentile
  const isExtreme = lev_money_percentile >= 90 || lev_money_percentile <= 10;

  const sentiment: SentimentResult["sentiment"] =
    strength === "weak" ? "neutral" : isBullish ? "bullish" : "bearish";

  return {
    sentiment,
    strength,
    isExtreme,
    extremeType: isExtreme
      ? lev_money_percentile >= 90
        ? "overbought"
        : "oversold"
      : undefined,
  };
}

// =============================================================================
// Natural Language Summary (for Claude)
// =============================================================================

export function generateCOTSummary(position: COTPosition, sentiment: SentimentResult): string {
  const direction = position.lev_money_net_positions > 0 ? "long" : "short";
  const absNet = Math.abs(position.lev_money_net_positions).toLocaleString();
  const change = position.weekly_change_lev_money;
  const changeDir = change > 0 ? "up" : change < 0 ? "down" : "unchanged";
  const absChange = Math.abs(change).toLocaleString();
  const pairDisplay = position.pair.replace("_", "/");

  let summary = `Leveraged money (hedge funds) is net ${direction} ${pairDisplay} by ${absNet} contracts, ${changeDir} ${absChange} from last week.`;
  summary += ` This is at the ${position.lev_money_percentile}th percentile over the past year`;

  if (sentiment.isExtreme) {
    summary += ` — WARNING: EXTREME positioning (${sentiment.extremeType}). Historical reversals common at these levels.`;
  } else {
    summary += ` — ${sentiment.strength}ly ${sentiment.sentiment}.`;
  }

  return summary;
}

// =============================================================================
// Queries
// =============================================================================

function mapRow(row: Record<string, unknown>): COTPosition {
  return {
    report_date: String(row.report_date).split("T")[0],
    pair: String(row.pair),
    cme_contract: String(row.cme_contract),
    open_interest: Number(row.open_interest),
    dealer_net_positions: Number(row.dealer_net_positions),
    asset_mgr_net_positions: Number(row.asset_mgr_net_positions),
    lev_money_net_positions: Number(row.lev_money_net_positions),
    other_rpt_net_positions: Number(row.other_rpt_net_positions),
    nonrpt_net_positions: Number(row.nonrpt_net_positions),
    dealer_long: Number(row.dealer_long),
    dealer_short: Number(row.dealer_short),
    asset_mgr_long: Number(row.asset_mgr_long),
    asset_mgr_short: Number(row.asset_mgr_short),
    lev_money_long: Number(row.lev_money_long),
    lev_money_short: Number(row.lev_money_short),
    other_rpt_long: Number(row.other_rpt_long),
    other_rpt_short: Number(row.other_rpt_short),
    nonrpt_long: Number(row.nonrpt_long),
    nonrpt_short: Number(row.nonrpt_short),
    weekly_change_lev_money: Number(row.weekly_change_lev_money),
    weekly_change_asset_mgr: Number(row.weekly_change_asset_mgr),
    lev_money_percentile: Number(row.lev_money_percentile),
    asset_mgr_percentile: Number(row.asset_mgr_percentile),
  };
}

/**
 * Get the latest COT data for all pairs (one row per pair, most recent week).
 */
export async function getLatestCOTPositions(): Promise<COTPositionWithSentiment[]> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `SELECT DISTINCT ON (pair) *
     FROM cot_positions
     ORDER BY pair, report_date DESC`
  );

  return result.rows.map((row) => {
    const position = mapRow(row);
    return { ...position, sentiment: classifySentiment(position) };
  });
}

/**
 * Get the latest COT data for a single pair.
 */
export async function getLatestCOTForPair(pair: string): Promise<COTPositionWithSentiment | null> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `SELECT * FROM cot_positions
     WHERE pair = $1
     ORDER BY report_date DESC
     LIMIT 1`,
    [pair]
  );

  if (result.rows.length === 0) return null;

  const position = mapRow(result.rows[0]);
  return { ...position, sentiment: classifySentiment(position) };
}

/**
 * Get COT history for a specific pair (for the mini positioning chart).
 */
export async function getCOTHistory(
  pair: string,
  weeks: number = 52
): Promise<COTPosition[]> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `SELECT * FROM cot_positions
     WHERE pair = $1
     ORDER BY report_date DESC
     LIMIT $2`,
    [pair, weeks]
  );

  // Return in chronological order (oldest first) for charting
  return result.rows.map(mapRow).reverse();
}
