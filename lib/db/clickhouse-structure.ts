/**
 * Market Structure — ClickHouse Query Layer
 *
 * Read/write/aggregation functions for structure entity tables in ClickHouse.
 * Used by:
 * - Backfill worker (batch inserts)
 * - Archival worker (batch inserts from TimescaleDB)
 * - API routes (queries + aggregations)
 * - Materialized view reads (analytics endpoints)
 */

import { getClickHouseClient } from "./index";

// ═══════════════════════════════════════════════════════════════════════════════
// Types — Macro Range (existing)
// ═══════════════════════════════════════════════════════════════════════════════

export interface MacroRange {
  high: number;
  low: number;
}

interface MacroRangeRow {
  highest_high: string;
  lowest_low: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types — ClickHouse Row Shapes
// ═══════════════════════════════════════════════════════════════════════════════

export interface CHSwingPoint {
  time: string;
  pair: string;
  timeframe: string;
  price: number;
  swing_type: string;
  label: string;
  lookback_used: number;
  true_range: number;
}

export interface CHBOSEvent {
  time: string;
  pair: string;
  timeframe: string;
  direction: string;
  status: string;
  broken_level: number;
  broken_swing_time: string;
  confirming_close: number;
  magnitude_pips: number;
  is_displacement: number;
  is_counter_trend: number;
  reclaimed_at: string | null;
  reclaimed_by_close: number | null;
  time_til_reclaim_ms: number | null;
  bos_type: string;
}

export interface CHSweepEvent {
  time: string;
  pair: string;
  timeframe: string;
  direction: string;
  swept_level: number;
  wick_extreme: number;
  swept_level_type: string;
  followed_by_bos: number;
}

export interface CHKeyLevels {
  date: string;
  pair: string;
  pdh: number | null;
  pdl: number | null;
  pwh: number | null;
  pwl: number | null;
  pmh: number | null;
  pml: number | null;
  yh: number | null;
  yl: number | null;
}

export interface CHFVGEvent {
  time: string;
  pair: string;
  timeframe: string;
  direction: string;
  status: string;
  top_price: number;
  bottom_price: number;
  midline: number;
  gap_size_pips: number;
  displacement_body: number;
  displacement_range: number;
  gap_to_body_ratio: number;
  is_displacement: number;
  relative_volume: number;
  tier: number;
  fill_percent: number;
  max_fill_percent: number;
  body_filled: number;
  wick_touched: number;
  first_touch_at: string | null;
  first_touch_bars_after: number | null;
  retest_count: number;
  midline_respected: number;
  midline_touch_count: number;
  filled_at: string | null;
  bars_to_fill: number | null;
  inverted_at: string | null;
  bars_to_inversion: number | null;
  parent_bos: string | null;
  contained_by: string[];
  confluence_with: string[];
  trade_id: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types — Query Filters
// ═══════════════════════════════════════════════════════════════════════════════

export interface StructureQueryFilter {
  pair: string;
  timeframe?: string;
  startTime?: number; // Unix ms
  endTime?: number;   // Unix ms
  direction?: string;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Types — Aggregation Results
// ═══════════════════════════════════════════════════════════════════════════════

export interface FVGEffectivenessRow {
  pair: string;
  timeframe: string;
  direction: string;
  tier: number;
  total: number;
  filled: number;
  fillRate: number;
  avgBarsToFill: number;
  avgFillPercent: number;
  avgGapPips: number;
}

export interface BOSFollowThroughRow {
  pair: string;
  timeframe: string;
  direction: string;
  total: number;
  activeCount: number;
  reclaimedCount: number;
  continuationRate: number;
  reclaimRate: number;
  avgMagnitudePips: number;
  displacementCount: number;
  displacementRate: number;
  counterTrendCount: number;
}

export interface SeasonalBiasRow {
  pair: string;
  timeframe: string;
  quarter: number;
  month: number;
  direction: string;
  bosCount: number;
  avgMagnitudePips: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Macro Range Queries (existing)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getMacroRange(pair: string): Promise<MacroRange | null> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT highest_high, lowest_low
      FROM macro_ranges FINAL
      WHERE pair = {pair:String}
    `,
    query_params: { pair },
    format: "JSONEachRow",
  });

  const rows = await result.json<MacroRangeRow>();
  if (rows.length === 0) return null;

  const row = rows[0];
  const high = parseFloat(row.highest_high);
  const low = parseFloat(row.lowest_low);

  if (isNaN(high) || isNaN(low) || high <= low) return null;

  return { high, low };
}

export async function computeAndStoreMacroRange(pair: string): Promise<MacroRange | null> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT
        max(high) AS highest_high,
        min(low) AS lowest_low,
        min(toDate(time)) AS data_start_date,
        max(toDate(time)) AS data_end_date,
        count() AS candle_count
      FROM candles
      WHERE pair = {pair:String}
        AND timeframe = 'D'
    `,
    query_params: { pair },
    format: "JSONEachRow",
  });

