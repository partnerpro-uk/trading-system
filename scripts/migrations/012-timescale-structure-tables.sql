-- Market Structure Detection — TimescaleDB Tables
-- Phase 1: Swing points, BOS events, sweep events, key levels

-- Swing Points (detected swing highs/lows with structure labels)
CREATE TABLE IF NOT EXISTS swing_points (
    time TIMESTAMPTZ NOT NULL,
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    price DECIMAL(10, 5) NOT NULL,
    swing_type VARCHAR(4) NOT NULL,       -- 'high' or 'low'
    label VARCHAR(3),                      -- 'HH','HL','LH','LL','EQH','EQL' or NULL
    lookback_used SMALLINT NOT NULL,
    true_range DECIMAL(10, 5) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (time, pair, timeframe, swing_type)
);

CREATE INDEX IF NOT EXISTS idx_swing_pair_tf_time
    ON swing_points (pair, timeframe, time DESC);

-- BOS Events (confirmed structural breaks with body-close confirmation)
CREATE TABLE IF NOT EXISTS bos_events (
    time TIMESTAMPTZ NOT NULL,
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    direction VARCHAR(7) NOT NULL,         -- 'bullish' or 'bearish'
    status VARCHAR(9) NOT NULL DEFAULT 'active',  -- 'active' or 'reclaimed'
    broken_level DECIMAL(10, 5) NOT NULL,
    broken_swing_time TIMESTAMPTZ NOT NULL,
    confirming_close DECIMAL(10, 5) NOT NULL,
    magnitude_pips DECIMAL(8, 2) NOT NULL,
    is_displacement BOOLEAN NOT NULL DEFAULT false,
    is_counter_trend BOOLEAN NOT NULL DEFAULT false,
    reclaimed_at TIMESTAMPTZ,
    reclaimed_by_close DECIMAL(10, 5),
    time_til_reclaim_ms BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (time, pair, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_bos_pair_tf_time
    ON bos_events (pair, timeframe, time DESC);

CREATE INDEX IF NOT EXISTS idx_bos_active
    ON bos_events (pair, timeframe, status) WHERE status = 'active';

-- Sweep Events (wick-through without body close — liquidity grabs)
CREATE TABLE IF NOT EXISTS sweep_events (
    time TIMESTAMPTZ NOT NULL,
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    direction VARCHAR(7) NOT NULL,         -- 'bullish' or 'bearish'
    swept_level DECIMAL(10, 5) NOT NULL,
    wick_extreme DECIMAL(10, 5) NOT NULL,
    swept_level_type VARCHAR(10) NOT NULL,  -- 'swing_high','swing_low','key_level','eqh','eql'
    followed_by_bos BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (time, pair, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_sweep_pair_tf_time
    ON sweep_events (pair, timeframe, time DESC);

-- Key Levels (refreshed daily — PDH/PDL, PWH/PWL, PMH/PML, YH/YL)
CREATE TABLE IF NOT EXISTS key_levels (
    date DATE NOT NULL,
    pair VARCHAR(10) NOT NULL,
    pdh DECIMAL(10, 5),
    pdl DECIMAL(10, 5),
    pwh DECIMAL(10, 5),
    pwl DECIMAL(10, 5),
    pmh DECIMAL(10, 5),
    pml DECIMAL(10, 5),
    yh DECIMAL(10, 5),
    yl DECIMAL(10, 5),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, pair)
);

CREATE INDEX IF NOT EXISTS idx_key_levels_pair_date
    ON key_levels (pair, date DESC);
