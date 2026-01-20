# AI Trading System: Triple Database Architecture

## Migration Plan & Technical Specification

**Version:** 2.0 (Updated with Claude Code review feedback)  
**Last Updated:** January 2026

---

## Executive Summary

We are migrating from a single-database architecture (Convex) to a purpose-optimized triple-database architecture to handle:
- **7.8M+ historical candles** (and growing)
- **18,866 news events** with 1-minute price reaction windows
- **Real-time streaming** from OANDA
- **Heavy analytical queries** for pattern discovery and backtesting
- **Application state** for trades, strategies, and Claude conversations

### The Problem

Convex is excellent for real-time applications but not optimized for:
- Time-series data at scale (bandwidth charges on reads)
- Analytical aggregations across millions of rows
- Range scans (get candles between timestamp X and Y)

Current state: **83GB bandwidth used (76GB reads)** — mostly from scanning candle documents.

### The Solution

Three databases, each doing what it does best:

| Database | Purpose | Data Type |
|----------|---------|-----------|
| **Convex** | Application layer | Users, trades, strategies, conversations |
| **TimescaleDB** | Operational layer | Live candles (30 days), real-time, JOINs |
| **ClickHouse** | Analytics layer | Historical candles, event windows, backtesting |

### Revised Storage Estimates

| Database | Data | Estimated Size |
|----------|------|----------------|
| **Timescale** | Candles (30d), news events, reactions, sessions, FVGs | ~500MB |
| **ClickHouse** | Historical candles + event windows | ~4-5GB |
| **Convex** | Users, trades, strategies, conversations | <100MB |

This keeps Timescale well within Supabase Pro limits (8GB) and ClickHouse within free tier (10GB).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js)                             │
│                                                                             │
│   Charts ◄──────── Timescale (live data, continuous aggregates)            │
│   Trade UI ◄────── Convex (real-time subscriptions)                        │
│   Analytics ◄───── ClickHouse (historical queries)                         │
│   Claude Chat ◄─── All three (routed by query type)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│      CONVEX       │       │    TIMESCALE      │       │    CLICKHOUSE     │
│    Application    │       │     Live/Hot      │       │     Analytics     │
│                   │       │                   │       │                   │
│ • Auth/Users      │       │ • M1 candles      │       │ • Historical      │
│ • Trade logs      │       │ • Last 30 days    │       │   candles (all)   │
│ • Strategies      │       │ • News events     │       │ • Event windows   │
│ • Claude chat     │       │ • Price reactions │       │ • Backtests       │
│ • UI state        │       │ • Session levels  │       │ • Aggregated      │
│                   │       │ • FVGs, Sweeps    │       │   statistics      │
│ Real-time ✓       │       │ Continuous aggs ✓ │       │ 10-100x faster    │
│ Subscriptions     │       │ Auto M1→M5→H1    │       │ on big scans      │
└───────────────────┘       └───────────────────┘       └───────────────────┘
          │                           ▲                           ▲
          │                           │                           │
          │                    ┌──────┴──────┐                    │
          │                    │             │                    │
          │               Live writes    Nightly sync             │
          │                    │        (30+ day old)             │
          │                    │             │                    │
          │              ┌─────┴─────┐       └────────────────────┤
          │              │           │                            │
          │              │  OANDA    │                            │
          │              │  WORKER   │                            │
          │              │ (Railway) │                            │
          │              │           │                            │
          │              │ • Stream  │                            │
          │              │   prices  │                            │
          │              │ • Build   │                            │
          │              │   M1      │                            │
          │              │ • 24/5    │                            │
          │              └───────────┘                            │
          │                                                       │
          └───────────────────────────────────────────────────────┘
                           All queryable by Claude
```

### Data Flow Summary

```
OANDA API
    │
    │ Streaming prices (24/5)
    ▼
┌─────────────────────────────┐
│   OANDA Worker (Railway)    │
│   - Aggregates ticks → M1   │
│   - Writes complete candles │
│   - Handles reconnection    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│   Timescale (Supabase)      │
│   - Stores M1 candles       │
│   - Continuous aggregates   │
│     auto-create M5,M15,H1   │
│   - Real-time subscription  │
│     to frontend             │
└──────────────┬──────────────┘
               │
               │ Nightly cron (00:30 UTC)
               │ Candles older than 30 days
               ▼
┌─────────────────────────────┐
│   ClickHouse                │
│   - Cold storage            │
│   - Event windows (JSONB)   │
│   - Backtesting queries     │
│   - Aggregated statistics   │
└─────────────────────────────┘
```

---

## Database 1: Convex (Application Layer)

### Purpose
Handles all application state that requires real-time subscriptions, user authentication, and transactional operations.

### What Stays in Convex

```typescript
// convex/schema.ts

// User & Auth
users: defineTable({
  clerkId: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  settings: v.object({
    defaultPairs: v.array(v.string()),
    defaultTimeframe: v.string(),
    timezone: v.string(),
    chartTheme: v.string(),
  }),
  createdAt: v.number(),
  updatedAt: v.number(),
})
.index("by_clerk", ["clerkId"]),

// Trade Logs (your actual trades, not historical data)
trades: defineTable({
  userId: v.id("users"),
  pair: v.string(),
  direction: v.union(v.literal("long"), v.literal("short")),
  status: v.union(v.literal("pending"), v.literal("open"), v.literal("closed")),
  
  // Entry
  entryTimestamp: v.number(),
  entryPrice: v.number(),
  stopLoss: v.number(),
  takeProfit: v.number(),
  positionSize: v.optional(v.number()),
  
  // Exit
  exitTimestamp: v.optional(v.number()),
  exitPrice: v.optional(v.number()),
  exitReason: v.optional(v.string()),
  
  // Outcome
  outcome: v.optional(v.union(v.literal("win"), v.literal("loss"), v.literal("breakeven"))),
  rrAchieved: v.optional(v.number()),
  pnlPips: v.optional(v.number()),
  
  // Human Layer
  screenshotEntry: v.optional(v.string()),  // Convex file storage ID
  screenshotExit: v.optional(v.string()),
  thoughtsPreEntry: v.optional(v.string()),
  thoughtsPostTrade: v.optional(v.string()),
  voiceNotes: v.optional(v.array(v.string())),
  tags: v.optional(v.array(v.string())),
  
  // Context references (IDs to query other DBs)
  technicalSnapshotId: v.optional(v.string()),  // Reference to Timescale snapshot
  newsContext: v.optional(v.object({
    nearestEventId: v.string(),
    minutesFromEvent: v.number(),
    eventType: v.string(),
  })),
  
  // Strategy
  strategyId: v.optional(v.id("strategies")),
  strategyScore: v.optional(v.number()),
  
  // AI
  claudeAnalysis: v.optional(v.string()),
  
  createdAt: v.number(),
  updatedAt: v.number(),
})
.index("by_user", ["userId"])
.index("by_status", ["status"])
.index("by_pair", ["pair"])
.index("by_entry_time", ["entryTimestamp"]),

