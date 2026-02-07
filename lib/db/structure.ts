/**
 * Market Structure — Database Query Layer
 *
 * Upsert and query functions for structure data in TimescaleDB.
 * Follows the pattern of lib/db/cot.ts.
 */

import { getTimescalePool } from "./index";
import type {
  SwingPoint,
  BOSEvent,
  SweepEvent,
  KeyLevelGrid,
  FVGEvent,
  CurrentStructure,
  StructureLabel,
} from "../structure/types";

// --- Upsert Functions ---

export async function upsertSwingPoints(
  pair: string,
  timeframe: string,
  swings: SwingPoint[]
): Promise<void> {
  if (swings.length === 0) return;

  const pool = getTimescalePool();

  for (const s of swings) {
    await pool.query(
      `INSERT INTO swing_points (time, pair, timeframe, price, swing_type, label, lookback_used, true_range)
       VALUES (to_timestamp($1::double precision / 1000), $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (time, pair, timeframe, swing_type)
       DO UPDATE SET label = EXCLUDED.label, true_range = EXCLUDED.true_range`,
      [
        s.timestamp,
        pair,
        timeframe,
        s.price,
        s.type,
        s.label,
        s.lookbackUsed,
        s.trueRange,
      ]
    );
  }
}

export async function upsertBOSEvents(
  pair: string,
  timeframe: string,
  events: BOSEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const pool = getTimescalePool();

  for (const e of events) {
    await pool.query(
      `INSERT INTO bos_events (time, pair, timeframe, direction, status, broken_level, broken_swing_time,
         confirming_close, magnitude_pips, is_displacement, is_counter_trend,
         reclaimed_at, reclaimed_by_close, time_til_reclaim_ms)
       VALUES (to_timestamp($1::double precision / 1000), $2, $3, $4, $5, $6,
         to_timestamp($7::double precision / 1000), $8, $9, $10, $11,
         ${e.reclaimedAt ? "to_timestamp($12::double precision / 1000)" : "NULL"},
         $13, $14)
       ON CONFLICT (time, pair, timeframe)
       DO UPDATE SET status = EXCLUDED.status,
         reclaimed_at = EXCLUDED.reclaimed_at,
         reclaimed_by_close = EXCLUDED.reclaimed_by_close,
         time_til_reclaim_ms = EXCLUDED.time_til_reclaim_ms`,
      [
        e.timestamp,
        pair,
        timeframe,
        e.direction,
        e.status,
        e.brokenLevel,
        e.brokenSwingTimestamp,
        e.confirmingClose,
        e.magnitudePips,
        e.isDisplacement,
        e.isCounterTrend,
        e.reclaimedAt ?? null,
        e.reclaimedByClose ?? null,
        e.timeTilReclaim ?? null,
      ]
    );
  }
}

export async function upsertSweepEvents(
  pair: string,
  timeframe: string,
  events: SweepEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const pool = getTimescalePool();

  for (const e of events) {
    await pool.query(
      `INSERT INTO sweep_events (time, pair, timeframe, direction, swept_level, wick_extreme, swept_level_type, followed_by_bos)
       VALUES (to_timestamp($1::double precision / 1000), $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (time, pair, timeframe)
       DO UPDATE SET followed_by_bos = EXCLUDED.followed_by_bos`,
      [
        e.timestamp,
        pair,
        timeframe,
        e.direction,
        e.sweptLevel,
        e.wickExtreme,
        e.sweptLevelType,
        e.followedByBOS,
      ]
    );
  }
}

export async function upsertKeyLevels(
  pair: string,
  date: string,
  levels: KeyLevelGrid
): Promise<void> {
  const pool = getTimescalePool();

  await pool.query(
    `INSERT INTO key_levels (date, pair, pdh, pdl, pwh, pwl, pmh, pml, yh, yl)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (date, pair)
     DO UPDATE SET pdh = EXCLUDED.pdh, pdl = EXCLUDED.pdl,
       pwh = EXCLUDED.pwh, pwl = EXCLUDED.pwl,
       pmh = EXCLUDED.pmh, pml = EXCLUDED.pml,
       yh = EXCLUDED.yh, yl = EXCLUDED.yl`,
    [
      date,
      pair,
      levels.pdh,
      levels.pdl,
      levels.pwh,
      levels.pwl,
      levels.pmh,
      levels.pml,
      levels.yh,
      levels.yl,
    ]
  );
}