  interface AggRow {
    highest_high: string;
    lowest_low: string;
    data_start_date: string;
    data_end_date: string;
    candle_count: string;
  }

  const rows = await result.json<AggRow>();
  if (rows.length === 0) return null;

  const row = rows[0];
  const high = parseFloat(row.highest_high);
  const low = parseFloat(row.lowest_low);

  if (isNaN(high) || isNaN(low) || high <= low) return null;

  await client.insert({
    table: "macro_ranges",
    values: [
      {
        pair,
        highest_high: high,
        lowest_low: low,
        data_start_date: row.data_start_date,
        data_end_date: row.data_end_date,
        candle_count: parseInt(row.candle_count),
      },
    ],
    format: "JSONEachRow",
  });

  return { high, low };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Batch Insert Functions (for backfill worker + archiver)
// ═══════════════════════════════════════════════════════════════════════════════

export async function insertSwingPointsBatch(rows: CHSwingPoint[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "swing_points",
    values: rows,
    format: "JSONEachRow",
  });
}

export async function insertBOSEventsBatch(rows: CHBOSEvent[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "bos_events",
    values: rows,
    format: "JSONEachRow",
  });
}

export async function insertSweepEventsBatch(rows: CHSweepEvent[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "sweep_events",
    values: rows,
    format: "JSONEachRow",
  });
}

export async function insertKeyLevelsBatch(rows: CHKeyLevels[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "key_levels",
    values: rows,
    format: "JSONEachRow",
  });
}

