-- Migration 018: Remaining ClickHouse Structure Analytics Views
--
-- Session performance by pair/timeframe and regime classification by month.
-- Key level reaction rates are computed at query time (cross-table join).
--
-- Run against ClickHouse (not TimescaleDB).

-- ═══════════════════════════════════════════════════════════════════════════════
-- Session Performance Materialized View
-- Tracks BOS events per trading session (Asian/London/NewYork)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS session_performance_mv
ENGINE = AggregatingMergeTree()
ORDER BY (pair, timeframe, session)
POPULATE
AS SELECT
    pair,
    timeframe,
    multiIf(
        toHour(time) >= 0 AND toHour(time) < 8, 'Asian',
        toHour(time) >= 8 AND toHour(time) < 16, 'London',
        'NewYork'
    ) AS session,
    countState() AS total,
    countIfState(direction = 'bullish') AS bullish_count,
    countIfState(direction = 'bearish') AS bearish_count,
    avgState(magnitude_pips) AS avg_magnitude,
    countIfState(is_displacement = 1) AS displacement_count
FROM bos_events
GROUP BY pair, timeframe, session;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Regime Classification Materialized View
-- Monthly BOS aggregations for trending/ranging/volatile regime detection
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS regime_classification_mv
ENGINE = AggregatingMergeTree()
ORDER BY (pair, timeframe, year_month)
POPULATE
AS SELECT
    pair,
    timeframe,
    toYYYYMM(time) AS year_month,
    countState() AS total,
    countIfState(direction = 'bullish') AS bullish_count,
    countIfState(direction = 'bearish') AS bearish_count,
    avgState(magnitude_pips) AS avg_magnitude
FROM bos_events
GROUP BY pair, timeframe, year_month;
