-- ═══════════════════════════════════════════════════════════════════════════════
-- CLICKHOUSE SCHEMA - Trading System Migration
-- ═══════════════════════════════════════════════════════════════════════════════
-- Execute in ClickHouse Cloud console

-- ═══════════════════════════════════════════════════════════════════════════════
-- HISTORICAL CANDLES (All data from 2007-present, excluding last 30 days)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS candles (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    open Decimal(10, 5) CODEC(Gorilla),
    high Decimal(10, 5) CODEC(Gorilla),
    low Decimal(10, 5) CODEC(Gorilla),
    close Decimal(10, 5) CODEC(Gorilla),
    volume UInt32 CODEC(T64),

    -- Velocity data
    time_to_high_ms UInt32 CODEC(T64),
    time_to_low_ms UInt32 CODEC(T64),
    high_formed_first UInt8,
    body_percent Decimal(5, 2),
    range_pips Decimal(8, 2),
    is_displacement UInt8,
    displacement_score Decimal(5, 2)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(time)
ORDER BY (pair, timeframe, time)
SETTINGS index_granularity = 8192;

-- ═══════════════════════════════════════════════════════════════════════════════
-- EVENT CANDLE WINDOWS (M1 candles around news events)
-- Uses parallel arrays for better compression than JSONB
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_candle_windows (
    event_id String,
    pair LowCardinality(String),

    window_start DateTime64(3),
    window_end DateTime64(3),

    -- Parallel arrays (more efficient than Array of Tuples)
    candle_times Array(DateTime64(3)),
    candle_opens Array(Decimal(10, 5)),
    candle_highs Array(Decimal(10, 5)),
    candle_lows Array(Decimal(10, 5)),
    candle_closes Array(Decimal(10, 5)),
    candle_volumes Array(UInt32),

    candle_count UInt16,

    -- Metadata
    raw_source LowCardinality(String) DEFAULT 'oanda',
    fetched_at DateTime DEFAULT now(),
    window_version UInt8 DEFAULT 1,

    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (event_id, pair)
SETTINGS index_granularity = 8192;

-- ═══════════════════════════════════════════════════════════════════════════════
-- AGGREGATED EVENT STATISTICS (Per event type per pair)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS event_type_statistics (
    event_type LowCardinality(String),
    pair LowCardinality(String),

    sample_size UInt32,
    date_range_start DateTime,
    date_range_end DateTime,

    -- Spike stats
    avg_spike_pips Decimal(8, 2),
    median_spike_pips Decimal(8, 2),
    max_spike_pips Decimal(8, 2),
    min_spike_pips Decimal(8, 2),
    stddev_spike_pips Decimal(8, 2),

    -- Direction stats
    spike_up_count UInt32,
    spike_down_count UInt32,
    spike_up_pct Decimal(5, 2),

    -- Reversal stats
    reversal_within_15m_count UInt32,
    reversal_within_30m_count UInt32,
    reversal_within_60m_count UInt32,
    reversal_within_15m_pct Decimal(5, 2),
    reversal_within_30m_pct Decimal(5, 2),
    reversal_within_60m_pct Decimal(5, 2),

    -- Final direction
    final_matches_spike_count UInt32,
    final_matches_spike_pct Decimal(5, 2),

    -- Surprise correlation
    avg_spike_when_no_surprise Decimal(8, 2),
    avg_spike_when_surprise Decimal(8, 2),

    last_updated DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_updated)
ORDER BY (event_type, pair);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKTEST RESULTS (Strategy performance summaries)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID DEFAULT generateUUIDv4(),
    strategy_id String,
    strategy_name String,

    pair LowCardinality(String),
    timeframe LowCardinality(String),
    date_from Date,
    date_to Date,

    -- Overall results
    total_trades UInt32,
    wins UInt32,
    losses UInt32,
    breakeven UInt32,
    win_rate Decimal(5, 2),
    profit_factor Decimal(8, 2),
    avg_rr Decimal(5, 2),
    max_drawdown Decimal(8, 2),
    max_consecutive_losses UInt8,
    avg_hold_time_minutes UInt32,
    trades_per_week Decimal(5, 2),

    -- By session
    asia_trades UInt32,
    asia_win_rate Decimal(5, 2),
    london_trades UInt32,
    london_win_rate Decimal(5, 2),
    ny_trades UInt32,
    ny_win_rate Decimal(5, 2),

    -- By day
    monday_win_rate Decimal(5, 2),
    tuesday_win_rate Decimal(5, 2),
    wednesday_win_rate Decimal(5, 2),
    thursday_win_rate Decimal(5, 2),
    friday_win_rate Decimal(5, 2),

    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (strategy_id, pair, date_from);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BACKTEST INDIVIDUAL TRADES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backtest_trades (
    backtest_id UUID,
    trade_number UInt32,

    pair LowCardinality(String),
    direction LowCardinality(String),

    entry_time DateTime64(3),
    exit_time DateTime64(3),
    entry_price Decimal(10, 5),
    exit_price Decimal(10, 5),
    stop_loss Decimal(10, 5),
    take_profit Decimal(10, 5),

    outcome LowCardinality(String),
    rr_achieved Decimal(5, 2),
    pnl_pips Decimal(8, 2),

    conditions_met Array(String),

    session LowCardinality(String),
    day_of_week UInt8
)
ENGINE = MergeTree()
ORDER BY (backtest_id, entry_time);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MATERIALIZED VIEWS FOR COMMON ANALYTICS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Daily volatility by pair
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_volatility
ENGINE = SummingMergeTree()
ORDER BY (pair, date)
AS SELECT
    pair,
    toDate(time) as date,
    max(high) - min(low) as daily_range,
    avg(range_pips) as avg_candle_range
FROM candles
WHERE timeframe = 'M15'
GROUP BY pair, toDate(time);

-- Session performance summary
CREATE MATERIALIZED VIEW IF NOT EXISTS session_performance
ENGINE = SummingMergeTree()
ORDER BY (pair, year_month, session)
AS SELECT
    pair,
    toYYYYMM(time) as year_month,
    multiIf(
        toHour(time) >= 0 AND toHour(time) < 8, 'asia',
        toHour(time) >= 8 AND toHour(time) < 16, 'london',
        'new_york'
    ) as session,
    count() as candle_count,
    avg(range_pips) as avg_range,
    sum(is_displacement) as displacement_count
FROM candles
WHERE timeframe = 'M15'
GROUP BY pair, toYYYYMM(time), session;

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXAMPLE QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get candles for a pair/timeframe/date range:
-- SELECT * FROM candles
-- WHERE pair = 'EUR_USD' AND timeframe = 'M15'
-- AND time BETWEEN '2024-01-01' AND '2024-01-31'
-- ORDER BY time;

-- Get event window with candles as arrays:
-- SELECT
--     event_id,
--     pair,
--     arrayZip(candle_times, candle_opens, candle_highs, candle_lows, candle_closes) as candles
-- FROM event_candle_windows
-- WHERE event_id = 'NFP_2024-01-05_13:30';

-- Get event statistics for NFP:
-- SELECT * FROM event_type_statistics
-- WHERE event_type = 'NFP'
-- ORDER BY pair;

-- Average daily volatility by pair:
-- SELECT pair, avg(daily_range) as avg_daily_range
-- FROM daily_volatility
-- WHERE date >= today() - 30
-- GROUP BY pair
-- ORDER BY avg_daily_range DESC;