export async function insertFVGEventsBatch(rows: CHFVGEvent[]): Promise<void> {
  if (rows.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "fvg_events",
    values: rows,
    format: "JSONEachRow",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Query Functions (for API routes)
// ═══════════════════════════════════════════════════════════════════════════════

/** Build WHERE clause from filter, returns { clause, params } */
function buildWhereClause(
  filter: StructureQueryFilter,
  extraConditions?: string[]
): { clause: string; params: Record<string, unknown> } {
  const conditions: string[] = ["pair = {pair:String}"];
  const params: Record<string, unknown> = { pair: filter.pair };

  if (filter.timeframe) {
    conditions.push("timeframe = {timeframe:String}");
    params.timeframe = filter.timeframe;
  }
  if (filter.startTime) {
    conditions.push("time >= toDateTime64({startTime:UInt64} / 1000, 3)");
    params.startTime = filter.startTime;
  }
  if (filter.endTime) {
    conditions.push("time <= toDateTime64({endTime:UInt64} / 1000, 3)");
    params.endTime = filter.endTime;
  }
  if (filter.direction) {
    conditions.push("direction = {direction:String}");
    params.direction = filter.direction;
  }
  if (extraConditions) {
    conditions.push(...extraConditions);
  }

  return { clause: conditions.join(" AND "), params };
}

function pf(v: string): number {
  return parseFloat(String(v));
}

export async function getSwingPointsFromCH(
  filter: StructureQueryFilter
): Promise<CHSwingPoint[]> {
  const client = getClickHouseClient();
  const limit = Math.min(filter.limit || 1000, 5000);
  const offset = filter.offset || 0;
  const { clause, params } = buildWhereClause(filter);

  const result = await client.query({
    query: `
      SELECT time, pair, timeframe, price, swing_type, label, lookback_used, true_range
      FROM swing_points
      WHERE ${clause}
      ORDER BY time DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params: { ...params, limit, offset },
    format: "JSONEachRow",
  });

  interface Row { time: string; pair: string; timeframe: string; price: string; swing_type: string; label: string; lookback_used: string; true_range: string; }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    time: r.time,
    pair: r.pair,
    timeframe: r.timeframe,
    price: pf(r.price),
    swing_type: r.swing_type,
    label: r.label,
    lookback_used: parseInt(r.lookback_used),
    true_range: pf(r.true_range),
  }));
}

export async function getBOSEventsFromCH(
  filter: StructureQueryFilter & { isDisplacement?: boolean; isCounterTrend?: boolean }
): Promise<CHBOSEvent[]> {
  const client = getClickHouseClient();
  const limit = Math.min(filter.limit || 1000, 5000);
  const offset = filter.offset || 0;

  const extra: string[] = [];
  const extraParams: Record<string, unknown> = {};

  if (filter.isDisplacement !== undefined) {
    extra.push(`is_displacement = {isDisp:UInt8}`);
    extraParams.isDisp = filter.isDisplacement ? 1 : 0;
  }
  if (filter.isCounterTrend !== undefined) {
    extra.push(`is_counter_trend = {isCT:UInt8}`);
    extraParams.isCT = filter.isCounterTrend ? 1 : 0;
  }

  const { clause, params } = buildWhereClause(filter, extra);

  const result = await client.query({
    query: `
      SELECT time, pair, timeframe, direction, status, broken_level, broken_swing_time,
        confirming_close, magnitude_pips, is_displacement, is_counter_trend,
        reclaimed_at, reclaimed_by_close, time_til_reclaim_ms, bos_type
      FROM bos_events
      WHERE ${clause}
      ORDER BY time DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params: { ...params, ...extraParams, limit, offset },
    format: "JSONEachRow",
  });

  interface Row {
    time: string; pair: string; timeframe: string; direction: string; status: string;
    broken_level: string; broken_swing_time: string; confirming_close: string;
    magnitude_pips: string; is_displacement: string; is_counter_trend: string;
    reclaimed_at: string; reclaimed_by_close: string; time_til_reclaim_ms: string;
    bos_type: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    time: r.time,
    pair: r.pair,
    timeframe: r.timeframe,
    direction: r.direction,
    status: r.status,
    broken_level: pf(r.broken_level),
    broken_swing_time: r.broken_swing_time,
    confirming_close: pf(r.confirming_close),
    magnitude_pips: pf(r.magnitude_pips),
    is_displacement: parseInt(r.is_displacement),
    is_counter_trend: parseInt(r.is_counter_trend),
    reclaimed_at: r.reclaimed_at || null,
    reclaimed_by_close: r.reclaimed_by_close ? pf(r.reclaimed_by_close) : null,
    time_til_reclaim_ms: r.time_til_reclaim_ms ? parseInt(r.time_til_reclaim_ms) : null,
    bos_type: r.bos_type || "bos",
  }));
}

