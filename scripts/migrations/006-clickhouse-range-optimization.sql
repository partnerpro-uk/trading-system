-- ============================================
-- ClickHouse Optimization for Date Range Queries
-- Improves performance for 1M, 3M, 6M, 1Y, ALL buttons
-- ============================================

-- Add a projection optimized for date-range queries
-- Projections are like materialized indexes that ClickHouse maintains automatically
-- This projection stores data sorted by time first, enabling fast time-range scans

ALTER TABLE candles ADD PROJECTION IF NOT EXISTS proj_time_range (
    SELECT *
    ORDER BY (time, pair, timeframe)
);

-- Materialize the projection for existing data
-- This may take a while on large tables but only runs once
ALTER TABLE candles MATERIALIZE PROJECTION proj_time_range;

-- Add a skip index on the time column for faster partition pruning
-- minmax index stores min/max values per 8192 rows, allowing quick range elimination
ALTER TABLE candles ADD INDEX IF NOT EXISTS idx_time_minmax time TYPE minmax GRANULARITY 1;

-- Materialize the skip index
ALTER TABLE candles MATERIALIZE INDEX idx_time_minmax;

-- ============================================
-- Verify the optimization
-- ============================================

-- Check that projection was created
SELECT name, type, expr FROM system.data_skipping_indices WHERE table = 'candles' AND database = 'default';

-- Check projection exists
SELECT name, type FROM system.projections WHERE table = 'candles' AND database = 'default';

-- Example query that should benefit from these optimizations:
-- SELECT * FROM candles
-- WHERE pair = 'EUR_USD' AND timeframe = 'H1'
--   AND time >= '2024-01-01' AND time <= '2024-12-31'
-- ORDER BY time ASC

-- The query optimizer should now:
-- 1. Use partition pruning (toYYYYMM) to skip irrelevant months
-- 2. Use the minmax skip index to skip granules outside the time range
-- 3. Use the proj_time_range projection for efficient time-ordered scans