// Strategies
strategies: defineTable({
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  status: v.union(v.literal("active"), v.literal("shadow"), v.literal("archived")),
  
  // Strategy definition as JSON
  conditions: v.array(v.object({
    id: v.string(),
    type: v.string(),
    params: v.any(),
    weight: v.number(),
    required: v.boolean(),
  })),
  minimumScore: v.number(),
  
  // Risk rules
  riskRules: v.optional(v.object({
    stopLossType: v.string(),
    stopLossValue: v.number(),
    takeProfitType: v.string(),
    takeProfitValue: v.number(),
    maxDailyLoss: v.optional(v.number()),
    maxDailyTrades: v.optional(v.number()),
  })),
  
  createdAt: v.number(),
  updatedAt: v.number(),
})
.index("by_user", ["userId"])
.index("by_status", ["status"]),

// Claude Conversations
claudeConversations: defineTable({
  userId: v.id("users"),
  context: v.string(),  // "trade_analysis", "setup_scan", "backtest", "general"
  tradeId: v.optional(v.id("trades")),
  strategyId: v.optional(v.id("strategies")),
  
  messages: v.array(v.object({
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
    // References to data Claude used
    dataRefs: v.optional(v.array(v.object({
      source: v.string(),  // "timescale", "clickhouse"
      query: v.string(),
      resultSummary: v.optional(v.string()),
    }))),
  })),
  
  createdAt: v.number(),
  updatedAt: v.number(),
})
.index("by_user", ["userId"])
.index("by_trade", ["tradeId"]),

// Alerts & Notifications
alerts: defineTable({
  userId: v.id("users"),
  strategyId: v.optional(v.id("strategies")),
  pair: v.string(),
  type: v.union(v.literal("setup"), v.literal("news"), v.literal("price")),
  
  triggered: v.boolean(),
  triggeredAt: v.optional(v.number()),
  
  conditions: v.any(),
  message: v.string(),
  
  createdAt: v.number(),
})
.index("by_user", ["userId"])
.index("by_triggered", ["triggered"]),
```

### What Gets REMOVED from Convex

- `candles` table (all 7.8M rows) → Moving to Timescale + ClickHouse
- `newsEvents` table → Moving to Timescale
- `eventPriceReactions` table → Moving to Timescale
- `eventCandleWindows` table → Moving to Timescale
- `sessionLevels` table → Moving to Timescale
- `htfLevels` table → Moving to Timescale
- `fvgs` table → Moving to Timescale
- `sweeps` table → Moving to Timescale

### Why Convex for This Layer

1. **Real-time subscriptions** — When a trade status changes, UI updates instantly
2. **Optimistic updates** — Fast UX for trade entry forms
3. **File storage** — Screenshots, voice notes stored with Convex
4. **Auth integration** — Clerk + Convex work seamlessly
5. **Low document count** — Maybe 10k trades over years, not millions
6. **TypeScript end-to-end** — Schema validation, type safety

### Expected Convex Usage After Migration

| Metric | Before | After |
|--------|--------|-------|
| Document count | ~8M | ~50k |
| Bandwidth | 83GB+ | <5GB |
| Cost | Overages | Free tier |

---

## Database 2: TimescaleDB via Supabase (Operational Layer)

### Purpose
Handles all time-series data that needs:
- Fast range queries for charting
- JOINs between candles, news, sessions
- Real-time writes from OANDA streaming
- Recent data queries (last 30 days)

### Why TimescaleDB

1. **It's Postgres** — Familiar SQL, no new query language
2. **Hypertables** — Automatic time-based partitioning
3. **Compression** — 10-20x compression on historical data
4. **Continuous aggregates** — Pre-computed rollups
5. **JOINs work** — Unlike ClickHouse, full JOIN support
6. **Supabase hosting** — Easy setup, good free tier, scales

### Schema

```sql
-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ═══════════════════════════════════════════════════════════════
-- CANDLES (Hot Data - Last 30 Days)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE candles (
    time TIMESTAMPTZ NOT NULL,
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,  -- 'M1', 'M5', 'M15', 'H1', 'H4', 'D'
    open DECIMAL(10, 5) NOT NULL,
    high DECIMAL(10, 5) NOT NULL,
    low DECIMAL(10, 5) NOT NULL,
    close DECIMAL(10, 5) NOT NULL,
    volume INTEGER,
    complete BOOLEAN DEFAULT true,
    
    -- Velocity data (calculated on close)
    time_to_high_ms INTEGER,
    time_to_low_ms INTEGER,
    high_formed_first BOOLEAN,
    body_percent DECIMAL(5, 2),
    range_pips DECIMAL(8, 2),
    is_displacement BOOLEAN DEFAULT false,
    displacement_score DECIMAL(5, 2),
    
    PRIMARY KEY (time, pair, timeframe)
);

-- Convert to hypertable (automatic time partitioning)
SELECT create_hypertable('candles', 'time');

-- Indexes for common queries
CREATE INDEX idx_candles_pair_tf ON candles (pair, timeframe, time DESC);
CREATE INDEX idx_candles_displacement ON candles (pair, timeframe, is_displacement) WHERE is_displacement = true;

-- Enable compression for data older than 7 days
ALTER TABLE candles SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'pair, timeframe'
);
SELECT add_compression_policy('candles', INTERVAL '7 days');

-- ═══════════════════════════════════════════════════════════════
-- NEWS EVENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE news_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) UNIQUE NOT NULL,  -- Your generated ID
    event_type VARCHAR(50) NOT NULL,         -- 'FOMC', 'NFP', 'CPI', etc.
    name VARCHAR(255) NOT NULL,
    
    country VARCHAR(10) NOT NULL,
    currency VARCHAR(5) NOT NULL,
    
    timestamp TIMESTAMPTZ NOT NULL,
    
    impact VARCHAR(10) NOT NULL,  -- 'high', 'medium', 'low'
    
    actual VARCHAR(50),
    forecast VARCHAR(50),
    previous VARCHAR(50),
    surprise_factor DECIMAL(10, 4),
    
    description TEXT,
    
    -- Window configuration
    window_before_minutes INTEGER DEFAULT 15,
    window_after_minutes INTEGER NOT NULL,  -- 15, 60, or 90 based on tier
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_news_timestamp ON news_events (timestamp DESC);
CREATE INDEX idx_news_type ON news_events (event_type);
CREATE INDEX idx_news_currency ON news_events (currency);
CREATE INDEX idx_news_impact ON news_events (impact);

