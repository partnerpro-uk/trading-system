-- FVG Events — TimescaleDB Table
-- Phase 2: Fair Value Gap detection, fill tracking, volume grading

CREATE TABLE IF NOT EXISTS fvg_events (
    time TIMESTAMPTZ NOT NULL,              -- displacement candle time (createdAt)
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    direction VARCHAR(7) NOT NULL,          -- 'bullish' or 'bearish'
    status VARCHAR(8) NOT NULL DEFAULT 'fresh', -- 'fresh','partial','filled','inverted'
    top_price DECIMAL(10, 5) NOT NULL,
    bottom_price DECIMAL(10, 5) NOT NULL,
    midline DECIMAL(10, 5) NOT NULL,
    gap_size_pips DECIMAL(8, 2) NOT NULL,
    displacement_body DECIMAL(10, 5) NOT NULL,
    displacement_range DECIMAL(10, 5) NOT NULL,
    gap_to_body_ratio DECIMAL(6, 4) NOT NULL,
    is_displacement BOOLEAN NOT NULL DEFAULT false,
    relative_volume DECIMAL(6, 2) NOT NULL DEFAULT 0,
    tier SMALLINT NOT NULL DEFAULT 3,       -- 1, 2, or 3
    fill_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    max_fill_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    body_filled BOOLEAN NOT NULL DEFAULT false,
    wick_touched BOOLEAN NOT NULL DEFAULT false,
    first_touch_at TIMESTAMPTZ,
    first_touch_bars_after INTEGER,
    retest_count INTEGER NOT NULL DEFAULT 0,
    midline_respected BOOLEAN NOT NULL DEFAULT false,
    midline_touch_count INTEGER NOT NULL DEFAULT 0,
    filled_at TIMESTAMPTZ,
    bars_to_fill INTEGER,
    inverted_at TIMESTAMPTZ,
    bars_to_inversion INTEGER,
    parent_bos TEXT,
    contained_by TEXT[],
    confluence_with TEXT[],
    trade_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (time, pair, timeframe, direction)
);

CREATE INDEX IF NOT EXISTS idx_fvg_pair_tf_time
    ON fvg_events (pair, timeframe, time DESC);

CREATE INDEX IF NOT EXISTS idx_fvg_active
    ON fvg_events (pair, timeframe, status)
    WHERE status IN ('fresh', 'partial');

CREATE INDEX IF NOT EXISTS idx_fvg_tier
    ON fvg_events (pair, timeframe, tier, time DESC);