export async function getSweepEventsFromCH(
  filter: StructureQueryFilter & { sweptLevelType?: string; followedByBOS?: boolean }
): Promise<CHSweepEvent[]> {
  const client = getClickHouseClient();
  const limit = Math.min(filter.limit || 1000, 5000);
  const offset = filter.offset || 0;

  const extra: string[] = [];
  const extraParams: Record<string, unknown> = {};

  if (filter.sweptLevelType) {
    extra.push("swept_level_type = {slt:String}");
    extraParams.slt = filter.sweptLevelType;
  }
  if (filter.followedByBOS !== undefined) {
    extra.push("followed_by_bos = {fbb:UInt8}");
    extraParams.fbb = filter.followedByBOS ? 1 : 0;
  }

  const { clause, params } = buildWhereClause(filter, extra);

  const result = await client.query({
    query: `
      SELECT time, pair, timeframe, direction, swept_level, wick_extreme, swept_level_type, followed_by_bos
      FROM sweep_events
      WHERE ${clause}
      ORDER BY time DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params: { ...params, ...extraParams, limit, offset },
    format: "JSONEachRow",
  });

  interface Row {
    time: string; pair: string; timeframe: string; direction: string;
    swept_level: string; wick_extreme: string; swept_level_type: string; followed_by_bos: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    time: r.time,
    pair: r.pair,
    timeframe: r.timeframe,
    direction: r.direction,
    swept_level: pf(r.swept_level),
    wick_extreme: pf(r.wick_extreme),
    swept_level_type: r.swept_level_type,
    followed_by_bos: parseInt(r.followed_by_bos),
  }));
}

export async function getKeyLevelsFromCH(
  pair: string,
  startDate: string,
  endDate: string
): Promise<CHKeyLevels[]> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT date, pair, pdh, pdl, pwh, pwl, pmh, pml, yh, yl
      FROM key_levels FINAL
      WHERE pair = {pair:String} AND date >= {startDate:String} AND date <= {endDate:String}
      ORDER BY date DESC
      LIMIT 1000
    `,
    query_params: { pair, startDate, endDate },
    format: "JSONEachRow",
  });

  interface Row {
    date: string; pair: string;
    pdh: string; pdl: string; pwh: string; pwl: string;
    pmh: string; pml: string; yh: string; yl: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    date: r.date,
    pair: r.pair,
    pdh: r.pdh ? pf(r.pdh) : null,
    pdl: r.pdl ? pf(r.pdl) : null,
    pwh: r.pwh ? pf(r.pwh) : null,
    pwl: r.pwl ? pf(r.pwl) : null,
    pmh: r.pmh ? pf(r.pmh) : null,
    pml: r.pml ? pf(r.pml) : null,
    yh: r.yh ? pf(r.yh) : null,
    yl: r.yl ? pf(r.yl) : null,
  }));
}