-- ═══════════════════════════════════════════════════════════════
-- NEWS EVENT 1-MINUTE CANDLE WINDOWS
-- ═══════════════════════════════════════════════════════════════
-- NOTE: This table has been MOVED TO CLICKHOUSE for better compression
-- and analytics performance. See trading-system-migration-v2-updates.md
-- for the optimized schema using parallel arrays instead of JSONB.

-- ═══════════════════════════════════════════════════════════════
-- PRICE REACTIONS (Calculated from windows)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE event_price_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) NOT NULL REFERENCES news_events(event_id),
    pair VARCHAR(10) NOT NULL,
    
    -- Pre-event prices
    price_at_minus_15m DECIMAL(10, 5),
    price_at_minus_5m DECIMAL(10, 5),
    price_at_event DECIMAL(10, 5) NOT NULL,
    
    -- Spike data (first 5 minutes)
    spike_high DECIMAL(10, 5) NOT NULL,
    spike_low DECIMAL(10, 5) NOT NULL,
    spike_direction VARCHAR(10) NOT NULL,  -- 'UP', 'DOWN'
    spike_magnitude_pips DECIMAL(8, 2) NOT NULL,
    time_to_spike_seconds INTEGER,
    spike_velocity_pips_per_sec DECIMAL(8, 4),
    
    -- Settlement prices
    price_at_plus_5m DECIMAL(10, 5),
    price_at_plus_15m DECIMAL(10, 5),
    price_at_plus_30m DECIMAL(10, 5),
    price_at_plus_60m DECIMAL(10, 5),
    price_at_plus_90m DECIMAL(10, 5),
    
    -- Pattern classification
    pattern_type VARCHAR(50) NOT NULL,
    /*
    Pattern types:
    - 'spike_up_continuation'
    - 'spike_up_reversal'
    - 'spike_up_partial_reversal'
    - 'spike_down_continuation'
    - 'spike_down_reversal'
    - 'spike_down_partial_reversal'
    - 'whipsaw'
    - 'muted'
    */
    
    did_reverse BOOLEAN NOT NULL,
    reversal_magnitude_pips DECIMAL(8, 2),
    reversal_time_minutes INTEGER,
    final_direction VARCHAR(10),  -- Direction at end of window
    final_matches_spike BOOLEAN NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_epr_event ON event_price_reactions (event_id);
CREATE INDEX idx_epr_pair ON event_price_reactions (pair);
CREATE INDEX idx_epr_pattern ON event_price_reactions (pattern_type);
CREATE UNIQUE INDEX idx_epr_event_pair ON event_price_reactions (event_id, pair);

-- ═══════════════════════════════════════════════════════════════
-- SESSION LEVELS (Daily)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE session_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    date DATE NOT NULL,
    
    -- Asia (00:00 - 08:00 UTC)
    asia_high DECIMAL(10, 5),
    asia_low DECIMAL(10, 5),
    asia_open DECIMAL(10, 5),
    asia_close DECIMAL(10, 5),
    asia_range_pips DECIMAL(8, 2),
    asia_time_of_high TIME,
    asia_time_of_low TIME,
    
    -- London (08:00 - 16:00 UTC)
    london_high DECIMAL(10, 5),
    london_low DECIMAL(10, 5),
    london_open DECIMAL(10, 5),
    london_close DECIMAL(10, 5),
    london_range_pips DECIMAL(8, 2),
    london_swept_asia_high BOOLEAN,
    london_swept_asia_low BOOLEAN,
    london_time_of_high TIME,
    london_time_of_low TIME,
    
    -- New York (13:00 - 21:00 UTC)
    ny_high DECIMAL(10, 5),
    ny_low DECIMAL(10, 5),
    ny_open DECIMAL(10, 5),
    ny_close DECIMAL(10, 5),
    ny_range_pips DECIMAL(8, 2),
    ny_swept_london_high BOOLEAN,
    ny_swept_london_low BOOLEAN,
    ny_swept_asia_high BOOLEAN,
    ny_swept_asia_low BOOLEAN,
    ny_time_of_high TIME,
    ny_time_of_low TIME,
    
    -- Daily
    daily_high DECIMAL(10, 5),
    daily_low DECIMAL(10, 5),
    daily_open DECIMAL(10, 5),
    daily_close DECIMAL(10, 5),
    daily_range_pips DECIMAL(8, 2),
    high_before_low BOOLEAN,
    
    -- Previous day reference
    previous_day_high DECIMAL(10, 5),
    previous_day_low DECIMAL(10, 5),
    swept_pdh BOOLEAN,
    swept_pdl BOOLEAN,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(pair, date)
);

CREATE INDEX idx_session_pair ON session_levels (pair, date DESC);

-- ═══════════════════════════════════════════════════════════════
-- HTF LEVELS (Weekly/Monthly/Quarterly/Yearly)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE htf_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    date DATE NOT NULL,  -- Date this record was calculated
    
    -- Weekly
    weekly_high DECIMAL(10, 5),
    weekly_low DECIMAL(10, 5),
    weekly_open DECIMAL(10, 5),
    previous_week_high DECIMAL(10, 5),
    previous_week_low DECIMAL(10, 5),
    
    -- Monthly
    monthly_high DECIMAL(10, 5),
    monthly_low DECIMAL(10, 5),
    monthly_open DECIMAL(10, 5),
    previous_month_high DECIMAL(10, 5),
    previous_month_low DECIMAL(10, 5),
    
    -- Quarterly
    quarterly_high DECIMAL(10, 5),
    quarterly_low DECIMAL(10, 5),
    quarterly_open DECIMAL(10, 5),
    previous_quarter_high DECIMAL(10, 5),
    previous_quarter_low DECIMAL(10, 5),
    
    -- Yearly
    yearly_high DECIMAL(10, 5),
    yearly_low DECIMAL(10, 5),
    yearly_open DECIMAL(10, 5),
    previous_year_high DECIMAL(10, 5),
    previous_year_low DECIMAL(10, 5),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(pair, date)
);

CREATE INDEX idx_htf_pair ON htf_levels (pair, date DESC);

-- ═══════════════════════════════════════════════════════════════
-- FVGs (Fair Value Gaps)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE fvgs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    
    direction VARCHAR(10) NOT NULL,  -- 'bullish', 'bearish'
    
    gap_high DECIMAL(10, 5) NOT NULL,
    gap_low DECIMAL(10, 5) NOT NULL,
    gap_size_pips DECIMAL(8, 2) NOT NULL,
    gap_midpoint DECIMAL(10, 5) NOT NULL,
    
    displacement_velocity DECIMAL(10, 4),
    displacement_body_percent DECIMAL(5, 2),
    
    session_formed VARCHAR(20),  -- 'asia', 'london', 'new_york'
    near_htf_level BOOLEAN DEFAULT false,
    htf_level_name VARCHAR(50),
    
    status VARCHAR(20) NOT NULL DEFAULT 'unfilled',  -- 'unfilled', 'partial', 'filled'
    fill_percentage DECIMAL(5, 2) DEFAULT 0,
    time_to_fill_minutes INTEGER,
    candles_to_fill INTEGER,
    
    traded BOOLEAN DEFAULT false,
    trade_result VARCHAR(20),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('fvgs', 'timestamp');
