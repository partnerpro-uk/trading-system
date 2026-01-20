-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 005: Add missing news_events columns to TimescaleDB
-- ═══════════════════════════════════════════════════════════════════════════════
-- The news scraper produces these columns but they were missing from the schema.
-- Run this migration before the scraper runs to add required columns.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add timezone representation columns
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS datetime_utc VARCHAR(50);
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS datetime_new_york VARCHAR(50);
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS datetime_london VARCHAR(50);
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS source_tz VARCHAR(50);

-- Add day/session columns
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS day_of_week VARCHAR(5);
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS trading_session VARCHAR(30);

-- Add status column (scheduled/released)
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'scheduled';

-- Make window_after_minutes optional with a default
-- (scraper doesn't provide this, it will be calculated based on impact)
ALTER TABLE news_events ALTER COLUMN window_after_minutes DROP NOT NULL;
ALTER TABLE news_events ALTER COLUMN window_after_minutes SET DEFAULT 15;

-- Add index for status lookups (for scheduled event queries)
CREATE INDEX IF NOT EXISTS idx_news_status ON news_events (status);

-- Update existing rows with defaults if any
UPDATE news_events
SET
    status = CASE WHEN actual IS NOT NULL AND actual != '' THEN 'released' ELSE 'scheduled' END
WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ═══════════════════════════════════════════════════════════════════════════════
-- Run this to verify the columns exist:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'news_events';
