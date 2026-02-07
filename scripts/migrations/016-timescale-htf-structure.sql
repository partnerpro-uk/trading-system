-- Migration 016: HTF Current Structure Cache
--
-- Stores pre-computed CurrentStructure for D/W/M timeframes
-- per pair. Updated every 4 hours by the worker.
-- Used for fast MTF scoring and counter-trend lookups.

CREATE TABLE IF NOT EXISTS htf_current_structure (
  pair VARCHAR(10) NOT NULL,
  timeframe VARCHAR(5) NOT NULL,
  direction VARCHAR(7) NOT NULL,          -- 'bullish' | 'bearish' | 'ranging'
  last_bos_direction VARCHAR(7),          -- null if no active BOS
  last_bos_timestamp TIMESTAMPTZ,
  last_bos_level DECIMAL(10, 5),
  swing_sequence TEXT[],                  -- last 8 labels e.g. {'HH','HL','HH','HL'}
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (pair, timeframe)
);
