-- ═══════════════════════════════════════════════════════════════════════════════
-- CLICKHOUSE FCR CANDLE WINDOWS - Trading System Migration
-- ═══════════════════════════════════════════════════════════════════════════════
-- Execute in ClickHouse Cloud console
-- Stores M1 candles for FCR (First Candle Range) strategy windows
-- Window: 9:30-10:30 AM ET on trading days (~60 M1 candles per day)

-- ═══════════════════════════════════════════════════════════════════════════════
-- FCR CANDLE WINDOWS (M1 candles around US market open)
-- Uses parallel arrays for better compression (same pattern as event_candle_windows)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fcr_candle_windows (
    -- Primary key
    date Date,                              -- Trading date
    pair LowCardinality(String),            -- e.g., "SPX500_USD", "NAS100_USD"

    -- FCR 5-minute candle data (9:30-9:35 AM ET, aggregated from first 5 M1 candles)
    fcr_open Decimal(10, 5),                -- Open of 9:30 candle
    fcr_high Decimal(10, 5),                -- Highest of first 5 M1 candles
    fcr_low Decimal(10, 5),                 -- Lowest of first 5 M1 candles
    fcr_close Decimal(10, 5),               -- Close of 9:34 candle
    fcr_time DateTime64(3),                 -- 9:30 AM ET timestamp

    -- M1 candles after FCR (9:35-10:30 AM ET, ~55 candles)
    -- Using parallel arrays for efficient compression
    candle_times Array(DateTime64(3)),
    candle_opens Array(Decimal(10, 5)),
    candle_highs Array(Decimal(10, 5)),
    candle_lows Array(Decimal(10, 5)),
    candle_closes Array(Decimal(10, 5)),
    candle_volumes Array(UInt32),

    candle_count UInt16,                    -- Number of M1 candles stored

    -- Detected setup (filled by strategy analysis engine)
    breakout_direction Nullable(Enum8('long' = 1, 'short' = 2)),
    breakout_time Nullable(DateTime64(3)),  -- When breakout occurred
    breakout_candle_idx Nullable(UInt16),   -- Index in candle arrays

    -- FVG (Fair Value Gap) data
    fvg_top Nullable(Decimal(10, 5)),
    fvg_bottom Nullable(Decimal(10, 5)),
    fvg_candle_idx Nullable(UInt16),        -- Which candle created the FVG

    -- Entry signal data
    entry_time Nullable(DateTime64(3)),
    entry_price Nullable(Decimal(10, 5)),
    entry_candle_idx Nullable(UInt16),

    -- Trade levels
    stop_loss Nullable(Decimal(10, 5)),
    take_profit Nullable(Decimal(10, 5)),
    risk_pips Nullable(Decimal(8, 2)),
    reward_pips Nullable(Decimal(8, 2)),

    -- Outcome tracking
    outcome Nullable(Enum8('TP' = 1, 'SL' = 2, 'MANUAL' = 3, 'NO_SETUP' = 4, 'PENDING' = 5)),
    exit_time Nullable(DateTime64(3)),
    exit_price Nullable(Decimal(10, 5)),
    pnl_pips Nullable(Decimal(8, 2)),

    -- Metadata
    raw_source LowCardinality(String) DEFAULT 'oanda',
    fetched_at DateTime DEFAULT now(),
    analyzed_at Nullable(DateTime),
    created_at DateTime DEFAULT now(),

    -- Index for pair lookups
    INDEX idx_pair pair TYPE set(100) GRANULARITY 1,
    INDEX idx_outcome outcome TYPE set(10) GRANULARITY 1
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(date)
ORDER BY (pair, date)
SETTINGS index_granularity = 8192;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FCR STATISTICS (Aggregated performance by pair)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fcr_statistics (
    pair LowCardinality(String),
    year_month UInt32,                      -- YYYYMM format

    -- Setup frequency
    total_trading_days UInt32,
    days_with_setup UInt32,
    setup_rate Decimal(5, 2),               -- % of days with valid setup

    -- Direction breakdown
    long_setups UInt32,
    short_setups UInt32,
    long_pct Decimal(5, 2),

    -- Win rate
    tp_hits UInt32,
    sl_hits UInt32,
    no_fill UInt32,                         -- Entry never triggered
    win_rate Decimal(5, 2),

    -- P&L
    total_pips Decimal(10, 2),
    avg_winner_pips Decimal(8, 2),
    avg_loser_pips Decimal(8, 2),
    profit_factor Decimal(8, 2),
    largest_win_pips Decimal(8, 2),
    largest_loss_pips Decimal(8, 2),

    -- Timing stats
    avg_minutes_to_breakout Decimal(8, 2),
    avg_minutes_to_entry Decimal(8, 2),
    avg_minutes_to_exit Decimal(8, 2),

    last_updated DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_updated)
ORDER BY (pair, year_month);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXAMPLE QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get FCR window for a specific date:
-- SELECT
--     date,
--     pair,
--     fcr_high,
--     fcr_low,
--     fcr_high - fcr_low as fcr_range,
--     breakout_direction,
--     outcome
-- FROM fcr_candle_windows
-- WHERE pair = 'SPX500_USD' AND date = '2024-01-15';

-- Get M1 candles with timestamps for charting:
-- SELECT
--     arrayZip(candle_times, candle_opens, candle_highs, candle_lows, candle_closes) as candles
-- FROM fcr_candle_windows
-- WHERE pair = 'SPX500_USD' AND date = '2024-01-15';

-- Win rate by pair:
-- SELECT
--     pair,
--     sum(tp_hits) as wins,
--     sum(sl_hits) as losses,
--     round(sum(tp_hits) * 100.0 / nullIf(sum(tp_hits) + sum(sl_hits), 0), 2) as win_rate
-- FROM fcr_statistics
-- GROUP BY pair
-- ORDER BY win_rate DESC;

-- Monthly performance:
-- SELECT
--     pair,
--     year_month,
--     win_rate,
--     total_pips,
--     profit_factor
-- FROM fcr_statistics
-- WHERE pair = 'SPX500_USD'
-- ORDER BY year_month DESC;
