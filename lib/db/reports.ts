/**
 * Analysis Reports Database Operations
 *
 * Stores backtest/simulation results for later review and comparison.
 * Uses ClickHouse for historical storage.
 */

import { getClickHouseClient } from "./index";

export interface AnalysisReport {
  id: string;
  createdAt: Date;
  pair: string;
  timeframe: string;
  model: string;
  tpDist: number;
  slDist: number;
  chunkBars: number;
  featureLevels: Record<string, number>;
  aiMethod: string;
  aiModalities: string[];
  // Results
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  avgPnl: number;
  sharpe: number;
  sortino: number;
  // Candle range
  candlesStart: Date;
  candlesEnd: Date;
  candleCount: number;
  // Notes
  notes: string;
}

interface ClickHouseReportRow {
  id: string;
  created_at: string;
  pair: string;
  timeframe: string;
  model: string;
  tp_dist: number;
  sl_dist: number;
  chunk_bars: number;
  feature_levels: string;
  ai_method: string;
  ai_modalities: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  total_pnl: number;
  avg_pnl: number;
  sharpe: number;
  sortino: number;
  candles_start: string;
  candles_end: string;
  candle_count: number;
  notes: string;
}

/**
 * Initialize the analysis_reports table in ClickHouse
 */
export async function initReportsTable(): Promise<void> {
  const client = getClickHouseClient();

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS analysis_reports (
        id UUID DEFAULT generateUUIDv4(),
        created_at DateTime DEFAULT now(),
        pair String,
        timeframe String,
        model String,
        tp_dist Float64,
        sl_dist Float64,
        chunk_bars UInt16,
        feature_levels String,
        ai_method String,
        ai_modalities String,
        total_trades UInt32,
        wins UInt32,
        losses UInt32,
        win_rate Float64,
        profit_factor Float64,
        total_pnl Float64,
        avg_pnl Float64,
        sharpe Float64,
        sortino Float64,
        candles_start DateTime,
        candles_end DateTime,
        candle_count UInt32,
        notes String DEFAULT ''
      ) ENGINE = MergeTree()
      ORDER BY (pair, timeframe, created_at)
    `,
  });
}

/**
 * Save a new analysis report
 */
export async function saveReport(report: Omit<AnalysisReport, "id" | "createdAt">): Promise<string> {
  const client = getClickHouseClient();

  // Generate UUID
  const id = crypto.randomUUID();

  await client.insert({
    table: "analysis_reports",
    values: [
      {
        id,
        pair: report.pair,
        timeframe: report.timeframe,
        model: report.model,
        tp_dist: report.tpDist,
        sl_dist: report.slDist,
        chunk_bars: report.chunkBars,
        feature_levels: JSON.stringify(report.featureLevels),
        ai_method: report.aiMethod,
        ai_modalities: JSON.stringify(report.aiModalities),
        total_trades: report.totalTrades,
        wins: report.wins,
        losses: report.losses,
        win_rate: report.winRate,
        profit_factor: Number.isFinite(report.profitFactor) ? report.profitFactor : 0,
        total_pnl: report.totalPnl,
        avg_pnl: report.avgPnl,
        sharpe: Number.isFinite(report.sharpe) ? report.sharpe : 0,
        sortino: Number.isFinite(report.sortino) ? report.sortino : 0,
        candles_start: report.candlesStart.toISOString().slice(0, 19).replace("T", " "),
        candles_end: report.candlesEnd.toISOString().slice(0, 19).replace("T", " "),
        candle_count: report.candleCount,
        notes: report.notes || "",
      },
    ],
    format: "JSONEachRow",
  });

  return id;
}

/**
 * Get all reports, optionally filtered by pair/timeframe
 */
export async function getReports(options?: {
  pair?: string;
  timeframe?: string;
  limit?: number;
}): Promise<AnalysisReport[]> {
  const client = getClickHouseClient();

  const conditions: string[] = [];
  if (options?.pair) {
    conditions.push(`pair = '${options.pair}'`);
  }
  if (options?.timeframe) {
    conditions.push(`timeframe = '${options.timeframe}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = options?.limit ? `LIMIT ${options.limit}` : "LIMIT 100";

  const result = await client.query({
    query: `
      SELECT *
      FROM analysis_reports
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause}
    `,
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as ClickHouseReportRow[];

  return rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at),
    pair: row.pair,
    timeframe: row.timeframe,
    model: row.model,
    tpDist: row.tp_dist,
    slDist: row.sl_dist,
    chunkBars: row.chunk_bars,
    featureLevels: JSON.parse(row.feature_levels || "{}"),
    aiMethod: row.ai_method,
    aiModalities: JSON.parse(row.ai_modalities || "[]"),
    totalTrades: row.total_trades,
    wins: row.wins,
    losses: row.losses,
    winRate: row.win_rate,
    profitFactor: row.profit_factor,
    totalPnl: row.total_pnl,
    avgPnl: row.avg_pnl,
    sharpe: row.sharpe,
    sortino: row.sortino,
    candlesStart: new Date(row.candles_start),
    candlesEnd: new Date(row.candles_end),
    candleCount: row.candle_count,
    notes: row.notes,
  }));
}

/**
 * Get a single report by ID
 */
export async function getReportById(id: string): Promise<AnalysisReport | null> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT *
      FROM analysis_reports
      WHERE id = '${id}'
      LIMIT 1
    `,
    format: "JSONEachRow",
  });

  const data = await result.json();
  const rows = data as ClickHouseReportRow[];

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    pair: row.pair,
    timeframe: row.timeframe,
    model: row.model,
    tpDist: row.tp_dist,
    slDist: row.sl_dist,
    chunkBars: row.chunk_bars,
    featureLevels: JSON.parse(row.feature_levels || "{}"),
    aiMethod: row.ai_method,
    aiModalities: JSON.parse(row.ai_modalities || "[]"),
    totalTrades: row.total_trades,
    wins: row.wins,
    losses: row.losses,
    winRate: row.win_rate,
    profitFactor: row.profit_factor,
    totalPnl: row.total_pnl,
    avgPnl: row.avg_pnl,
    sharpe: row.sharpe,
    sortino: row.sortino,
    candlesStart: new Date(row.candles_start),
    candlesEnd: new Date(row.candles_end),
    candleCount: row.candle_count,
    notes: row.notes,
  };
}

/**
 * Delete a report by ID
 */
export async function deleteReport(id: string): Promise<void> {
  const client = getClickHouseClient();

  await client.command({
    query: `ALTER TABLE analysis_reports DELETE WHERE id = '${id}'`,
  });
}