// --- Read Functions ---

export async function getLatestSwings(
  pair: string,
  timeframe: string,
  limit: number = 100
): Promise<SwingPoint[]> {
  const pool = getTimescalePool();
  const result = await pool.query(
    `SELECT time, price, swing_type, label, lookback_used, true_range
     FROM swing_points
     WHERE pair = $1 AND timeframe = $2
     ORDER BY time DESC
     LIMIT $3`,
    [pair, timeframe, limit]
  );

  return result.rows.map((row) => ({
    timestamp: new Date(row.time).getTime(),
    price: parseFloat(row.price),
    type: row.swing_type as "high" | "low",
    label: row.label,
    candleIndex: -1, // not available from DB read
    lookbackUsed: row.lookback_used,
    trueRange: parseFloat(row.true_range),
  }));
}

export async function getActiveBOSEvents(
  pair: string,
  timeframe: string,
  limit: number = 50
): Promise<BOSEvent[]> {
  const pool = getTimescalePool();
  const result = await pool.query(
    `SELECT time, direction, status, broken_level, broken_swing_time,
       confirming_close, magnitude_pips, is_displacement, is_counter_trend,
       reclaimed_at, reclaimed_by_close, time_til_reclaim_ms
     FROM bos_events
     WHERE pair = $1 AND timeframe = $2
     ORDER BY time DESC
     LIMIT $3`,
    [pair, timeframe, limit]
  );

  return result.rows.map((row) => ({
    timestamp: new Date(row.time).getTime(),
    direction: row.direction,
    status: row.status,
    brokenLevel: parseFloat(row.broken_level),
    brokenSwingTimestamp: new Date(row.broken_swing_time).getTime(),
    confirmingClose: parseFloat(row.confirming_close),
    magnitudePips: parseFloat(row.magnitude_pips),
    isDisplacement: row.is_displacement,
    isCounterTrend: row.is_counter_trend,
    reclaimedAt: row.reclaimed_at ? new Date(row.reclaimed_at).getTime() : undefined,
    reclaimedByClose: row.reclaimed_by_close
      ? parseFloat(row.reclaimed_by_close)
      : undefined,
    timeTilReclaim: row.time_til_reclaim_ms
      ? parseInt(row.time_til_reclaim_ms)
      : undefined,
  }));
}

export async function getLatestKeyLevels(
  pair: string
): Promise<KeyLevelGrid | null> {
  const pool = getTimescalePool();
  const result = await pool.query(
    `SELECT pdh, pdl, pwh, pwl, pmh, pml, yh, yl
     FROM key_levels
     WHERE pair = $1
     ORDER BY date DESC
     LIMIT 1`,
    [pair]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    pdh: row.pdh ? parseFloat(row.pdh) : null,
    pdl: row.pdl ? parseFloat(row.pdl) : null,
    pwh: row.pwh ? parseFloat(row.pwh) : null,
    pwl: row.pwl ? parseFloat(row.pwl) : null,
    pmh: row.pmh ? parseFloat(row.pmh) : null,
    pml: row.pml ? parseFloat(row.pml) : null,
    yh: row.yh ? parseFloat(row.yh) : null,
    yl: row.yl ? parseFloat(row.yl) : null,
  };
}

// --- FVG Events ---

