-- ═══════════════════════════════════════════════════════════════════════════════
-- CLICKHOUSE SCHEMA - Strategy Backtest Trades
-- ═══════════════════════════════════════════════════════════════════════════════
-- Execute in ClickHouse Cloud console
-- Migration 007: Strategy-aware backtest trades with indicator snapshots

-- ═══════════════════════════════════════════════════════════════════════════════
-- STRATEGY BACKTEST TRADES
-- Enhanced trade log with strategy context and indicator snapshots
-- For backtesting results analysis with Claude-queryable indicator state
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS backtest_strategy_trades (
    -- Backtest identification
    backtest_id UUID,
    strategy_id LowCardinality(String),
    trade_number UInt32,

    -- Trade data
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    direction Enum8('LONG' = 1, 'SHORT' = -1),

    -- Entry details
    entry_time DateTime64(3),
    entry_price Decimal(10, 5),

    -- Exit details
    exit_time DateTime64(3),
    exit_price Decimal(10, 5),

    -- Risk management
    stop_loss Decimal(10, 5),
    take_profit Decimal(10, 5),

    -- Outcome
    outcome Enum8('TP' = 1, 'SL' = 2, 'MW' = 3, 'ML' = 4),
    pnl_pips Decimal(10, 2),
    bars_held UInt32,

    -- Context for Claude analysis
    -- JSON containing all indicator values at entry time
    -- Example: {"ema_30": 1.0842, "ema_200": 1.0821, "atr_100": 0.0015}
    indicator_snapshot String,

    -- Array of strategy conditions that were met at entry
    -- Example: ["trend_aligned", "spike_detected", "fresh_signal"]
    conditions_met Array(String),

    -- Session and timing
    trading_session Enum8('ASIA' = 1, 'LONDON' = 2, 'NY' = 3, 'OVERLAP' = 4),
    day_of_week UInt8,

    -- Metadata
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(entry_time)
ORDER BY (backtest_id, trade_number)
SETTINGS index_granularity = 8192;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES FOR COMMON QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Index for querying by strategy
ALTER TABLE backtest_strategy_trades
ADD INDEX idx_strategy (strategy_id) TYPE bloom_filter GRANULARITY 1;

-- Index for querying by pair
ALTER TABLE backtest_strategy_trades
ADD INDEX idx_pair (pair) TYPE bloom_filter GRANULARITY 1;

-- Index for querying by outcome
ALTER TABLE backtest_strategy_trades
ADD INDEX idx_outcome (outcome) TYPE bloom_filter GRANULARITY 1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STRATEGY BACKTEST SUMMARY VIEW
-- Aggregated statistics per strategy per backtest
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE MATERIALIZED VIEW IF NOT EXISTS backtest_strategy_summary
ENGINE = AggregatingMergeTree()
ORDER BY (backtest_id, strategy_id, pair)
AS SELECT
    backtest_id,
    strategy_id,
    pair,
    timeframe,

    count() as total_trades,
    countIf(outcome = 'TP' OR outcome = 'MW') as wins,
    countIf(outcome = 'SL' OR outcome = 'ML') as losses,

    -- Win rate
    round(countIf(outcome = 'TP' OR outcome = 'MW') * 100.0 / count(), 2) as win_rate,

    -- P&L stats
    sum(pnl_pips) as total_pnl_pips,
    avg(pnl_pips) as avg_pnl_pips,
    max(pnl_pips) as max_win_pips,
    min(pnl_pips) as max_loss_pips,

    -- Holding time
    avg(bars_held) as avg_bars_held,

    -- Session breakdown
    countIf(trading_session = 'ASIA') as asia_trades,
    countIf(trading_session = 'LONDON') as london_trades,
    countIf(trading_session = 'NY') as ny_trades,

    min(entry_time) as first_trade_time,
    max(entry_time) as last_trade_time

FROM backtest_strategy_trades
GROUP BY backtest_id, strategy_id, pair, timeframe;

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXAMPLE QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Get all trades for a specific backtest:
-- SELECT * FROM backtest_strategy_trades
-- WHERE backtest_id = '...'
-- ORDER BY trade_number;

-- Analyze trades where specific indicator condition was met:
-- SELECT
--     JSONExtractFloat(indicator_snapshot, 'ema_30') as ema_30,
--     JSONExtractFloat(indicator_snapshot, 'ema_200') as ema_200,
--     outcome,
--     pnl_pips
-- FROM backtest_strategy_trades
-- WHERE strategy_id = 'echo-strategy'
--   AND has(conditions_met, 'spike_detected')
-- ORDER BY entry_time;

-- Win rate by session:
-- SELECT
--     trading_session,
--     count() as trades,
--     round(countIf(outcome IN ('TP', 'MW')) * 100.0 / count(), 2) as win_rate
-- FROM backtest_strategy_trades
-- WHERE strategy_id = 'echo-strategy'
-- GROUP BY trading_session;

-- Average indicator values at winning vs losing trades:
-- SELECT
--     outcome IN ('TP', 'MW') as is_win,
--     avg(JSONExtractFloat(indicator_snapshot, 'atr_100')) as avg_atr_at_entry
-- FROM backtest_strategy_trades
-- WHERE strategy_id = 'echo-strategy'
-- GROUP BY is_win;