CREATE INDEX idx_fvgs_pair_tf ON fvgs (pair, timeframe, timestamp DESC);
CREATE INDEX idx_fvgs_status ON fvgs (status) WHERE status = 'unfilled';

-- ═══════════════════════════════════════════════════════════════
-- SWEEPS (Liquidity Sweeps)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE sweeps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(10) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    
    level_swept VARCHAR(50) NOT NULL,  -- 'asia_high', 'pdl', 'pwh', 'equal_lows'
    level_price DECIMAL(10, 5) NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- 'above', 'below'
    
    exceeded_by_pips DECIMAL(8, 2) NOT NULL,
    time_beyond_level_seconds INTEGER,
    candles_beyond_level INTEGER,
    sweep_velocity DECIMAL(10, 4),
    
    immediate_reversal BOOLEAN,
    reversal_followed BOOLEAN,
    reversal_size_pips DECIMAL(8, 2),
    reversal_duration_candles INTEGER,
    
    traded BOOLEAN DEFAULT false,
    trade_result VARCHAR(20),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('sweeps', 'timestamp');
CREATE INDEX idx_sweeps_pair ON sweeps (pair, timestamp DESC);
CREATE INDEX idx_sweeps_level ON sweeps (level_swept);

-- ═══════════════════════════════════════════════════════════════
-- VIEWS FOR COMMON QUERIES
-- ═══════════════════════════════════════════════════════════════

-- Latest session levels per pair
CREATE VIEW latest_session_levels AS
SELECT DISTINCT ON (pair) *
FROM session_levels
ORDER BY pair, date DESC;

-- Unfilled FVGs
CREATE VIEW active_fvgs AS
SELECT * FROM fvgs
WHERE status = 'unfilled'
AND timestamp > NOW() - INTERVAL '7 days';

-- Recent sweeps
CREATE VIEW recent_sweeps AS
SELECT * FROM sweeps
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- ═══════════════════════════════════════════════════════════════
-- FUNCTIONS FOR COMMON OPERATIONS
-- ═══════════════════════════════════════════════════════════════

