-- ═══════════════════════════════════════════════════════════════════════════════
-- TIMESCALE SCHEMA - Trading System Migration
-- ═══════════════════════════════════════════════════════════════════════════════
-- Execute in Supabase SQL Editor
-- Prerequisite: CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CANDLES (Hot Data - Last 30 Days, M1 base for aggregates)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS candles (
    time TIMESTAMPTZ NOT NULL,
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,  -- 'M1', 'M5', 'M15', 'H1', 'H4', 'D'
    open DECIMAL(10, 5) NOT NULL,
    high DECIMAL(10, 5) NOT NULL,
    low DECIMAL(10, 5) NOT NULL,
    close DECIMAL(10, 5) NOT NULL,
    volume INTEGER DEFAULT 0,
    complete BOOLEAN DEFAULT true,

    -- Velocity data (calculated on close)
    time_to_high_ms INTEGER,
    time_to_low_ms INTEGER,
    high_formed_first BOOLEAN,
    body_percent DECIMAL(5, 2),
    range_pips DECIMAL(8, 2),
    is_displacement BOOLEAN DEFAULT false,
    displacement_score DECIMAL(5, 2),

    PRIMARY KEY (time, pair, timeframe)
);

-- Convert to hypertable (automatic time partitioning)
SELECT create_hypertable('candles', 'time', if_not_exists => TRUE);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_candles_pair_tf ON candles (pair, timeframe, time DESC);
CREATE INDEX IF NOT EXISTS idx_candles_displacement ON candles (pair, timeframe, is_displacement) WHERE is_displacement = true;

