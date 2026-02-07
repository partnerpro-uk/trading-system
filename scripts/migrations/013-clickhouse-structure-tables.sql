-- Market Structure Detection — ClickHouse Archive Tables
-- Mirrors TimescaleDB structure tables for historical backtesting

-- Swing Points Archive
CREATE TABLE IF NOT EXISTS swing_points (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    price Decimal(10, 5),
    swing_type LowCardinality(String),
    label LowCardinality(String),
    lookback_used UInt8,
    true_range Decimal(10, 5),
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(time)
ORDER BY (pair, timeframe, time);

-- BOS Events Archive
CREATE TABLE IF NOT EXISTS bos_events (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    direction LowCardinality(String),
    status LowCardinality(String),
    broken_level Decimal(10, 5),
    broken_swing_time DateTime64(3),
    confirming_close Decimal(10, 5),
    magnitude_pips Decimal(8, 2),
    is_displacement UInt8,
    is_counter_trend UInt8,
    reclaimed_at Nullable(DateTime64(3)),
    reclaimed_by_close Nullable(Decimal(10, 5)),
    time_til_reclaim_ms Nullable(Int64),
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(time)
ORDER BY (pair, timeframe, time);

-- Sweep Events Archive
CREATE TABLE IF NOT EXISTS sweep_events (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    direction LowCardinality(String),
    swept_level Decimal(10, 5),
    wick_extreme Decimal(10, 5),
    swept_level_type LowCardinality(String),
    followed_by_bos UInt8,
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(time)
ORDER BY (pair, timeframe, time);

-- Key Levels Archive
CREATE TABLE IF NOT EXISTS key_levels (
    date Date,
    pair LowCardinality(String),
    pdh Nullable(Decimal(10, 5)),
    pdl Nullable(Decimal(10, 5)),
    pwh Nullable(Decimal(10, 5)),
    pwl Nullable(Decimal(10, 5)),
    pmh Nullable(Decimal(10, 5)),
    pml Nullable(Decimal(10, 5)),
    yh Nullable(Decimal(10, 5)),
    yl Nullable(Decimal(10, 5)),
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (pair, date);