export async function getFVGEventsFromCH(
  filter: StructureQueryFilter & { tier?: number; minGapPips?: number; status?: string }
): Promise<CHFVGEvent[]> {
  const client = getClickHouseClient();
  const limit = Math.min(filter.limit || 1000, 5000);
  const offset = filter.offset || 0;

  const extra: string[] = [];
  const extraParams: Record<string, unknown> = {};

  if (filter.tier) {
    extra.push("tier <= {tier:UInt8}");
    extraParams.tier = filter.tier;
  }
  if (filter.minGapPips) {
    extra.push("gap_size_pips >= {minGap:Float64}");
    extraParams.minGap = filter.minGapPips;
  }
  if (filter.status) {
    extra.push("status = {status:String}");
    extraParams.status = filter.status;
  }

  const { clause, params } = buildWhereClause(filter, extra);

  const result = await client.query({
    query: `
      SELECT time, pair, timeframe, direction, status,
        top_price, bottom_price, midline, gap_size_pips,
        displacement_body, displacement_range, gap_to_body_ratio,
        is_displacement, relative_volume, tier,
        fill_percent, max_fill_percent, body_filled, wick_touched,
        first_touch_at, first_touch_bars_after,
        retest_count, midline_respected, midline_touch_count,
        filled_at, bars_to_fill, inverted_at, bars_to_inversion,
        parent_bos, contained_by, confluence_with, trade_id
      FROM fvg_events
      WHERE ${clause}
      ORDER BY time DESC
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}
    `,
    query_params: { ...params, ...extraParams, limit, offset },
    format: "JSONEachRow",
  });

  interface Row {
    time: string; pair: string; timeframe: string; direction: string; status: string;
    top_price: string; bottom_price: string; midline: string; gap_size_pips: string;
    displacement_body: string; displacement_range: string; gap_to_body_ratio: string;
    is_displacement: string; relative_volume: string; tier: string;
    fill_percent: string; max_fill_percent: string; body_filled: string; wick_touched: string;
    first_touch_at: string; first_touch_bars_after: string;
    retest_count: string; midline_respected: string; midline_touch_count: string;
    filled_at: string; bars_to_fill: string; inverted_at: string; bars_to_inversion: string;
    parent_bos: string; contained_by: string[]; confluence_with: string[]; trade_id: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    time: r.time,
    pair: r.pair,
    timeframe: r.timeframe,
    direction: r.direction,
    status: r.status,
    top_price: pf(r.top_price),
    bottom_price: pf(r.bottom_price),
    midline: pf(r.midline),
    gap_size_pips: pf(r.gap_size_pips),
    displacement_body: pf(r.displacement_body),
    displacement_range: pf(r.displacement_range),
    gap_to_body_ratio: pf(r.gap_to_body_ratio),
    is_displacement: parseInt(r.is_displacement),
    relative_volume: pf(r.relative_volume),
    tier: parseInt(r.tier),
    fill_percent: pf(r.fill_percent),
    max_fill_percent: pf(r.max_fill_percent),
    body_filled: parseInt(r.body_filled),
    wick_touched: parseInt(r.wick_touched),
    first_touch_at: r.first_touch_at || null,
    first_touch_bars_after: r.first_touch_bars_after ? parseInt(r.first_touch_bars_after) : null,
    retest_count: parseInt(r.retest_count),
    midline_respected: parseInt(r.midline_respected),
    midline_touch_count: parseInt(r.midline_touch_count),
    filled_at: r.filled_at || null,
    bars_to_fill: r.bars_to_fill ? parseInt(r.bars_to_fill) : null,
    inverted_at: r.inverted_at || null,
    bars_to_inversion: r.bars_to_inversion ? parseInt(r.bars_to_inversion) : null,
    parent_bos: r.parent_bos || null,
    contained_by: r.contained_by || [],
    confluence_with: r.confluence_with || [],
    trade_id: r.trade_id || null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Count Functions (for pagination)
// ═══════════════════════════════════════════════════════════════════════════════

export async function countStructureEvents(
  table: "swing_points" | "bos_events" | "sweep_events" | "fvg_events",
  filter: StructureQueryFilter
): Promise<number> {
  const client = getClickHouseClient();
  const { clause, params } = buildWhereClause(filter);

  const result = await client.query({
    query: `SELECT count() AS cnt FROM ${table} WHERE ${clause}`,
    query_params: params,
    format: "JSONEachRow",
  });

  const rows = await result.json<{ cnt: string }>();
  return rows.length > 0 ? parseInt(rows[0].cnt) : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aggregation Functions (read from materialized views)
// ═══════════════════════════════════════════════════════════════════════════════

export async function getFVGEffectiveness(
  pair: string,
  timeframe?: string
): Promise<FVGEffectivenessRow[]> {
  const client = getClickHouseClient();

  const tfClause = timeframe ? "AND timeframe = {timeframe:String}" : "";
  const params: Record<string, unknown> = { pair };
  if (timeframe) params.timeframe = timeframe;

  const result = await client.query({
    query: `
      SELECT
        pair, timeframe, direction, tier,
        countMerge(total) AS total,
        countMerge(filled) AS filled,
        avgMerge(avg_bars_to_fill) AS avg_bars_to_fill,
        avgMerge(avg_fill_pct) AS avg_fill_pct,
        avgMerge(avg_gap_pips) AS avg_gap_pips
      FROM fvg_effectiveness_mv
      WHERE pair = {pair:String} ${tfClause}
      GROUP BY pair, timeframe, direction, tier
      ORDER BY timeframe, direction, tier
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  interface Row {
    pair: string; timeframe: string; direction: string; tier: string;
    total: string; filled: string; avg_bars_to_fill: string;
    avg_fill_pct: string; avg_gap_pips: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => {
    const total = parseInt(r.total);
    const filled = parseInt(r.filled);
    return {
      pair: r.pair,
      timeframe: r.timeframe,
      direction: r.direction,
      tier: parseInt(r.tier),
      total,
      filled,
      fillRate: total > 0 ? filled / total : 0,
      avgBarsToFill: pf(r.avg_bars_to_fill),
      avgFillPercent: pf(r.avg_fill_pct),
      avgGapPips: pf(r.avg_gap_pips),
    };
  });
}

export async function getBOSFollowThrough(
  pair: string,
  timeframe?: string
): Promise<BOSFollowThroughRow[]> {
  const client = getClickHouseClient();

  const tfClause = timeframe ? "AND timeframe = {timeframe:String}" : "";
  const params: Record<string, unknown> = { pair };
  if (timeframe) params.timeframe = timeframe;

  const result = await client.query({
    query: `
      SELECT
        pair, timeframe, direction,
        countMerge(total) AS total,
        countMerge(active_count) AS active_count,
        countMerge(reclaimed_count) AS reclaimed_count,
        avgMerge(avg_magnitude) AS avg_magnitude,
        countMerge(displacement_count) AS displacement_count,
        countMerge(counter_trend_count) AS counter_trend_count
      FROM bos_follow_through_mv
      WHERE pair = {pair:String} ${tfClause}
      GROUP BY pair, timeframe, direction
      ORDER BY timeframe, direction
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  interface Row {
    pair: string; timeframe: string; direction: string;
    total: string; active_count: string; reclaimed_count: string;
    avg_magnitude: string; displacement_count: string; counter_trend_count: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => {
    const total = parseInt(r.total);
    const activeCount = parseInt(r.active_count);
    const reclaimedCount = parseInt(r.reclaimed_count);
    const displacementCount = parseInt(r.displacement_count);
    return {
      pair: r.pair,
      timeframe: r.timeframe,
      direction: r.direction,
      total,
      activeCount,
      reclaimedCount,
      continuationRate: total > 0 ? activeCount / total : 0,
      reclaimRate: total > 0 ? reclaimedCount / total : 0,
      avgMagnitudePips: pf(r.avg_magnitude),
      displacementCount,
      displacementRate: total > 0 ? displacementCount / total : 0,
      counterTrendCount: parseInt(r.counter_trend_count),
    };
  });
}

export async function getSeasonalBias(
  pair: string,
  timeframe?: string
): Promise<SeasonalBiasRow[]> {
  const client = getClickHouseClient();

  const tfClause = timeframe ? "AND timeframe = {timeframe:String}" : "";
  const params: Record<string, unknown> = { pair };
  if (timeframe) params.timeframe = timeframe;

  const result = await client.query({
    query: `
      SELECT
        pair, timeframe, quarter, month, direction,
        countMerge(bos_count) AS bos_count,
        avgMerge(avg_magnitude) AS avg_magnitude
      FROM seasonal_bias_mv
      WHERE pair = {pair:String} ${tfClause}
      GROUP BY pair, timeframe, quarter, month, direction
      ORDER BY quarter, month, direction
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  interface Row {
    pair: string; timeframe: string; quarter: string; month: string;
    direction: string; bos_count: string; avg_magnitude: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    pair: r.pair,
    timeframe: r.timeframe,
    quarter: parseInt(r.quarter),
    month: parseInt(r.month),
    direction: r.direction,
    bosCount: parseInt(r.bos_count),
    avgMagnitudePips: pf(r.avg_magnitude),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Session Performance (from session_performance_mv)
// ═══════════════════════════════════════════════════════════════════════════════

export interface SessionPerformanceRow {
  pair: string;
  timeframe: string;
  session: string;
  total: number;
  bullishCount: number;
  bearishCount: number;
  bullishPct: number;
  avgMagnitudePips: number;
  displacementCount: number;
  displacementRate: number;
}

export async function getSessionPerformance(
  pair: string,
  timeframe?: string
): Promise<SessionPerformanceRow[]> {
  const client = getClickHouseClient();

  const tfClause = timeframe ? "AND timeframe = {timeframe:String}" : "";
  const params: Record<string, unknown> = { pair };
  if (timeframe) params.timeframe = timeframe;

  const result = await client.query({
    query: `
      SELECT
        pair, timeframe, session,
        countMerge(total) AS total,
        countMerge(bullish_count) AS bullish_count,
        countMerge(bearish_count) AS bearish_count,
        avgMerge(avg_magnitude) AS avg_magnitude,
        countMerge(displacement_count) AS displacement_count
      FROM session_performance_mv
      WHERE pair = {pair:String} ${tfClause}
      GROUP BY pair, timeframe, session
      ORDER BY timeframe, session
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  interface Row {
    pair: string; timeframe: string; session: string;
    total: string; bullish_count: string; bearish_count: string;
    avg_magnitude: string; displacement_count: string;
  }
  const rows = await result.json<Row>();

  return rows.map((r) => {
    const total = parseInt(r.total);
    const bullishCount = parseInt(r.bullish_count);
    const displacementCount = parseInt(r.displacement_count);
    return {
      pair: r.pair,
      timeframe: r.timeframe,
      session: r.session,
      total,
      bullishCount,
      bearishCount: parseInt(r.bearish_count),
      bullishPct: total > 0 ? bullishCount / total : 0,
      avgMagnitudePips: pf(r.avg_magnitude),
      displacementCount,
      displacementRate: total > 0 ? displacementCount / total : 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Regime Classification (from regime_classification_mv)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RegimeClassificationRow {
  pair: string;
  timeframe: string;
  yearMonth: number;
  total: number;
  bullishCount: number;
  bearishCount: number;
  avgMagnitudePips: number;
  regime: string;
}

export async function getRegimeClassification(
  pair: string,
  timeframe?: string
): Promise<RegimeClassificationRow[]> {
  const client = getClickHouseClient();

  const tfClause = timeframe ? "AND timeframe = {timeframe:String}" : "";
  const params: Record<string, unknown> = { pair };
  if (timeframe) params.timeframe = timeframe;

  const result = await client.query({
    query: `
      SELECT
        pair, timeframe, year_month,
        countMerge(total) AS total,
        countMerge(bullish_count) AS bullish_count,
        countMerge(bearish_count) AS bearish_count,
        avgMerge(avg_magnitude) AS avg_magnitude
      FROM regime_classification_mv
      WHERE pair = {pair:String} ${tfClause}
      GROUP BY pair, timeframe, year_month
      ORDER BY year_month DESC
    `,
    query_params: params,
    format: "JSONEachRow",
  });

  interface Row {
    pair: string; timeframe: string; year_month: string;
    total: string; bullish_count: string; bearish_count: string;
    avg_magnitude: string;
  }
  const rows = await result.json<Row>();

  // Compute overall average magnitude for volatile detection
  const allMagnitudes = rows.map((r) => pf(r.avg_magnitude)).filter((v) => !isNaN(v));
  const overallAvgMag = allMagnitudes.length > 0
    ? allMagnitudes.reduce((a, b) => a + b, 0) / allMagnitudes.length
    : 0;

  return rows.map((r) => {
    const total = parseInt(r.total);
    const bullishCount = parseInt(r.bullish_count);
    const bearishCount = parseInt(r.bearish_count);
    const avgMag = pf(r.avg_magnitude);
    const bullishPct = total > 0 ? bullishCount / total : 0;
    const bearishPct = total > 0 ? bearishCount / total : 0;

    let regime: string;
    if (overallAvgMag > 0 && avgMag > 2 * overallAvgMag) {
      regime = "volatile";
    } else if (bullishPct > 0.65) {
      regime = "trending_bullish";
    } else if (bearishPct > 0.65) {
      regime = "trending_bearish";
    } else if (total < 3 || Math.max(bullishPct, bearishPct) < 0.55) {
      regime = "ranging";
    } else {
      regime = "mixed";
    }

    return {
      pair: r.pair,
      timeframe: r.timeframe,
      yearMonth: parseInt(r.year_month),
      total,
      bullishCount,
      bearishCount,
      avgMagnitudePips: avgMag,
      regime,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Key Level Reaction Rates (computed at query time via cross-table join)
// ═══════════════════════════════════════════════════════════════════════════════

export interface KeyLevelReactionRow {
  pair: string;
  levelType: string;
  approaches: number;
  bounces: number;
  breaks: number;
  bounceRate: number;
  avgReactionPips: number;
}

export async function getKeyLevelReactionRates(
  pair: string
): Promise<KeyLevelReactionRow[]> {
  const client = getClickHouseClient();
  const pipMultiplier = pair.includes("JPY") ? 100 : 10000;
  const threshold = 5 / pipMultiplier; // 5 pips in price terms

  const levelTypes = ["pdh", "pdl", "pwh", "pwl", "pmh", "pml", "yh", "yl"] as const;
  const results: KeyLevelReactionRow[] = [];

  for (const levelType of levelTypes) {
    const result = await client.query({
      query: `
        WITH level_candles AS (
          SELECT
            c.time AS ctime,
            c.high,
            c.low,
            c.close,
            k.${levelType} AS level_price,
            leadInFrame(c.close, 1) OVER (ORDER BY c.time) AS next_close
          FROM candles c
          INNER JOIN key_levels k ON k.pair = c.pair AND k.date = toDate(c.time)
          WHERE c.pair = {pair:String}
            AND c.timeframe = 'D'
            AND k.${levelType} IS NOT NULL
        ),
        approaches AS (
          SELECT
            ctime,
            level_price,
            close,
            next_close,
            high,
            low,
            CASE
              WHEN next_close > level_price AND close <= level_price THEN 'break_up'
              WHEN next_close < level_price AND close >= level_price THEN 'break_down'
              ELSE 'bounce'
            END AS reaction
          FROM level_candles
          WHERE abs(high - level_price) <= {threshold:Float64}
             OR abs(low - level_price) <= {threshold:Float64}
             OR (low <= level_price AND high >= level_price)
        )
        SELECT
          count() AS approaches,
          countIf(reaction = 'bounce') AS bounces,
          countIf(reaction != 'bounce') AS breaks,
          avgIf(
            abs(next_close - close) * {pipMul:Float64},
            next_close IS NOT NULL
          ) AS avg_reaction_pips
        FROM approaches
      `,
      query_params: {
        pair,
        threshold,
        pipMul: pipMultiplier,
      },
      format: "JSONEachRow",
    });

    interface Row {
      approaches: string;
      bounces: string;
      breaks: string;
      avg_reaction_pips: string;
    }
    const rows = await result.json<Row>();

    if (rows.length > 0) {
      const r = rows[0];
      const approaches = parseInt(r.approaches);
      const bounces = parseInt(r.bounces);
      const breaks = parseInt(r.breaks);
      results.push({
        pair,
        levelType,
        approaches,
        bounces,
        breaks,
        bounceRate: approaches > 0 ? bounces / approaches : 0,
        avgReactionPips: pf(r.avg_reaction_pips),
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backfill Progress Tracking
// ═══════════════════════════════════════════════════════════════════════════════

export interface BackfillProgress {
  pair: string;
  timeframe: string;
  yearMonth: string;
  rowsWritten: number;
  status: string;
}

export async function getBackfillProgress(): Promise<BackfillProgress[]> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT pair, timeframe, year_month, rows_written, status
      FROM backfill_progress FINAL
      ORDER BY pair, timeframe, year_month
    `,
    format: "JSONEachRow",
  });

  interface Row { pair: string; timeframe: string; year_month: string; rows_written: string; status: string; }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    pair: r.pair,
    timeframe: r.timeframe,
    yearMonth: r.year_month,
    rowsWritten: parseInt(r.rows_written),
    status: r.status,
  }));
}

export async function updateBackfillProgress(
  pair: string,
  timeframe: string,
  yearMonth: string,
  rowsWritten: number,
  status: string
): Promise<void> {
  const client = getClickHouseClient();

  await client.insert({
    table: "backfill_progress",
    values: [{ pair, timeframe, year_month: yearMonth, rows_written: rowsWritten, status }],
    format: "JSONEachRow",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Candle Fetch (for backfill worker)
// ═══════════════════════════════════════════════════════════════════════════════

export interface CHCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getCandlesFromCH(
  pair: string,
  timeframe: string,
  startTime: string,
  endTime: string,
  limit: number = 10000
): Promise<CHCandle[]> {
  const client = getClickHouseClient();

  const result = await client.query({
    query: `
      SELECT time, open, high, low, close, volume
      FROM candles
      WHERE pair = {pair:String} AND timeframe = {timeframe:String}
        AND time >= {startTime:String} AND time <= {endTime:String}
      ORDER BY time ASC
      LIMIT {limit:UInt32}
    `,
    query_params: { pair, timeframe, startTime, endTime, limit },
    format: "JSONEachRow",
  });

  interface Row { time: string; open: string; high: string; low: string; close: string; volume: string; }
  const rows = await result.json<Row>();

  return rows.map((r) => ({
    time: r.time,
    open: pf(r.open),
    high: pf(r.high),
    low: pf(r.low),
    close: pf(r.close),
    volume: parseInt(r.volume),
  }));
}