-- Get candles for chart
CREATE OR REPLACE FUNCTION get_candles(
    p_pair VARCHAR,
    p_timeframe VARCHAR,
    p_start TIMESTAMPTZ,
    p_end TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    time TIMESTAMPTZ,
    open DECIMAL,
    high DECIMAL,
    low DECIMAL,
    close DECIMAL,
    volume INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT c.time, c.open, c.high, c.low, c.close, c.volume
    FROM candles c
    WHERE c.pair = p_pair
    AND c.timeframe = p_timeframe
    AND c.time BETWEEN p_start AND p_end
    ORDER BY c.time ASC;
END;
$$ LANGUAGE plpgsql;

-- Get news events near a timestamp
CREATE OR REPLACE FUNCTION get_nearby_news(
    p_timestamp TIMESTAMPTZ,
    p_window_hours INTEGER DEFAULT 4
)
RETURNS TABLE (
    event_id VARCHAR,
    event_type VARCHAR,
    name VARCHAR,
    currency VARCHAR,
    impact VARCHAR,
    timestamp TIMESTAMPTZ,
    minutes_from_input DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        n.event_id,
        n.event_type,
        n.name,
        n.currency,
        n.impact,
        n.timestamp,
        EXTRACT(EPOCH FROM (n.timestamp - p_timestamp)) / 60 as minutes_from_input
    FROM news_events n
    WHERE n.timestamp BETWEEN p_timestamp - (p_window_hours || ' hours')::INTERVAL
                          AND p_timestamp + (p_window_hours || ' hours')::INTERVAL
    ORDER BY ABS(EXTRACT(EPOCH FROM (n.timestamp - p_timestamp)));
END;
$$ LANGUAGE plpgsql;
```

### Data Retention Policy

```sql
-- Keep only last 30 days of candles in Timescale
-- Older data synced to ClickHouse nightly
SELECT add_retention_policy('candles', INTERVAL '30 days');

-- Keep all news data (relatively small)
-- Keep all session levels (small, useful for JOINs)
-- Keep all FVGs/sweeps (medium, useful for recent analysis)
```

### Expected Timescale Usage

| Data | Rows | Size (compressed) |
|------|------|-------------------|
| Candles (30 days) | ~500k | ~50MB |
| News events | ~19k | ~5MB |
| Event windows | ~130k | ~100MB |
| Price reactions | ~130k | ~20MB |
| Session levels | ~50k | ~10MB |
| FVGs | ~100k | ~15MB |
| Sweeps | ~50k | ~10MB |
| **Total** | ~1M | ~210MB |

Well within Supabase free tier (500MB) or Pro tier (8GB).

---

## Database 3: ClickHouse (Analytics Layer)

### Purpose
Handles all heavy analytical queries that scan millions of rows:
- Historical candles (2007-present, excluding last 30 days)
- Backtesting across years of data
- Pattern discovery queries
- Aggregations for statistics

### Why ClickHouse

1. **10-100x faster** than Postgres for analytical queries
2. **Column-oriented** — Only reads columns you need
3. **Extreme compression** — 7.8M candles → maybe 200MB
4. **Vectorized execution** — Processes millions of rows per second
5. **Built for "big scans"** — Exactly what backtesting needs

### Schema

```sql
-- ═══════════════════════════════════════════════════════════════
-- HISTORICAL CANDLES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE candles (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    open Decimal(10, 5) CODEC(Gorilla),
    high Decimal(10, 5) CODEC(Gorilla),
    low Decimal(10, 5) CODEC(Gorilla),
    close Decimal(10, 5) CODEC(Gorilla),
    volume UInt32 CODEC(T64),
    
    -- Velocity data
    time_to_high_ms UInt32 CODEC(T64),
    time_to_low_ms UInt32 CODEC(T64),
    high_formed_first UInt8,
    body_percent Decimal(5, 2),
    range_pips Decimal(8, 2),
    is_displacement UInt8,
    displacement_score Decimal(5, 2)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(time)
ORDER BY (pair, timeframe, time)
SETTINGS index_granularity = 8192;

-- ═══════════════════════════════════════════════════════════════
-- AGGREGATED EVENT STATISTICS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE event_type_statistics (
    event_type LowCardinality(String),
    pair LowCardinality(String),
    
    sample_size UInt32,
    date_range_start DateTime,
    date_range_end DateTime,
    
    -- Spike stats
    avg_spike_pips Decimal(8, 2),
    median_spike_pips Decimal(8, 2),
    max_spike_pips Decimal(8, 2),
    min_spike_pips Decimal(8, 2),
    stddev_spike_pips Decimal(8, 2),
    
    -- Direction stats
    spike_up_count UInt32,
    spike_down_count UInt32,
    spike_up_pct Decimal(5, 2),
    
    -- Reversal stats
    reversal_within_15m_count UInt32,
    reversal_within_30m_count UInt32,
    reversal_within_60m_count UInt32,
    reversal_within_15m_pct Decimal(5, 2),
    reversal_within_30m_pct Decimal(5, 2),
    reversal_within_60m_pct Decimal(5, 2),
    
    -- Final direction
    final_matches_spike_count UInt32,
    final_matches_spike_pct Decimal(5, 2),
    
    -- Surprise correlation
    avg_spike_when_no_surprise Decimal(8, 2),
    avg_spike_when_surprise Decimal(8, 2),
    
    last_updated DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(last_updated)
ORDER BY (event_type, pair);

-- ═══════════════════════════════════════════════════════════════
-- BACKTEST RESULTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE backtest_results (
    id UUID DEFAULT generateUUIDv4(),
    strategy_id String,
    strategy_name String,
    
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    date_from Date,
    date_to Date,
    
    -- Overall results
    total_trades UInt32,
    wins UInt32,
    losses UInt32,
    breakeven UInt32,
    win_rate Decimal(5, 2),
    profit_factor Decimal(8, 2),
    avg_rr Decimal(5, 2),
    max_drawdown Decimal(8, 2),
    max_consecutive_losses UInt8,
    avg_hold_time_minutes UInt32,
    trades_per_week Decimal(5, 2),
    
    -- By session
    asia_trades UInt32,
    asia_win_rate Decimal(5, 2),
    london_trades UInt32,
    london_win_rate Decimal(5, 2),
    ny_trades UInt32,
    ny_win_rate Decimal(5, 2),
    
    -- By day
    monday_win_rate Decimal(5, 2),
    tuesday_win_rate Decimal(5, 2),
    wednesday_win_rate Decimal(5, 2),
    thursday_win_rate Decimal(5, 2),
    friday_win_rate Decimal(5, 2),
    
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (strategy_id, pair, date_from);

-- ═══════════════════════════════════════════════════════════════
-- BACKTEST INDIVIDUAL TRADES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE backtest_trades (
    backtest_id UUID,
    trade_number UInt32,
    
    pair LowCardinality(String),
    direction LowCardinality(String),
    
    entry_time DateTime64(3),
    exit_time DateTime64(3),
    entry_price Decimal(10, 5),
    exit_price Decimal(10, 5),
    stop_loss Decimal(10, 5),
    take_profit Decimal(10, 5),
    
    outcome LowCardinality(String),
    rr_achieved Decimal(5, 2),
    pnl_pips Decimal(8, 2),
    
    conditions_met Array(String),
    
    session LowCardinality(String),
    day_of_week UInt8
)
ENGINE = MergeTree()
ORDER BY (backtest_id, entry_time);

-- ═══════════════════════════════════════════════════════════════
-- MATERIALIZED VIEWS FOR COMMON ANALYTICS
-- ═══════════════════════════════════════════════════════════════

-- Daily volatility by pair
CREATE MATERIALIZED VIEW daily_volatility
ENGINE = SummingMergeTree()
ORDER BY (pair, date)
AS SELECT
    pair,
    toDate(time) as date,
    max(high) - min(low) as daily_range,
    avg(range_pips) as avg_candle_range
FROM candles
WHERE timeframe = 'M15'
GROUP BY pair, toDate(time);

-- Session performance summary
CREATE MATERIALIZED VIEW session_performance
ENGINE = SummingMergeTree()
ORDER BY (pair, year_month, session)
AS SELECT
    pair,
    toYYYYMM(time) as year_month,
    multiIf(
        toHour(time) >= 0 AND toHour(time) < 8, 'asia',
        toHour(time) >= 8 AND toHour(time) < 16, 'london',
        'new_york'
    ) as session,
    count() as candle_count,
    avg(range_pips) as avg_range,
    sum(is_displacement) as displacement_count
FROM candles
WHERE timeframe = 'M15'
GROUP BY pair, toYYYYMM(time), session;
```

### Example ClickHouse Queries

```sql
-- "What's my average spike on NFP across all history?"
SELECT
    event_type,
    pair,
    avg_spike_pips,
    sample_size,
    reversal_within_30m_pct
FROM event_type_statistics
WHERE event_type = 'NFP'
ORDER BY pair;
-- Returns in ~2ms

-- "Backtest: Find all instances where London swept Asia high, 
-- then price reversed, between 2015-2024"
WITH sweep_days AS (
    SELECT DISTINCT toDate(time) as sweep_date, pair
    FROM candles
    WHERE timeframe = 'M15'
    AND toHour(time) BETWEEN 8 AND 12
    -- Complex sweep detection logic here
)
SELECT 
    COUNT(*) as occurrences,
    AVG(subsequent_move) as avg_move
FROM sweep_days
-- Scans 10 years of data in ~500ms

-- "What day of week has highest volatility for EUR_USD?"
SELECT
    toDayOfWeek(date) as day_of_week,
    avg(daily_range) as avg_range
FROM daily_volatility
WHERE pair = 'EUR_USD'
GROUP BY day_of_week
ORDER BY avg_range DESC;
-- Returns in ~5ms
```

### Data Sync: Timescale → ClickHouse

```typescript
// Nightly cron job (runs at 00:30 UTC)
// Moves candles older than 30 days from Timescale to ClickHouse

async function syncToClickHouse() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    
    // 1. Get candles to migrate from Timescale
    const { data: candles } = await supabase
        .from('candles')
        .select('*')
        .lt('time', cutoffDate.toISOString())
        .limit(100000);  // Batch size
    
    if (candles.length === 0) return;
    
    // 2. Insert into ClickHouse
    await clickhouse.insert({
        table: 'candles',
        values: candles,
        format: 'JSONEachRow'
    });
    
    // 3. Delete from Timescale (retention policy handles this automatically)
    // OR manual delete if needed:
    // await supabase.from('candles').delete().lt('time', cutoffDate.toISOString());
    
    console.log(`Synced ${candles.length} candles to ClickHouse`);
}
```

### Expected ClickHouse Usage

| Data | Rows | Size (compressed) |
|------|------|-------------------|
| Candles (2007-2024) | ~7.3M | ~150MB |
| Event statistics | ~200 | <1MB |
| Backtest results | ~1k | ~5MB |
| Backtest trades | ~500k | ~50MB |
| **Total** | ~7.8M | ~200MB |

ClickHouse Cloud free tier: 10GB storage, plenty of room.

---

## Query Routing: How Claude Knows Which Database to Use

### Router Logic

```typescript
// lib/db/router.ts

type QueryIntent = 
    | 'chart_data'           // → Timescale
    | 'recent_analysis'      // → Timescale
    | 'historical_pattern'   // → ClickHouse
    | 'backtest'             // → ClickHouse
    | 'aggregation'          // → ClickHouse
    | 'trade_crud'           // → Convex
    | 'strategy_crud'        // → Convex
    | 'user_data'            // → Convex
    | 'mixed';               // → Multiple

function routeQuery(query: string): QueryIntent {
    const lowerQuery = query.toLowerCase();
    
    // Historical patterns → ClickHouse
    if (lowerQuery.includes('historically') ||
        lowerQuery.includes('all time') ||
        lowerQuery.includes('since 2') ||
        lowerQuery.includes('backtest') ||
        lowerQuery.includes('average') && lowerQuery.includes('all') ||
        lowerQuery.includes('win rate') && !lowerQuery.includes('today')) {
        return 'historical_pattern';
    }
    
    // Recent/live data → Timescale
    if (lowerQuery.includes('today') ||
        lowerQuery.includes('this week') ||
        lowerQuery.includes('current') ||
        lowerQuery.includes('chart') ||
        lowerQuery.includes('candles') ||
        lowerQuery.includes('session levels') ||
        lowerQuery.includes('upcoming news')) {
        return 'recent_analysis';
    }
    
    // Trade/strategy operations → Convex
    if (lowerQuery.includes('my trade') ||
        lowerQuery.includes('log') ||
        lowerQuery.includes('strategy') ||
        lowerQuery.includes('settings')) {
        return 'trade_crud';
    }
    
    return 'mixed';
}

// Database clients
import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@supabase/supabase-js";
import { createClient as createClickHouse } from "@clickhouse/client";

const convex = new ConvexHttpClient(process.env.CONVEX_URL!);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const clickhouse = createClickHouse({ host: process.env.CLICKHOUSE_HOST! });

// Unified query executor
async function executeQuery(intent: QueryIntent, params: any) {
    switch (intent) {
        case 'chart_data':
        case 'recent_analysis':
            return await supabase.rpc(params.function, params.args);
            
        case 'historical_pattern':
        case 'backtest':
        case 'aggregation':
            return await clickhouse.query({
                query: params.sql,
                format: 'JSONEachRow'
            });
            
        case 'trade_crud':
        case 'strategy_crud':
        case 'user_data':
            return await convex.query(params.function, params.args);
            
        case 'mixed':
            // Execute across multiple DBs and combine
            return await executeMixedQuery(params);
    }
}
```

### Claude Integration

```typescript
// convex/claude.ts

export const analyzeWithContext = action({
    args: {
        userMessage: v.string(),
        tradeId: v.optional(v.id("trades")),
    },
    handler: async (ctx, args) => {
        // 1. Determine what data Claude needs
        const intent = routeQuery(args.userMessage);
        
        // 2. Fetch relevant context from appropriate DBs
        let context: any = {};
        
        if (intent === 'recent_analysis' || intent === 'mixed') {
            // Get recent candles from Timescale
            context.recentCandles = await supabase.rpc('get_candles', {
                p_pair: 'EUR_USD',
                p_timeframe: 'M15',
                p_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
            });
            
            // Get session levels
            context.sessionLevels = await supabase
                .from('latest_session_levels')
                .select('*');
            
            // Get upcoming news
            context.upcomingNews = await supabase.rpc('get_nearby_news', {
                p_timestamp: new Date().toISOString(),
                p_window_hours: 24
            });
        }
        
        if (intent === 'historical_pattern' || intent === 'mixed') {
            // Get historical stats from ClickHouse
            context.eventStats = await clickhouse.query({
                query: `SELECT * FROM event_type_statistics WHERE pair = 'EUR_USD'`,
                format: 'JSONEachRow'
            });
        }
        
        if (args.tradeId) {
            // Get trade details from Convex
            context.trade = await ctx.runQuery(api.trades.get, { id: args.tradeId });
        }
        
        // 3. Call Claude with context
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2000,
            system: buildSystemPrompt(context),
            messages: [{ role: "user", content: args.userMessage }]
        });
        
        return response.content[0].text;
    }
});
```

---

## Migration Steps

### Phase 1: Setup Infrastructure (Day 1)

```bash
# 1. Create Supabase project
# Go to supabase.com, create new project
# Enable TimescaleDB extension in SQL editor:
CREATE EXTENSION IF NOT EXISTS timescaledb;

# 2. Create ClickHouse Cloud account
# Go to clickhouse.cloud, create free tier instance
# Note connection details

# 3. Install dependencies
npm install @supabase/supabase-js @clickhouse/client
```

### Phase 2: Create Schemas (Day 1)

```bash
# Run the SQL schemas provided above in:
# - Supabase SQL Editor (Timescale schema)
# - ClickHouse Cloud console (ClickHouse schema)
```

### Phase 3: Migrate Historical Candles to ClickHouse (Day 2-3)

```typescript
// scripts/migrate-candles-to-clickhouse.ts

import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@clickhouse/client";
import { api } from "../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.CONVEX_URL!);
const clickhouse = createClient({ 
    host: process.env.CLICKHOUSE_HOST!,
    password: process.env.CLICKHOUSE_PASSWORD!
});

async function migrateCandles() {
    const pairs = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF', 'AUD_USD', 'USD_CAD', 'NZD_USD'];
    const timeframes = ['M5', 'M15', 'M30', 'H1', 'H4', 'D', 'W', 'M'];
    
    for (const pair of pairs) {
        for (const timeframe of timeframes) {
            console.log(`Migrating ${pair} ${timeframe}...`);
            
            let cursor = null;
            let totalMigrated = 0;
            
            while (true) {
                // Fetch batch from Convex
                const result = await convex.query(api.candles.getBatch, {
                    pair,
                    timeframe,
                    cursor,
                    limit: 10000
                });
                
                if (result.candles.length === 0) break;
                
                // Transform for ClickHouse
                const transformed = result.candles.map(c => ({
                    time: new Date(c.timestamp).toISOString(),
                    pair: c.pair,
                    timeframe: c.timeframe,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    volume: c.volume || 0,
                    time_to_high_ms: c.timeToHighMs || 0,
                    time_to_low_ms: c.timeToLowMs || 0,
                    high_formed_first: c.highFormedFirst ? 1 : 0,
                    body_percent: c.bodyPercent || 0,
                    range_pips: c.rangePips || 0,
                    is_displacement: c.isDisplacement ? 1 : 0,
                    displacement_score: c.displacementScore || 0
                }));
                
                // Insert into ClickHouse
                await clickhouse.insert({
                    table: 'candles',
                    values: transformed,
                    format: 'JSONEachRow'
                });
                
                totalMigrated += result.candles.length;
                cursor = result.nextCursor;
                
                console.log(`  Migrated ${totalMigrated} candles...`);
            }
            
            console.log(`✓ ${pair} ${timeframe}: ${totalMigrated} candles`);
        }
    }
    
    console.log('Migration complete!');
}

migrateCandles().catch(console.error);
```

### Phase 4: Migrate Recent Candles + News to Timescale (Day 3-4)

```typescript
// scripts/migrate-to-timescale.ts

import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@supabase/supabase-js";

const convex = new ConvexHttpClient(process.env.CONVEX_URL!);
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

async function migrateRecentCandles() {
    // Only last 30 days to Timescale
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    // Similar batch logic as above, but insert to Supabase
    // ...
}

async function migrateNewsEvents() {
    console.log('Migrating news events...');
    
    let cursor = null;
    let total = 0;
    
    while (true) {
        const result = await convex.query(api.newsEvents.getBatch, {
            cursor,
            limit: 1000
        });
        
        if (result.events.length === 0) break;
        
        const { error } = await supabase
            .from('news_events')
            .upsert(result.events.map(e => ({
                event_id: e.eventId,
                event_type: e.eventType,
                name: e.name,
                country: e.country,
                currency: e.currency,
                timestamp: new Date(e.timestamp).toISOString(),
                impact: e.impact,
                actual: e.actual,
                forecast: e.forecast,
                previous: e.previous,
                window_after_minutes: getWindowMinutes(e.eventType, e.impact)
            })));
        
        if (error) throw error;
        
        total += result.events.length;
        cursor = result.nextCursor;
        console.log(`  Migrated ${total} events...`);
    }
    
    console.log(`✓ News events: ${total}`);
}

function getWindowMinutes(eventType: string, impact: string): number {
    // FOMC, ECB, BoE, BoJ → 90 minutes
    if (['FOMC', 'ECB', 'BOE', 'BOJ', 'RBA', 'RBNZ', 'SNB', 'BOC'].includes(eventType)) {
        return 90;
    }
    // High impact → 60 minutes
    if (impact === 'high') return 60;
    // Medium/Low → 15 minutes
    return 15;
}
```

### Phase 5: Update Application Code (Day 4-5)

```typescript
// lib/db/index.ts - Unified database access

import { ConvexHttpClient } from "convex/browser";
import { createClient } from "@supabase/supabase-js";
import { createClient as createClickHouse } from "@clickhouse/client";

// Initialize clients
export const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const clickhouse = createClickHouse({
    host: process.env.CLICKHOUSE_HOST!,
    password: process.env.CLICKHOUSE_PASSWORD!,
    database: 'default'
});

// ═══════════════════════════════════════════════════════════════
// CANDLE QUERIES
// ═══════════════════════════════════════════════════════════════

export async function getCandles(
    pair: string,
    timeframe: string,
    start: Date,
    end: Date = new Date()
): Promise<Candle[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    if (start > thirtyDaysAgo) {
        // Recent data → Timescale
        const { data } = await supabase.rpc('get_candles', {
            p_pair: pair,
            p_timeframe: timeframe,
            p_start: start.toISOString(),
            p_end: end.toISOString()
        });
        return data;
    } else if (end < thirtyDaysAgo) {
        // Historical data → ClickHouse
        const result = await clickhouse.query({
            query: `
                SELECT * FROM candles
                WHERE pair = {pair:String}
                AND timeframe = {timeframe:String}
                AND time BETWEEN {start:DateTime64} AND {end:DateTime64}
                ORDER BY time
            `,
            query_params: { pair, timeframe, start, end },
            format: 'JSONEachRow'
        });
        return await result.json();
    } else {
        // Spans both → Query both and merge
        const [historical, recent] = await Promise.all([
            clickhouse.query({
                query: `SELECT * FROM candles WHERE pair = {pair:String} AND timeframe = {timeframe:String} AND time < {cutoff:DateTime64} ORDER BY time`,
                query_params: { pair, timeframe, cutoff: thirtyDaysAgo },
                format: 'JSONEachRow'
            }),
            supabase.rpc('get_candles', {
                p_pair: pair,
                p_timeframe: timeframe,
                p_start: thirtyDaysAgo.toISOString(),
                p_end: end.toISOString()
            })
        ]);
        
        return [...(await historical.json()), ...recent.data];
    }
}

// ═══════════════════════════════════════════════════════════════
// NEWS QUERIES
// ═══════════════════════════════════════════════════════════════

export async function getUpcomingNews(hoursAhead: number = 24) {
    const { data } = await supabase
        .from('news_events')
        .select('*')
        .gte('timestamp', new Date().toISOString())
        .lte('timestamp', new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString())
        .order('timestamp');
    return data;
}

export async function getEventStatistics(eventType: string, pair: string) {
    const result = await clickhouse.query({
        query: `SELECT * FROM event_type_statistics WHERE event_type = {eventType:String} AND pair = {pair:String}`,
        query_params: { eventType, pair },
        format: 'JSONEachRow'
    });
    return (await result.json())[0];
}

// ═══════════════════════════════════════════════════════════════
// OANDA STREAMING → TIMESCALE
// ═══════════════════════════════════════════════════════════════

export async function insertCandle(candle: Candle) {
    const { error } = await supabase
        .from('candles')
        .upsert({
            time: new Date(candle.timestamp).toISOString(),
            pair: candle.pair,
            timeframe: candle.timeframe,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            complete: candle.complete
        });
    
    if (error) throw error;
}
```

### Phase 6: Update Chart Component (Day 5)

```typescript
// components/chart/Chart.tsx

import { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { getCandles } from "@/lib/db";

export function Chart({ pair, timeframe }: { pair: string; timeframe: string }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    
    useEffect(() => {
        if (!containerRef.current) return;
        
        const chart = createChart(containerRef.current, {
            // ... chart options
        });
        
        const candleSeries = chart.addCandlestickSeries();
        
        // Load initial data
        async function loadData() {
            setLoading(true);
            
            // Get last 500 candles (from Timescale for recent, ClickHouse for older)
            const candles = await getCandles(
                pair,
                timeframe,
                new Date(Date.now() - 500 * timeframeToMs(timeframe)),
                new Date()
            );
            
            candleSeries.setData(candles.map(c => ({
                time: c.time / 1000,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            })));
            
            setLoading(false);
        }
        
        loadData();
        
        // Subscribe to real-time updates via Supabase
        const subscription = supabase
            .channel('candles')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'candles',
                filter: `pair=eq.${pair}&timeframe=eq.${timeframe}`
            }, (payload) => {
                candleSeries.update({
                    time: new Date(payload.new.time).getTime() / 1000,
                    open: payload.new.open,
                    high: payload.new.high,
                    low: payload.new.low,
                    close: payload.new.close
                });
            })
            .subscribe();
        
        return () => {
            subscription.unsubscribe();
            chart.remove();
        };
    }, [pair, timeframe]);
    
    return (
        <div ref={containerRef} className="w-full h-full">
            {loading && <div className="absolute inset-0 flex items-center justify-center">Loading...</div>}
        </div>
    );
}
```

### Phase 7: Delete from Convex (Day 6)

```typescript
// scripts/cleanup-convex.ts
// Only run AFTER verifying all data migrated successfully!

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.CONVEX_URL!);