export async function upsertFVGEvents(
  pair: string,
  timeframe: string,
  events: FVGEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const pool = getTimescalePool();

  for (const e of events) {
    await pool.query(
      `INSERT INTO fvg_events (time, pair, timeframe, direction, status,
         top_price, bottom_price, midline, gap_size_pips,
         displacement_body, displacement_range, gap_to_body_ratio,
         is_displacement, relative_volume, tier,
         fill_percent, max_fill_percent, body_filled, wick_touched,
         first_touch_at, first_touch_bars_after,
         retest_count, midline_respected, midline_touch_count,
         filled_at, bars_to_fill, inverted_at, bars_to_inversion,
         parent_bos, contained_by, confluence_with, trade_id)
       VALUES (to_timestamp($1::double precision / 1000), $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
         $16, $17, $18, $19,
         ${e.firstTouchAt ? "to_timestamp($20::double precision / 1000)" : "NULL"},
         $21, $22, $23, $24,
         ${e.filledAt ? "to_timestamp($25::double precision / 1000)" : "NULL"},
         $26,
         ${e.invertedAt ? "to_timestamp($27::double precision / 1000)" : "NULL"},
         $28, $29, $30, $31, $32)
       ON CONFLICT (time, pair, timeframe, direction)
       DO UPDATE SET status = EXCLUDED.status,
         fill_percent = EXCLUDED.fill_percent,
         max_fill_percent = EXCLUDED.max_fill_percent,
         body_filled = EXCLUDED.body_filled,
         wick_touched = EXCLUDED.wick_touched,
         first_touch_at = EXCLUDED.first_touch_at,
         first_touch_bars_after = EXCLUDED.first_touch_bars_after,
         retest_count = EXCLUDED.retest_count,
         midline_respected = EXCLUDED.midline_respected,
         midline_touch_count = EXCLUDED.midline_touch_count,
         filled_at = EXCLUDED.filled_at,
         bars_to_fill = EXCLUDED.bars_to_fill,
         inverted_at = EXCLUDED.inverted_at,
         bars_to_inversion = EXCLUDED.bars_to_inversion,
         contained_by = EXCLUDED.contained_by,
         confluence_with = EXCLUDED.confluence_with`,
      [
        e.createdAt,                    // $1
        pair,                           // $2
        timeframe,                      // $3
        e.direction,                    // $4
        e.status,                       // $5
        e.topPrice,                     // $6
        e.bottomPrice,                  // $7
        e.midline,                      // $8
        e.gapSizePips,                  // $9
        e.displacementBody,             // $10
        e.displacementRange,            // $11
        e.gapToBodyRatio,               // $12
        e.isDisplacement,               // $13
        e.relativeVolume,               // $14
        e.tier,                         // $15
        e.fillPercent,                  // $16
        e.maxFillPercent,               // $17
        e.bodyFilled,                   // $18
        e.wickTouched,                  // $19
        e.firstTouchAt ?? null,         // $20
        e.firstTouchBarsAfter ?? null,  // $21
        e.retestCount,                  // $22
        e.midlineRespected,             // $23
        e.midlineTouchCount,            // $24
        e.filledAt ?? null,             // $25
        e.barsToFill ?? null,           // $26
        e.invertedAt ?? null,           // $27
        e.barsToInversion ?? null,      // $28
        e.parentBOS ?? null,            // $29
        e.containedBy ?? null,          // $30
        e.confluenceWith ?? null,       // $31
        e.tradeId ?? null,              // $32
      ]
    );
  }
}

