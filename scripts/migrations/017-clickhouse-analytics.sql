-- Migration 017: ClickHouse Structure Analytics
--
-- Materialized views for pre-computed structure analytics.
-- Backfill progress tracking table.
--
-- Run against ClickHouse (not TimescaleDB).

-- ═══════════════════════════════════════════════════════════════════════════════
-- Backfill Progress Tracking
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backfill_progress (
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    year_month String,
    rows_written UInt64,
    status LowCardinality(String),
    completed_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(completed_at)
ORDER BY (pair, timeframe, year_month);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FVG Effectiveness Materialized View
-- Tracks fill rates, timing, and gap sizes per pair/timeframe/direction/tier
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS fvg_effectiveness_mv
ENGINE = AggregatingMergeTree()
ORDER BY (pair, timeframe, direction, tier)
POPULATE
AS SELECT
    pair,
    timeframe,
    direction,
    tier,
    countState() AS total,
    countIfState(status = 'filled') AS filled,
    avgIfState(bars_to_fill, status = 'filled') AS avg_bars_to_fill,
    avgState(fill_percent) AS avg_fill_pct,
    avgState(gap_size_pips) AS avg_gap_pips
FROM fvg_events
GROUP BY pair, timeframe, direction, tier;

-- ═══════════════════════════════════════════════════════════════════════════════
-- BOS Follow-Through Materialized View
-- Tracks continuation vs reclaim rates, displacement frequency
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS bos_follow_through_mv
ENGINE = AggregatingMergeTree()
ORDER BY (pair, timeframe, direction)
POPULATE
AS SELECT
    pair,
    timeframe,
    direction,
    countState() AS total,
    countIfState(status = 'active') AS active_count,
    countIfState(status = 'reclaimed') AS reclaimed_count,
    avgState(magnitude_pips) AS avg_magnitude,
    countIfState(is_displacement = 1) AS displacement_count,
    countIfState(is_counter_trend = 1) AS counter_trend_count
FROM bos_events
GROUP BY pair, timeframe, direction;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Seasonal Bias Materialized View
-- Tracks directional BOS counts and magnitude by quarter/month
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS seasonal_bias_mv
ENGINE = AggregatingMergeTree()
ORDER BY (pair, timeframe, quarter, month, direction)
POPULATE
AS SELECT
    pair,
    timeframe,
    toQuarter(time) AS quarter,
    toMonth(time) AS month,
    direction,
    countState() AS bos_count,
    avgState(magnitude_pips) AS avg_magnitude
FROM bos_events
WHERE status = 'active'
GROUP BY pair, timeframe, quarter, month, direction;