-- Enable compression for data older than 7 days
ALTER TABLE candles SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'pair, timeframe'
);
SELECT add_compression_policy('candles', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention policy: Keep only last 30 days (older data goes to ClickHouse)
SELECT add_retention_policy('candles', INTERVAL '30 days', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- NEWS EVENTS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,

    country VARCHAR(10) NOT NULL,
    currency VARCHAR(5) NOT NULL,

    timestamp TIMESTAMPTZ NOT NULL,

    impact VARCHAR(10) NOT NULL,  -- 'high', 'medium', 'low'

    actual VARCHAR(50),
    forecast VARCHAR(50),
    previous VARCHAR(50),
    surprise_factor DECIMAL(10, 4),

    description TEXT,

    -- Window configuration
    window_before_minutes INTEGER DEFAULT 15,
    window_after_minutes INTEGER NOT NULL,  -- 15, 60, or 90 based on tier

    -- Metadata
    raw_source VARCHAR(20) DEFAULT 'jblanked',
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    data_version INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_timestamp ON news_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_news_type ON news_events (event_type);
CREATE INDEX IF NOT EXISTS idx_news_currency ON news_events (currency);
CREATE INDEX IF NOT EXISTS idx_news_impact ON news_events (impact);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PRICE REACTIONS (Calculated from windows)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_price_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) NOT NULL REFERENCES news_events(event_id),
    pair VARCHAR(10) NOT NULL,

    -- Pre-event prices
    price_at_minus_15m DECIMAL(10, 5),
    price_at_minus_5m DECIMAL(10, 5),
    price_at_event DECIMAL(10, 5) NOT NULL,

    -- Spike data (first 5 minutes)
    spike_high DECIMAL(10, 5) NOT NULL,
    spike_low DECIMAL(10, 5) NOT NULL,
    spike_direction VARCHAR(10) NOT NULL,  -- 'UP', 'DOWN'
    spike_magnitude_pips DECIMAL(8, 2) NOT NULL,
    time_to_spike_seconds INTEGER,
    spike_velocity_pips_per_sec DECIMAL(8, 4),

    -- Settlement prices
    price_at_plus_5m DECIMAL(10, 5),
    price_at_plus_15m DECIMAL(10, 5),
    price_at_plus_30m DECIMAL(10, 5),
    price_at_plus_60m DECIMAL(10, 5),
    price_at_plus_90m DECIMAL(10, 5),

    -- Pattern classification
    pattern_type VARCHAR(50) NOT NULL,

    did_reverse BOOLEAN NOT NULL,
    reversal_magnitude_pips DECIMAL(8, 2),
    reversal_time_minutes INTEGER,
    final_direction VARCHAR(10),
    final_matches_spike BOOLEAN NOT NULL,

    -- Metadata
    calculation_version INTEGER DEFAULT 1,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epr_event ON event_price_reactions (event_id);
CREATE INDEX IF NOT EXISTS idx_epr_pair ON event_price_reactions (pair);
CREATE INDEX IF NOT EXISTS idx_epr_pattern ON event_price_reactions (pattern_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_epr_event_pair ON event_price_reactions (event_id, pair);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SESSION LEVELS (Daily)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    date DATE NOT NULL,

    -- Asia (00:00 - 08:00 UTC)
    asia_high DECIMAL(10, 5),
    asia_low DECIMAL(10, 5),
    asia_open DECIMAL(10, 5),
    asia_close DECIMAL(10, 5),
    asia_range_pips DECIMAL(8, 2),
    asia_time_of_high TIME,
    asia_time_of_low TIME,

    -- London (08:00 - 16:00 UTC)
    london_high DECIMAL(10, 5),
    london_low DECIMAL(10, 5),
    london_open DECIMAL(10, 5),
    london_close DECIMAL(10, 5),
    london_range_pips DECIMAL(8, 2),
    london_swept_asia_high BOOLEAN,
    london_swept_asia_low BOOLEAN,
    london_time_of_high TIME,
    london_time_of_low TIME,

    -- New York (13:00 - 21:00 UTC)
    ny_high DECIMAL(10, 5),
    ny_low DECIMAL(10, 5),
    ny_open DECIMAL(10, 5),
    ny_close DECIMAL(10, 5),
    ny_range_pips DECIMAL(8, 2),
    ny_swept_london_high BOOLEAN,
    ny_swept_london_low BOOLEAN,
    ny_swept_asia_high BOOLEAN,
    ny_swept_asia_low BOOLEAN,
    ny_time_of_high TIME,
    ny_time_of_low TIME,

    -- Daily
    daily_high DECIMAL(10, 5),
    daily_low DECIMAL(10, 5),
    daily_open DECIMAL(10, 5),
    daily_close DECIMAL(10, 5),
    daily_range_pips DECIMAL(8, 2),
    high_before_low BOOLEAN,

    -- Previous day reference
    previous_day_high DECIMAL(10, 5),
    previous_day_low DECIMAL(10, 5),
    swept_pdh BOOLEAN,
    swept_pdl BOOLEAN,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(pair, date)
);

CREATE INDEX IF NOT EXISTS idx_session_pair ON session_levels (pair, date DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- HTF LEVELS (Weekly/Monthly/Quarterly/Yearly)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS htf_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    date DATE NOT NULL,

    -- Weekly
    weekly_high DECIMAL(10, 5),
    weekly_low DECIMAL(10, 5),
    weekly_open DECIMAL(10, 5),
    previous_week_high DECIMAL(10, 5),
    previous_week_low DECIMAL(10, 5),

    -- Monthly
    monthly_high DECIMAL(10, 5),
    monthly_low DECIMAL(10, 5),
    monthly_open DECIMAL(10, 5),
    previous_month_high DECIMAL(10, 5),
    previous_month_low DECIMAL(10, 5),

    -- Quarterly
    quarterly_high DECIMAL(10, 5),
    quarterly_low DECIMAL(10, 5),
    quarterly_open DECIMAL(10, 5),
    previous_quarter_high DECIMAL(10, 5),
    previous_quarter_low DECIMAL(10, 5),

    -- Yearly
    yearly_high DECIMAL(10, 5),
    yearly_low DECIMAL(10, 5),
    yearly_open DECIMAL(10, 5),
    previous_year_high DECIMAL(10, 5),
    previous_year_low DECIMAL(10, 5),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(pair, date)
);

CREATE INDEX IF NOT EXISTS idx_htf_pair ON htf_levels (pair, date DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FVGs (Fair Value Gaps)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fvgs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,

    direction VARCHAR(10) NOT NULL,  -- 'bullish', 'bearish'

    gap_high DECIMAL(10, 5) NOT NULL,
    gap_low DECIMAL(10, 5) NOT NULL,
    gap_size_pips DECIMAL(8, 2) NOT NULL,
    gap_midpoint DECIMAL(10, 5) NOT NULL,

    displacement_velocity DECIMAL(10, 4),
    displacement_body_percent DECIMAL(5, 2),

    session_formed VARCHAR(20),  -- 'asia', 'london', 'new_york'
    near_htf_level BOOLEAN DEFAULT false,
    htf_level_name VARCHAR(50),

    status VARCHAR(20) NOT NULL DEFAULT 'unfilled',  -- 'unfilled', 'partial', 'filled'
    fill_percentage DECIMAL(5, 2) DEFAULT 0,
    time_to_fill_minutes INTEGER,
    candles_to_fill INTEGER,

    traded BOOLEAN DEFAULT false,
    trade_result VARCHAR(20),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('fvgs', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_fvgs_pair_tf ON fvgs (pair, timeframe, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fvgs_status ON fvgs (status) WHERE status = 'unfilled';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SWEEPS (Liquidity Sweeps)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sweeps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,

    level_swept VARCHAR(50) NOT NULL,  -- 'asia_high', 'pdl', 'pwh', 'equal_lows'
    level_price DECIMAL(10, 5) NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- 'above', 'below'

    exceeded_by_pips DECIMAL(8, 2) NOT NULL,
    time_beyond_level_seconds INTEGER,
    candles_beyond_level INTEGER,
    sweep_velocity DECIMAL(10, 4),

    immediate_reversal BOOLEAN,
    reversal_followed BOOLEAN,
    reversal_size_pips DECIMAL(8, 2),
    reversal_duration_candles INTEGER,

    traded BOOLEAN DEFAULT false,
    trade_result VARCHAR(20),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('sweeps', 'timestamp', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_sweeps_pair ON sweeps (pair, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sweeps_level ON sweeps (level_swept);

-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS FOR COMMON QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Latest session levels per pair
CREATE OR REPLACE VIEW latest_session_levels AS
SELECT DISTINCT ON (pair) *
FROM session_levels
ORDER BY pair, date DESC;

-- Unfilled FVGs (last 7 days)
CREATE OR REPLACE VIEW active_fvgs AS
SELECT * FROM fvgs
WHERE status = 'unfilled'
AND timestamp > NOW() - INTERVAL '7 days';

-- Recent sweeps (last 24 hours)
CREATE OR REPLACE VIEW recent_sweeps AS
SELECT * FROM sweeps
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS FOR COMMON OPERATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get news events near a timestamp
CREATE OR REPLACE FUNCTION get_nearby_news(
    p_timestamp TIMESTAMPTZ,
    p_window_hours INTEGER DEFAULT 4
)
RETURNS TABLE (
    event_id VARCHAR,
    event_type VARCHAR,
    name VARCHAR,
    currency VARCHAR,
    impact VARCHAR,
    timestamp TIMESTAMPTZ,
    minutes_from_input DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        n.event_id,
        n.event_type,
        n.name,
        n.currency,
        n.impact,
        n.timestamp,
        EXTRACT(EPOCH FROM (n.timestamp - p_timestamp)) / 60 as minutes_from_input
    FROM news_events n
    WHERE n.timestamp BETWEEN p_timestamp - (p_window_hours || ' hours')::INTERVAL
                          AND p_timestamp + (p_window_hours || ' hours')::INTERVAL
    ORDER BY ABS(EXTRACT(EPOCH FROM (n.timestamp - p_timestamp)));
END;
$$ LANGUAGE plpgsql;
