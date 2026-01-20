-- ═══════════════════════════════════════════════════════════════════════════════
-- TIMESCALE CONTINUOUS AGGREGATES - Auto-rollup M1 → Higher Timeframes
-- ═══════════════════════════════════════════════════════════════════════════════
-- Execute in Supabase SQL Editor AFTER 001-timescale-schema.sql
-- These views auto-update as M1 candles are inserted

-- ═══════════════════════════════════════════════════════════════════════════════
-- M5 from M1
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_m5
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS time,
    pair,
    'M5'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume,
    bool_or(is_displacement) AS has_displacement,
    max(displacement_score) AS max_displacement_score
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('5 minutes', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_m5',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- M15 from M1
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_m15
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', time) AS time,
    pair,
    'M15'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume,
    bool_or(is_displacement) AS has_displacement,
    max(displacement_score) AS max_displacement_score
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('15 minutes', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_m15',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- M30 from M1
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_m30
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('30 minutes', time) AS time,
    pair,
    'M30'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('30 minutes', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_m30',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- H1 from M1
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_h1
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS time,
    pair,
    'H1'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('1 hour', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_h1',
    start_offset => INTERVAL '6 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- H4 from H1 (cascading aggregate)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_h4
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('4 hours', time) AS time,
    pair,
    'H4'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles_h1
GROUP BY time_bucket('4 hours', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_h4',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '4 hours',
    schedule_interval => INTERVAL '4 hours',
    if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- D1 from H1 (daily)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_d1
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS time,
    pair,
    'D'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles_h1
GROUP BY time_bucket('1 day', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_d1',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNIFIED VIEW FOR QUERYING ANY TIMEFRAME
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW candles_all AS
SELECT time, pair, timeframe, open, high, low, close, volume FROM candles WHERE timeframe = 'M1'
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_m5
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_m15
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_m30
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_h1
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_h4
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_d1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTION: Get candles for chart (uses unified view)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_candles(
    p_pair VARCHAR,
    p_timeframe VARCHAR,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    time TIMESTAMPTZ,
    open DECIMAL,
    high DECIMAL,
    low DECIMAL,
    close DECIMAL,
    volume INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT c.time, c.open, c.high, c.low, c.close, c.volume::INTEGER
    FROM candles_all c
    WHERE c.pair = p_pair
    AND c.timeframe = p_timeframe
    AND c.time BETWEEN p_start AND p_end
    ORDER BY c.time ASC;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTION: Get candle count per pair/timeframe
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_candle_count(
    p_pair VARCHAR,
    p_timeframe VARCHAR
)
RETURNS INTEGER AS $$
DECLARE
    result INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER INTO result
    FROM candles_all
    WHERE pair = p_pair AND timeframe = p_timeframe;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTION: Upsert candle (for streaming worker)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION upsert_candle(
    p_time TIMESTAMPTZ,
    p_pair VARCHAR,
    p_timeframe VARCHAR,
    p_open DECIMAL,
    p_high DECIMAL,
    p_low DECIMAL,
    p_close DECIMAL,
    p_volume INTEGER DEFAULT 0,
    p_complete BOOLEAN DEFAULT true
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO candles (time, pair, timeframe, open, high, low, close, volume, complete)
    VALUES (p_time, p_pair, p_timeframe, p_open, p_high, p_low, p_close, p_volume, p_complete)
    ON CONFLICT (time, pair, timeframe)
    DO UPDATE SET
        high = GREATEST(candles.high, EXCLUDED.high),
        low = LEAST(candles.low, EXCLUDED.low),
        close = EXCLUDED.close,
        volume = candles.volume + EXCLUDED.volume,
        complete = EXCLUDED.complete;
END;
$$ LANGUAGE plpgsql;