async function cleanupConvex() {
    console.log('⚠️  This will delete all candles from Convex!');
    console.log('Make sure migration to Timescale + ClickHouse is verified.');
    console.log('Press Ctrl+C to cancel, or wait 10 seconds to continue...');
    
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Delete in batches
    let deleted = 0;
    while (true) {
        const result = await convex.mutation(api.candles.deleteBatch, { limit: 10000 });
        if (result.deleted === 0) break;
        deleted += result.deleted;
        console.log(`Deleted ${deleted} candles...`);
    }
    
    console.log(`✓ Deleted ${deleted} total candles from Convex`);
}
```

### Phase 8: Setup Nightly Sync (Day 6)

```typescript
// Vercel Cron or separate worker

// vercel.json
{
    "crons": [{
        "path": "/api/cron/sync-to-clickhouse",
        "schedule": "30 0 * * *"  // 00:30 UTC daily
    }]
}

// app/api/cron/sync-to-clickhouse/route.ts
export async function GET() {
    // Move candles older than 30 days from Timescale to ClickHouse
    // Delete from Timescale after confirmed in ClickHouse
    // Update event statistics in ClickHouse
    
    return Response.json({ success: true });
}
```

---

## Cost Summary

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| Convex | Free tier (after cleanup) | $0 |
| Supabase | Pro (8GB database) | $25 |
| ClickHouse Cloud | Free tier (10GB) | $0 |
| **Total** | | **$25/month** |

If you scale significantly:
- Supabase Pro: $25 (includes 8GB, 250k edge function calls)
- ClickHouse: $0.10/GB storage + $0.20/GB scan (pay as you go)
- Convex: Likely stays free with just application data

---

## Verification Checklist

After migration, verify:

- [ ] Charts load correctly from Timescale
- [ ] Historical queries work from ClickHouse
- [ ] OANDA streaming writes to Timescale
- [ ] News events queryable in Timescale
- [ ] Session levels calculating correctly
- [ ] Claude can query all three databases
- [ ] Trades still save/load from Convex
- [ ] Strategies still save/load from Convex
- [ ] Real-time subscriptions still work in UI
- [ ] Nightly sync job runs successfully
- [ ] Convex bandwidth usage drops significantly

---

## Architecture Decision Record

### Why Three Databases?

**Single DB (Convex only):**
- ❌ Bandwidth explosion on time-series queries
- ❌ Not optimized for analytical scans
- ❌ Expensive at scale

**Two DBs (Convex + Timescale):**
- ✓ Better for time-series
- ❌ Still slow for heavy analytics
- ❌ Backtesting would strain Timescale

**Three DBs (Convex + Timescale + ClickHouse):**
- ✓ Each DB does what it's best at
- ✓ Operational queries fast (Timescale)
- ✓ Analytical queries fast (ClickHouse)
- ✓ Application state real-time (Convex)
- ✓ Cost-effective at scale
- ✓ Future-proof for heavy backtesting

### Trade-offs Accepted

1. **Complexity** — Three systems to manage instead of one
2. **Data sync** — Need to keep ClickHouse updated
3. **Query routing** — Need logic to pick right database
4. **Multiple clients** — Three SDKs instead of one

These are acceptable because:
- The data volumes justify it (7.8M+ rows)
- The query patterns are distinct
- The cost savings are significant
- The performance gains are substantial

---

---

## Post-Migration Reality (January 2026)

This section documents the actual state after completing the migration.

### What Was Migrated

| Data | Source | Destination | Status |
|------|--------|-------------|--------|
| Historical candles | Convex | ClickHouse | ✅ 23M+ rows |
| Recent candles | Convex | TimescaleDB | ✅ 30-day rolling |
| News events (historical) | TimescaleDB | ClickHouse | ✅ 91,605 rows |
| News events (upcoming) | - | TimescaleDB | ✅ 30-day window |
| Event price reactions | TimescaleDB | ClickHouse | ✅ 578,777 rows |
| Event candle windows | - | ClickHouse | ✅ 580K+ rows |

### Key Architecture Decisions Made

1. **TimescaleDB for Hot Data**: 30-day rolling window for chart display and upcoming events
2. **ClickHouse for Cold Analytics**: All historical data, event reactions, and candle windows
3. **Query Routing**: APIs route to correct database based on time range

### API Endpoints and Their Databases

| Endpoint | Database | Purpose |
|----------|----------|---------|
| `/api/candles` | ClickHouse + TimescaleDB | Chart data (routes by time) |
| `/api/news/events` | TimescaleDB | Chart markers (30-day window) |
| `/api/news/historical` | ClickHouse | Historical event reactions |
| `/api/news/statistics` | ClickHouse | Aggregated event stats |
| `/api/news/upcoming` | TimescaleDB | Calendar events |

### Settlement Price Windows

| Window Type | Duration | Events | T+60 | T+90 |
|-------------|----------|--------|------|------|
| Standard | 30 min | Low/Medium impact | No | No |
| High Impact | 75 min | High impact events | ✅ | No |
| Extended (FOMC/ECB) | 105 min | Central bank decisions | ✅ | ✅ |

T+60/T+90 prices extracted from `event_candle_windows` candle arrays.

### Pip Calculation Baseline

All pip calculations now use **T-15 baseline** (price 15 minutes before event), not T+0. This provides more accurate measurement of event impact.

### Verification Checklist

Run `npx tsx scripts/verify-data-architecture.ts` to verify:
- [x] ClickHouse connections working
- [x] TimescaleDB connections working
- [x] Historical news events in ClickHouse
- [x] Historical reactions in ClickHouse
- [x] T+60 prices populated (80,966 rows)
- [x] T+90 prices populated (1,071 FOMC/ECB events)
- [x] Event candle windows available

### Cleanup

After verification, run `npx tsx scripts/cleanup-timescale-historical.ts` to:
1. Delete historical news_events (>30 days) from TimescaleDB
2. Delete all event_price_reactions from TimescaleDB
3. Run VACUUM to reclaim disk space

---

*Document Version: 2.0*
*Created: January 2026*
*Updated: January 2026 (Post-Migration Reality)*
*For: AI Trading System Migration*
