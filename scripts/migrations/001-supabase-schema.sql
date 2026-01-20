-- ═══════════════════════════════════════════════════════════════════════════════
-- SUPABASE SCHEMA - Trading System (No TimescaleDB)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Works with standard PostgreSQL on Supabase

-- ═══════════════════════════════════════════════════════════════════════════════
-- CANDLES (Hot Data - Last 30 Days)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS candles (
    time TIMESTAMPTZ NOT NULL,
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    open DECIMAL(10, 5) NOT NULL,
    high DECIMAL(10, 5) NOT NULL,
    low DECIMAL(10, 5) NOT NULL,
    close DECIMAL(10, 5) NOT NULL,
    volume INTEGER DEFAULT 0,
    complete BOOLEAN DEFAULT true,

    PRIMARY KEY (time, pair, timeframe)
);

-- Optimized indexes for chart queries
CREATE INDEX IF NOT EXISTS idx_candles_pair_tf_time ON candles (pair, timeframe, time DESC);
CREATE INDEX IF NOT EXISTS idx_candles_recent ON candles (time DESC) WHERE time > NOW() - INTERVAL '30 days';

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

    impact VARCHAR(10) NOT NULL,

    actual VARCHAR(50),
    forecast VARCHAR(50),
    previous VARCHAR(50),

    description TEXT,

    window_before_minutes INTEGER DEFAULT 15,
    window_after_minutes INTEGER NOT NULL,

    raw_source VARCHAR(20) DEFAULT 'jblanked',
    fetched_at TIMESTAMPTZ DEFAULT NOW(),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_timestamp ON news_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_news_type ON news_events (event_type);
CREATE INDEX IF NOT EXISTS idx_news_currency ON news_events (currency);
CREATE INDEX IF NOT EXISTS idx_news_impact ON news_events (impact);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PRICE REACTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_price_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) NOT NULL REFERENCES news_events(event_id),
    pair VARCHAR(10) NOT NULL,

    price_at_minus_15m DECIMAL(10, 5),
    price_at_minus_5m DECIMAL(10, 5),
    price_at_event DECIMAL(10, 5) NOT NULL,

    spike_high DECIMAL(10, 5) NOT NULL,
    spike_low DECIMAL(10, 5) NOT NULL,
    spike_direction VARCHAR(10) NOT NULL,
    spike_magnitude_pips DECIMAL(8, 2) NOT NULL,
    time_to_spike_seconds INTEGER,

    price_at_plus_5m DECIMAL(10, 5),
    price_at_plus_15m DECIMAL(10, 5),
    price_at_plus_30m DECIMAL(10, 5),
    price_at_plus_60m DECIMAL(10, 5),

    pattern_type VARCHAR(50) NOT NULL,
    did_reverse BOOLEAN NOT NULL,
    reversal_magnitude_pips DECIMAL(8, 2),
    final_matches_spike BOOLEAN NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epr_event ON event_price_reactions (event_id);
CREATE INDEX IF NOT EXISTS idx_epr_pair ON event_price_reactions (pair);
CREATE UNIQUE INDEX IF NOT EXISTS idx_epr_event_pair ON event_price_reactions (event_id, pair);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SESSION LEVELS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    date DATE NOT NULL,

    asia_high DECIMAL(10, 5),
    asia_low DECIMAL(10, 5),
    asia_open DECIMAL(10, 5),
    asia_close DECIMAL(10, 5),

    london_high DECIMAL(10, 5),
    london_low DECIMAL(10, 5),
    london_open DECIMAL(10, 5),
    london_close DECIMAL(10, 5),

    ny_high DECIMAL(10, 5),
    ny_low DECIMAL(10, 5),
    ny_open DECIMAL(10, 5),
    ny_close DECIMAL(10, 5),

    daily_high DECIMAL(10, 5),
    daily_low DECIMAL(10, 5),
    daily_open DECIMAL(10, 5),
    daily_close DECIMAL(10, 5),

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(pair, date)
);

CREATE INDEX IF NOT EXISTS idx_session_pair_date ON session_levels (pair, date DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get candles for chart
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
    SELECT c.time, c.open, c.high, c.low, c.close, c.volume
    FROM candles c
    WHERE c.pair = p_pair
    AND c.timeframe = p_timeframe
    AND c.time BETWEEN p_start AND p_end
    ORDER BY c.time ASC;
END;
$$ LANGUAGE plpgsql;

-- Get nearby news events
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

-- Upsert candle (for streaming)
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- ENABLE ROW LEVEL SECURITY (optional, for future auth)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ALTER TABLE candles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE news_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE event_price_reactions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE session_levels ENABLE ROW LEVEL SECURITY;
