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

-- ═══════════════════════════════════════════════════════════════════════════════
-- EVENT DEFINITIONS (Reference data - synced from JSON)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_definitions (
    event_name VARCHAR(255) PRIMARY KEY,
    aliases TEXT[] DEFAULT '{}',
    category VARCHAR(50),
    short_description TEXT,
    detailed_description TEXT,
    measures TEXT,
    release_frequency VARCHAR(50),
    typical_release_time VARCHAR(100),
    source_authority VARCHAR(255),
    country VARCHAR(10),
    primary_currency VARCHAR(5),
    secondary_currencies TEXT[] DEFAULT '{}',
    typical_impact VARCHAR(20),
    beat_interpretation JSONB,
    miss_interpretation JSONB,
    global_spillover VARCHAR(20),
    spillover_description TEXT,
    revision_tendency TEXT,
    related_events TEXT[] DEFAULT '{}',
    historical_context TEXT,
    trading_notes TEXT,

    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_def_category ON event_definitions (category);
CREATE INDEX IF NOT EXISTS idx_event_def_currency ON event_definitions (primary_currency);
CREATE INDEX IF NOT EXISTS idx_event_def_impact ON event_definitions (typical_impact);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SPEAKER DEFINITIONS (Reference data - synced from JSON)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS speaker_definitions (
    event_name VARCHAR(255) PRIMARY KEY,
    category VARCHAR(50),
    speaker JSONB NOT NULL,
    typical_impact VARCHAR(20),
    what_to_watch TEXT,
    market_sensitivity TEXT,
    regime_change_potential VARCHAR(20),
    regime_change_examples TEXT,
    primary_currency VARCHAR(5),
    related_events TEXT[] DEFAULT '{}',

    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_speaker_def_category ON speaker_definitions (category);
CREATE INDEX IF NOT EXISTS idx_speaker_def_currency ON speaker_definitions (primary_currency);
CREATE INDEX IF NOT EXISTS idx_speaker_def_impact ON speaker_definitions (typical_impact);

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Get event definition with news event
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_upcoming_news_with_definitions(
    p_hours_ahead INTEGER DEFAULT 24
)
RETURNS TABLE (
    event_id VARCHAR,
    event_type VARCHAR,
    name VARCHAR,
    currency VARCHAR,
    impact VARCHAR,
    timestamp TIMESTAMPTZ,
    -- From event_definitions
    short_description TEXT,
    beat_interpretation JSONB,
    miss_interpretation JSONB,
    global_spillover VARCHAR
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
        ed.short_description,
        ed.beat_interpretation,
        ed.miss_interpretation,
        ed.global_spillover
    FROM news_events n
    LEFT JOIN event_definitions ed ON n.name = ed.event_name
    WHERE n.timestamp BETWEEN NOW() AND NOW() + (p_hours_ahead || ' hours')::INTERVAL
    ORDER BY n.timestamp ASC;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GEOPOLITICAL EVENTS (Reference data - synced from JSON)
-- Duration-based events like wars, pandemics, crises
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS geopolitical_events (
    event_id VARCHAR(100) PRIMARY KEY,
    event_name VARCHAR(255) NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    category VARCHAR(50) NOT NULL,

    -- Status and dates
    status VARCHAR(20) NOT NULL,  -- active/completed/structural/dormant
    start_date DATE NOT NULL,
    end_date DATE,
    peak_crisis_date DATE,

    -- Complex nested data as JSONB
    dates JSONB,
    rumor_period JSONB,
    phases JSONB NOT NULL,
    pair_impacts JSONB NOT NULL,
    macro_backdrop JSONB,
    lessons_learned JSONB,

    -- Text fields
    short_description TEXT,
    detailed_description TEXT,
    trading_notes TEXT,
    global_spillover VARCHAR(20),

    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geo_status ON geopolitical_events (status);
CREATE INDEX IF NOT EXISTS idx_geo_category ON geopolitical_events (category);
CREATE INDEX IF NOT EXISTS idx_geo_dates ON geopolitical_events (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_geo_spillover ON geopolitical_events (global_spillover);

-- ═══════════════════════════════════════════════════════════════════════════════
-- GPR INDEX (Geopolitical Risk Index - Monthly data from Caldara-Iacoviello)
-- Source: https://www.matteoiacoviello.com/gpr.htm
-- This is the only truly unique macro indicator not captured elsewhere
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gpr_index (
    month DATE PRIMARY KEY,  -- First of month
    gpr_global DECIMAL(8, 2) NOT NULL,  -- Global GPR Index
    gpr_us DECIMAL(8, 2),               -- US-specific GPR
    gpr_threats DECIMAL(8, 2),          -- GPR Threats component
    gpr_acts DECIMAL(8, 2),             -- GPR Acts component
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gpr_month ON gpr_index (month DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- GEOPOLITICAL NEWS DRAFTS (Claude-discovered events pending human approval)
-- When Claude finds a new event via web search, it stages here for review
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS geopolitical_news_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Discovery context
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    discovery_trigger VARCHAR(100),        -- 'price_anomaly', 'scheduled_check', 'user_query'
    trigger_pair VARCHAR(10),              -- Which pair triggered discovery (if price anomaly)
    trigger_description TEXT,              -- "XAU_USD spiked $50 with no scheduled news"

    -- News details
    headline TEXT NOT NULL,
    source_url TEXT,
    source_name VARCHAR(100),
    event_date DATE NOT NULL,

    -- Claude's analysis
    affected_pairs TEXT[],                 -- ['XAU_USD', 'USD_CNH', 'OIL']
    estimated_impact VARCHAR(20),          -- 'high', 'medium', 'low'
    category VARCHAR(50),                  -- 'geopolitical_conflict', 'sanctions', etc.
    claude_summary TEXT,                   -- Claude's interpretation

    -- Status
    status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'merged'
    reviewed_at TIMESTAMPTZ,
    merged_to_event_id VARCHAR(100),       -- If merged into existing geopolitical_events entry

    -- Raw search results for reference
    search_results JSONB
);

CREATE INDEX IF NOT EXISTS idx_geo_drafts_status ON geopolitical_news_drafts (status);
CREATE INDEX IF NOT EXISTS idx_geo_drafts_date ON geopolitical_news_drafts (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_geo_drafts_pairs ON geopolitical_news_drafts USING GIN (affected_pairs);

-- ═══════════════════════════════════════════════════════════════════════════════
-- LIVE NEWS HEADLINES (GDELT/News API feed for real-time awareness)
-- Background worker populates; Claude queries for recent context
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS news_headlines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Source info
    source VARCHAR(50) NOT NULL,           -- 'gdelt', 'finnhub', 'newsapi'
    headline TEXT NOT NULL,
    url TEXT,
    published_at TIMESTAMPTZ NOT NULL,

    -- Classification
    countries TEXT[] DEFAULT '{}',         -- ['US', 'VE', 'CN']
    themes TEXT[] DEFAULT '{}',            -- ['military', 'oil', 'sanctions']
    currencies TEXT[] DEFAULT '{}',        -- ['USD', 'XAU', 'CNH']

    -- Sentiment/importance
    sentiment_score DECIMAL(4, 2),         -- -1 to 1
    goldstein_scale DECIMAL(4, 2),         -- GDELT conflict scale (-10 to 10)
    importance_score INTEGER,              -- 1-10 computed score

    -- Metadata
    fetched_at TIMESTAMPTZ DEFAULT NOW(),

    -- Dedup
    UNIQUE(source, url)
);

CREATE INDEX IF NOT EXISTS idx_headlines_published ON news_headlines (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_headlines_currencies ON news_headlines USING GIN (currencies);
CREATE INDEX IF NOT EXISTS idx_headlines_themes ON news_headlines USING GIN (themes);
CREATE INDEX IF NOT EXISTS idx_headlines_importance ON news_headlines (importance_score DESC)
    WHERE importance_score >= 7;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER: Get recent high-importance headlines for a currency
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_recent_headlines(
    p_currency VARCHAR DEFAULT NULL,
    p_hours INTEGER DEFAULT 24,
    p_min_importance INTEGER DEFAULT 5
)
RETURNS TABLE (
    headline TEXT,
    source VARCHAR,
    published_at TIMESTAMPTZ,
    countries TEXT[],
    themes TEXT[],
    importance_score INTEGER,
    url TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        h.headline,
        h.source,
        h.published_at,
        h.countries,
        h.themes,
        h.importance_score,
        h.url
    FROM news_headlines h
    WHERE h.published_at > NOW() - (p_hours || ' hours')::INTERVAL
    AND h.importance_score >= p_min_importance
    AND (p_currency IS NULL OR p_currency = ANY(h.currencies))
    ORDER BY h.importance_score DESC, h.published_at DESC
    LIMIT 20;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Get active geopolitical events affecting a pair
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_active_geopolitical_events(
    p_pair VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    event_id VARCHAR,
    event_name VARCHAR,
    category VARCHAR,
    status VARCHAR,
    start_date DATE,
    short_description TEXT,
    trading_notes TEXT,
    pair_impact JSONB,
    global_spillover VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        g.event_id,
        g.event_name,
        g.category,
        g.status,
        g.start_date,
        g.short_description,
        g.trading_notes,
        CASE
            WHEN p_pair IS NOT NULL THEN g.pair_impacts->REPLACE(p_pair, '/', '_')
            ELSE NULL::JSONB
        END as pair_impact,
        g.global_spillover
    FROM geopolitical_events g
    WHERE g.status IN ('active', 'structural', 'dormant')
    ORDER BY
        CASE g.status
            WHEN 'active' THEN 1
            WHEN 'structural' THEN 2
            WHEN 'dormant' THEN 3
        END,
        g.start_date DESC;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Get relevant geopolitical context for a pair and timeframe
-- Returns events with relevance score above threshold for given timeframe
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_geopolitical_context(
    p_pair VARCHAR,
    p_timeframe VARCHAR DEFAULT 'daily'  -- '15m', '1h', '4h', 'daily', 'weekly'
)
RETURNS TABLE (
    event_id VARCHAR,
    event_name VARCHAR,
    status VARCHAR,
    short_description TEXT,
    trading_notes TEXT,
    relevance_score INTEGER,
    pair_impact JSONB
) AS $$
DECLARE
    v_threshold INTEGER;
    v_score_key TEXT;
BEGIN
    -- Map timeframe to relevance score key and threshold
    v_score_key := CASE p_timeframe
        WHEN '15m' THEN 'intraday_15m'
        WHEN '1h' THEN 'short_term_1h_4h'
        WHEN '4h' THEN 'short_term_1h_4h'
        WHEN 'daily' THEN 'swing_daily'
        WHEN 'weekly' THEN 'position_weekly'
        ELSE 'swing_daily'
    END;

    -- Set threshold based on timeframe (shorter = higher threshold)
    v_threshold := CASE p_timeframe
        WHEN '15m' THEN 7
        WHEN '1h' THEN 6
        WHEN '4h' THEN 5
        WHEN 'daily' THEN 5
        WHEN 'weekly' THEN 3
        ELSE 5
    END;

    RETURN QUERY
    SELECT
        g.event_id,
        g.event_name,
        g.status,
        g.short_description,
        g.trading_notes,
        (g.pair_impacts->REPLACE(p_pair, '/', '_')->'relevance_score'->>v_score_key)::INTEGER as relevance_score,
        g.pair_impacts->REPLACE(p_pair, '/', '_') as pair_impact
    FROM geopolitical_events g
    WHERE g.status IN ('active', 'structural', 'dormant')
    AND g.pair_impacts ? REPLACE(p_pair, '/', '_')
    AND (g.pair_impacts->REPLACE(p_pair, '/', '_')->'relevance_score'->>v_score_key)::INTEGER >= v_threshold
    ORDER BY relevance_score DESC;
END;
$$ LANGUAGE plpgsql;
