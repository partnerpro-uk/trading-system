-- ===============================================================================
-- ClickHouse News Tables Migration
-- ===============================================================================
-- Migrates historical news events and price reactions from TimescaleDB to ClickHouse
-- for better analytical query performance on historical data.
--
-- TimescaleDB keeps only upcoming 30 days for chart display.
-- ClickHouse stores all historical data for analytics.
-- ===============================================================================

-- ===============================================================================
-- NEWS EVENTS (Historical Archive)
-- ===============================================================================
-- All events older than 30 days are stored here for historical analysis.
-- Recent/upcoming events stay in TimescaleDB for chart display.

CREATE TABLE IF NOT EXISTS news_events (
    event_id String,
    event_type LowCardinality(String),
    name String,
    country LowCardinality(String),
    currency LowCardinality(String),
    timestamp DateTime64(3),
    impact LowCardinality(String),

    -- Actual/Forecast/Previous values (stored as strings to preserve formatting)
    actual Nullable(String),
    forecast Nullable(String),
    previous Nullable(String),

    -- Description
    description Nullable(String),

    -- Timezone representations
    datetime_utc Nullable(String),
    datetime_new_york Nullable(String),
    datetime_london Nullable(String),
    source_tz Nullable(String),
    trading_session Nullable(String),

    -- Window configuration (from original event)
    window_before_minutes UInt16 DEFAULT 15,
    window_after_minutes UInt16 DEFAULT 15,

    -- Metadata
    raw_source LowCardinality(String) DEFAULT 'jblanked',
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event_type, currency, timestamp)
SETTINGS index_granularity = 8192;

-- Index for common query patterns
ALTER TABLE news_events ADD INDEX idx_currency currency TYPE bloom_filter GRANULARITY 1;
ALTER TABLE news_events ADD INDEX idx_impact impact TYPE set(3) GRANULARITY 1;


-- ===============================================================================
-- EVENT PRICE REACTIONS (Historical Analytics)
-- ===============================================================================
-- All price reactions for historical events, migrated from TimescaleDB.
-- Includes T+60 and T+90 settlement prices extracted from event_candle_windows.

CREATE TABLE IF NOT EXISTS event_price_reactions (
    event_id String,
    pair LowCardinality(String),

    -- Baseline prices
    price_at_minus_15m Decimal(10, 5),
    price_at_minus_5m Nullable(Decimal(10, 5)),
    price_at_event Decimal(10, 5),

    -- Spike data
    spike_high Decimal(10, 5),
    spike_low Decimal(10, 5),
    spike_direction LowCardinality(String),  -- 'UP', 'DOWN', 'NEUTRAL'
    spike_magnitude_pips Decimal(8, 2),
    time_to_spike_seconds Nullable(UInt32),

    -- Settlement prices at various intervals
    price_at_plus_5m Nullable(Decimal(10, 5)),
    price_at_plus_15m Nullable(Decimal(10, 5)),
    price_at_plus_30m Nullable(Decimal(10, 5)),
    price_at_plus_60m Nullable(Decimal(10, 5)),  -- High impact events
    price_at_plus_90m Nullable(Decimal(10, 5)),  -- FOMC/ECB events

    -- Pattern analysis
    pattern_type LowCardinality(String),
    did_reverse UInt8,  -- Boolean as 0/1
    reversal_magnitude_pips Nullable(Decimal(8, 2)),
    final_matches_spike UInt8,  -- Boolean as 0/1

    -- Window type (derived from event type)
    window_minutes UInt16 DEFAULT 30,  -- 30=standard, 75=high impact, 105=FOMC/ECB

    -- Metadata
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (event_id, pair)
SETTINGS index_granularity = 8192;

-- Index for analytics queries
ALTER TABLE event_price_reactions ADD INDEX idx_pair pair TYPE bloom_filter GRANULARITY 1;
ALTER TABLE event_price_reactions ADD INDEX idx_direction spike_direction TYPE set(3) GRANULARITY 1;


-- ===============================================================================
-- EVENT TYPE STATISTICS (Aggregated Analytics)
-- ===============================================================================
-- Pre-computed statistics per event type per pair for fast analytics queries.
-- Updated periodically from event_price_reactions.

CREATE TABLE IF NOT EXISTS event_type_statistics (
    event_type String,
    pair LowCardinality(String),

    -- Sample info
    sample_size UInt32,
    date_range_start DateTime,
    date_range_end DateTime,

    -- Spike statistics
    avg_spike_pips Decimal(8, 2),
    median_spike_pips Decimal(8, 2),
    max_spike_pips Decimal(8, 2),
    min_spike_pips Decimal(8, 2),
    stddev_spike_pips Decimal(8, 2),

    -- Direction statistics
    spike_up_count UInt32,
    spike_down_count UInt32,
    spike_up_pct Decimal(5, 2),

    -- Reversal statistics
    reversal_within_15m_count UInt32,
    reversal_within_30m_count UInt32,
    reversal_within_60m_count UInt32,
    reversal_within_15m_pct Decimal(5, 2),
    reversal_within_30m_pct Decimal(5, 2),
    reversal_within_60m_pct Decimal(5, 2),

    -- Final direction
    final_matches_spike_count UInt32,
    final_matches_spike_pct Decimal(5, 2),

    -- Surprise correlation (when actual != forecast)
    avg_spike_when_no_surprise Nullable(Decimal(8, 2)),
    avg_spike_when_surprise Nullable(Decimal(8, 2)),

    -- Beat/Miss breakdown
    beat_count UInt32 DEFAULT 0,
    miss_count UInt32 DEFAULT 0,
    inline_count UInt32 DEFAULT 0,
    avg_spike_on_beat Nullable(Decimal(8, 2)),
    avg_spike_on_miss Nullable(Decimal(8, 2)),

    -- Metadata
    last_updated DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_updated)
ORDER BY (event_type, pair)
SETTINGS index_granularity = 8192;


-- ===============================================================================
-- HELPER VIEWS
-- ===============================================================================

-- View: Join events with their reactions for analytics
CREATE VIEW IF NOT EXISTS events_with_reactions AS
SELECT
    e.event_id,
    e.event_type,
    e.name,
    e.currency,
    e.timestamp,
    e.impact,
    e.actual,
    e.forecast,
    e.previous,
    r.pair,
    r.price_at_minus_15m,
    r.price_at_event,
    r.spike_high,
    r.spike_low,
    r.spike_direction,
    r.spike_magnitude_pips,
    r.price_at_plus_15m,
    r.price_at_plus_30m,
    r.price_at_plus_60m,
    r.price_at_plus_90m,
    r.pattern_type,
    r.did_reverse,
    r.reversal_magnitude_pips,
    r.window_minutes
FROM news_events e
INNER JOIN event_price_reactions r ON e.event_id = r.event_id;


-- ===============================================================================
-- NOTES
-- ===============================================================================
--
-- Window Types:
--   30 min  = T-15 to T+15 (standard events, medium/low impact)
--   75 min  = T-15 to T+60 (high impact events)
--   105 min = T-15 to T+90 (FOMC/ECB events)
--
-- T+60 and T+90 prices are extracted from event_candle_windows candle arrays
-- using the extract-settlements-from-windows.ts script.
--
-- Query routing:
--   - Chart display (visible range): Query TimescaleDB news_events
--   - Historical analytics: Query ClickHouse events_with_reactions view
--
