-- FVG Events — ClickHouse Archive Tables
-- Phase 2: FVG events archive + macro ranges for all-time P/D

-- FVG Events Archive
CREATE TABLE IF NOT EXISTS fvg_events (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    direction LowCardinality(String),
    status LowCardinality(String),
    top_price Decimal(10, 5),
    bottom_price Decimal(10, 5),
    midline Decimal(10, 5),
    gap_size_pips Decimal(8, 2),
    displacement_body Decimal(10, 5),
    displacement_range Decimal(10, 5),
    gap_to_body_ratio Decimal(6, 4),
    is_displacement UInt8,
    relative_volume Decimal(6, 2),
    tier UInt8,
    fill_percent Decimal(5, 2),
    max_fill_percent Decimal(5, 2),
    body_filled UInt8,
    wick_touched UInt8,
    first_touch_at Nullable(DateTime64(3)),
    first_touch_bars_after Nullable(Int32),
    retest_count Int32,
    midline_respected UInt8,
    midline_touch_count Int32,
    filled_at Nullable(DateTime64(3)),
    bars_to_fill Nullable(Int32),
    inverted_at Nullable(DateTime64(3)),
    bars_to_inversion Nullable(Int32),
    parent_bos Nullable(String),
    contained_by Array(String),
    confluence_with Array(String),
    trade_id Nullable(String),
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(time)
ORDER BY (pair, timeframe, time);

-- Macro Ranges — All-time high/low for Premium/Discount
CREATE TABLE IF NOT EXISTS macro_ranges (
    pair LowCardinality(String),
    highest_high Decimal(10, 5),
    lowest_low Decimal(10, 5),
    data_start_date Date,
    data_end_date Date,
    candle_count UInt64,
    computed_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(computed_at)
ORDER BY (pair);