export async function getActiveFVGs(
  pair: string,
  timeframe: string,
  limit: number = 100
): Promise<FVGEvent[]> {
  const pool = getTimescalePool();
  const result = await pool.query(
    `SELECT time, direction, status, top_price, bottom_price, midline,
       gap_size_pips, displacement_body, displacement_range, gap_to_body_ratio,
       is_displacement, relative_volume, tier,
       fill_percent, max_fill_percent, body_filled, wick_touched,
       first_touch_at, first_touch_bars_after,
       retest_count, midline_respected, midline_touch_count,
       filled_at, bars_to_fill, inverted_at, bars_to_inversion,
       parent_bos, contained_by, confluence_with, trade_id
     FROM fvg_events
     WHERE pair = $1 AND timeframe = $2 AND status IN ('fresh', 'partial')
     ORDER BY time DESC
     LIMIT $3`,
    [pair, timeframe, limit]
  );

  return result.rows.map((row) => ({
    id: `${pair}-${timeframe}-${new Date(row.time).getTime()}`,
    pair,
    timeframe,
    direction: row.direction,
    status: row.status,
    topPrice: parseFloat(row.top_price),
    bottomPrice: parseFloat(row.bottom_price),
    midline: parseFloat(row.midline),
    gapSizePips: parseFloat(row.gap_size_pips),
    createdAt: new Date(row.time).getTime(),
    displacementBody: parseFloat(row.displacement_body),
    displacementRange: parseFloat(row.displacement_range),
    gapToBodyRatio: parseFloat(row.gap_to_body_ratio),
    isDisplacement: row.is_displacement,
    relativeVolume: parseFloat(row.relative_volume),
    tier: row.tier,
    fillPercent: parseFloat(row.fill_percent),
    maxFillPercent: parseFloat(row.max_fill_percent),
    bodyFilled: row.body_filled,
    wickTouched: row.wick_touched,
    firstTouchAt: row.first_touch_at ? new Date(row.first_touch_at).getTime() : undefined,
    firstTouchBarsAfter: row.first_touch_bars_after ?? undefined,
    retestCount: row.retest_count,
    midlineRespected: row.midline_respected,
    midlineTouchCount: row.midline_touch_count,
    filledAt: row.filled_at ? new Date(row.filled_at).getTime() : undefined,
    barsToFill: row.bars_to_fill ?? undefined,
    invertedAt: row.inverted_at ? new Date(row.inverted_at).getTime() : undefined,
    barsToInversion: row.bars_to_inversion ?? undefined,
    parentBOS: row.parent_bos ?? undefined,
    containedBy: row.contained_by ?? undefined,
    confluenceWith: row.confluence_with ?? undefined,
    tradeId: row.trade_id ?? undefined,
    candleIndex: -1, // not available from DB read
  }));
}

// --- HTF Current Structure ---

export async function upsertHTFStructure(
  pair: string,
  timeframe: string,
  structure: CurrentStructure
): Promise<void> {
  const pool = getTimescalePool();

  await pool.query(
    `INSERT INTO htf_current_structure (pair, timeframe, direction, last_bos_direction, last_bos_timestamp, last_bos_level, swing_sequence, computed_at)
     VALUES ($1, $2, $3, $4, ${structure.lastBOS ? "to_timestamp($5::double precision / 1000)" : "NULL"}, $6, $7, NOW())
     ON CONFLICT (pair, timeframe)
     DO UPDATE SET direction = EXCLUDED.direction,
       last_bos_direction = EXCLUDED.last_bos_direction,
       last_bos_timestamp = EXCLUDED.last_bos_timestamp,
       last_bos_level = EXCLUDED.last_bos_level,
       swing_sequence = EXCLUDED.swing_sequence,
       computed_at = NOW()`,
    [
      pair,
      timeframe,
      structure.direction,
      structure.lastBOS?.direction ?? null,
      structure.lastBOS?.timestamp ?? null,
      structure.lastBOS?.brokenLevel ?? null,
      structure.swingSequence,
    ]
  );
}

export async function getHTFStructures(
  pair: string
): Promise<Record<string, CurrentStructure>> {
  const pool = getTimescalePool();

  const result = await pool.query(
    `SELECT timeframe, direction, last_bos_direction, last_bos_timestamp, last_bos_level, swing_sequence
     FROM htf_current_structure
     WHERE pair = $1`,
    [pair]
  );

  const structures: Record<string, CurrentStructure> = {};

  for (const row of result.rows) {
    structures[row.timeframe] = {
      direction: row.direction,
      lastBOS: row.last_bos_direction
        ? {
            timestamp: row.last_bos_timestamp ? new Date(row.last_bos_timestamp).getTime() : 0,
            direction: row.last_bos_direction,
            status: "active" as const,
            brokenLevel: row.last_bos_level ? parseFloat(row.last_bos_level) : 0,
            brokenSwingTimestamp: 0,
            confirmingClose: 0,
            magnitudePips: 0,
            isDisplacement: false,
            isCounterTrend: false,
          }
        : null,
      swingSequence: (row.swing_sequence || []) as StructureLabel[],
    };
  }

  return structures;
}
