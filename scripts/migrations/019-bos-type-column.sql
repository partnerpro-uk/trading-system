-- Migration 019: Add bos_type column to bos_events
-- BOS = continuation break, MSS = market structure shift (reversal)

-- ============================================
-- TimescaleDB
-- ============================================

ALTER TABLE bos_events
  ADD COLUMN IF NOT EXISTS bos_type VARCHAR(3) NOT NULL DEFAULT 'bos';

-- ============================================
-- ClickHouse (run separately against ClickHouse)
-- ============================================
-- ALTER TABLE bos_events ADD COLUMN IF NOT EXISTS bos_type LowCardinality(String) DEFAULT 'bos';
