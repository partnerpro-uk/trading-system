# Migration Plan v2 Updates

## Addendum to Main Migration Document

This document contains all updates from the Claude Code review. Apply these changes to the main migration plan.

---

## Key Changes Summary

| Original Plan | Updated Plan |
|--------------|--------------|
| Event windows in Timescale (JSONB) | Event windows in ClickHouse (better compression) |
| Worker writes all timeframes | Worker writes M1 only, Timescale auto-aggregates |
| No version tracking | Added metadata columns for recalculation |
| Basic query routing | Added boundary deduplication logic |
| Unspecified streaming architecture | Railway worker for OANDA streaming |

---

## 1. Event Windows → ClickHouse (Not Timescale)

### Reasoning
- Event windows are fetched by `event_id`, not JOINed frequently
- ClickHouse compression on numeric arrays is exceptional (~20:1)
- Keeps Timescale lean and fast for real-time operations
- 580k windows × 100 candles = 4GB+ in Timescale JSONB is tight

### Updated ClickHouse Schema

Add this table to ClickHouse (not Timescale):

```sql
-- ═══════════════════════════════════════════════════════════════
-- EVENT CANDLE WINDOWS (M1 candles around news events)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE event_candle_windows (
    event_id String,
    pair LowCardinality(String),
    
    window_start DateTime64(3),
    window_end DateTime64(3),
    
    -- Parallel arrays (more efficient than Array of Tuples)
    candle_times Array(DateTime64(3)),
    candle_opens Array(Decimal(10, 5)),
    candle_highs Array(Decimal(10, 5)),
    candle_lows Array(Decimal(10, 5)),
    candle_closes Array(Decimal(10, 5)),
    candle_volumes Array(UInt32),
    
    candle_count UInt16,
    
    -- Metadata
    raw_source LowCardinality(String) DEFAULT 'oanda',
    fetched_at DateTime DEFAULT now(),
    window_version UInt8 DEFAULT 1,
    
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (event_id, pair)
SETTINGS index_granularity = 8192;

-- Query example: Get window for specific event
-- SELECT 
--     arrayZip(candle_times, candle_opens, candle_highs, candle_lows, candle_closes) as candles
-- FROM event_candle_windows 
-- WHERE event_id = 'NFP_2024-01-05_13:30';
```

### Updated Storage Estimates

| Database | Data | Size |
|----------|------|------|
| **Timescale** | M1 candles (30d), news events, reactions, sessions, FVGs, sweeps | ~500MB |
| **ClickHouse** | Historical candles + event windows + stats | ~4-5GB |

---

## 2. Continuous Aggregates (M1 → All Timeframes)

### Why This Matters
- Worker only needs to write M1 candles
- Timescale automatically creates M5, M15, M30, H1, H4, D1
- Reduces worker complexity significantly
- Always consistent (derived from same source data)

### Full Continuous Aggregate Setup

Add to Timescale schema:

```sql
-- ═══════════════════════════════════════════════════════════════
-- CONTINUOUS AGGREGATES (Auto-rollup M1 → Higher Timeframes)
-- ═══════════════════════════════════════════════════════════════

-- M5 from M1
CREATE MATERIALIZED VIEW candles_m5
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS time,
    pair,
    'M5'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume,
    bool_or(is_displacement) AS has_displacement,
    max(displacement_score) AS max_displacement_score
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('5 minutes', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_m5',
    start_offset => INTERVAL '1 hour',
    end_offset => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes');


-- M15 from M1
CREATE MATERIALIZED VIEW candles_m15
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', time) AS time,
    pair,
    'M15'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume,
    bool_or(is_displacement) AS has_displacement,
    max(displacement_score) AS max_displacement_score
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('15 minutes', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_m15',
    start_offset => INTERVAL '2 hours',
    end_offset => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes');


-- M30 from M1
CREATE MATERIALIZED VIEW candles_m30
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('30 minutes', time) AS time,
    pair,
    'M30'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('30 minutes', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_m30',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '30 minutes',
    schedule_interval => INTERVAL '30 minutes');


-- H1 from M1
CREATE MATERIALIZED VIEW candles_h1
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS time,
    pair,
    'H1'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles
WHERE timeframe = 'M1'
GROUP BY time_bucket('1 hour', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_h1',
    start_offset => INTERVAL '6 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');


-- H4 from H1 (cascading aggregate)
CREATE MATERIALIZED VIEW candles_h4
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('4 hours', time) AS time,
    pair,
    'H4'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles_h1
GROUP BY time_bucket('4 hours', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_h4',
    start_offset => INTERVAL '1 day',
    end_offset => INTERVAL '4 hours',
    schedule_interval => INTERVAL '4 hours');


-- D1 from H1 (daily)
CREATE MATERIALIZED VIEW candles_d1
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS time,
    pair,
    'D'::VARCHAR(5) AS timeframe,
    first(open, time) AS open,
    max(high) AS high,
    min(low) AS low,
    last(close, time) AS close,
    sum(volume) AS volume
FROM candles_h1
GROUP BY time_bucket('1 day', time), pair
WITH NO DATA;

SELECT add_continuous_aggregate_policy('candles_d1',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day');


-- ═══════════════════════════════════════════════════════════════
-- UNIFIED VIEW FOR QUERYING ANY TIMEFRAME
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW candles_all AS
SELECT time, pair, timeframe, open, high, low, close, volume FROM candles WHERE timeframe = 'M1'
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_m5
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_m15
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_m30
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_h1
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_h4
UNION ALL SELECT time, pair, timeframe, open, high, low, close, volume FROM candles_d1;


-- Updated get_candles function to use the unified view
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
    SELECT c.time, c.open, c.high, c.low, c.close, c.volume::INTEGER
    FROM candles_all c
    WHERE c.pair = p_pair
    AND c.timeframe = p_timeframe
    AND c.time BETWEEN p_start AND p_end
    ORDER BY c.time ASC;
END;
$$ LANGUAGE plpgsql;
```

---

## 3. Metadata Columns for Version Tracking

### Add to Timescale Tables

```sql
-- news_events table additions
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS raw_source VARCHAR(20) DEFAULT 'jblanked';
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE news_events ADD COLUMN IF NOT EXISTS data_version INTEGER DEFAULT 1;

-- event_price_reactions table additions  
ALTER TABLE event_price_reactions ADD COLUMN IF NOT EXISTS calculation_version INTEGER DEFAULT 1;
ALTER TABLE event_price_reactions ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ DEFAULT NOW();
```

### Why Version Tracking Matters
- If you recalculate price reactions with different logic, increment `calculation_version`
- If you re-fetch events from a different source, track with `raw_source`
- Allows auditing and rollback if calculations are wrong

---

## 4. Boundary Deduplication for Cross-DB Queries

### The Problem
When querying candles that span both databases:
- Jan 1 to Feb 15 (45 days)
- Days 1-15 older than 30 days → ClickHouse
- Days 16-45 recent → Timescale
- Potential overlap at the boundary

### Solution: Dedupe and Sort

```typescript
// lib/db/candles.ts

export async function getCandles(
    pair: string,
    timeframe: string,
    start: Date,
    end: Date = new Date()
): Promise<Candle[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    // Case 1: All recent data
    if (start > thirtyDaysAgo) {
        const { data } = await supabase.rpc('get_candles', {
            p_pair: pair,
            p_timeframe: timeframe,
            p_start: start.toISOString(),
            p_end: end.toISOString()
        });
        return data;
    }
    
    // Case 2: All historical data
    if (end < thirtyDaysAgo) {
        const result = await clickhouse.query({
            query: `
                SELECT * FROM candles
                WHERE pair = {pair:String}
                AND timeframe = {timeframe:String}
                AND time BETWEEN {start:DateTime64} AND {end:DateTime64}
                ORDER BY time
            `,
            query_params: { pair, timeframe, start: start.toISOString(), end: end.toISOString() },
            format: 'JSONEachRow'
        });
        return await result.json();
    }
    
    // Case 3: Spans both databases - query both and merge
    const [historicalResult, recentResult] = await Promise.all([
        clickhouse.query({
            query: `
                SELECT * FROM candles 
                WHERE pair = {pair:String} 
                AND timeframe = {timeframe:String} 
                AND time >= {start:DateTime64}
                AND time < {cutoff:DateTime64}
                ORDER BY time
            `,
            query_params: { 
                pair, 
                timeframe, 
                start: start.toISOString(), 
                cutoff: thirtyDaysAgo.toISOString() 
            },
            format: 'JSONEachRow'
        }),
        supabase.rpc('get_candles', {
            p_pair: pair,
            p_timeframe: timeframe,
            p_start: thirtyDaysAgo.toISOString(),
            p_end: end.toISOString()
        })
    ]);
    
    const historical = await historicalResult.json();
    const recent = recentResult.data || [];
    
    // Merge, dedupe by timestamp, sort
    const merged = [...historical, ...recent];
    const deduped = dedupeByTime(merged);
    return deduped.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function dedupeByTime(candles: Candle[]): Candle[] {
    const seen = new Map<string, Candle>();
    for (const candle of candles) {
        const key = `${candle.pair}-${candle.timeframe}-${candle.time}`;
        if (!seen.has(key)) {
            seen.set(key, candle);
        }
    }
    return Array.from(seen.values());
}
```

---

## 5. OANDA Streaming Worker (Railway)

### Architecture

```
┌─────────────────────────────────────────┐
│            Railway Worker               │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │     OANDA Stream Handler        │   │
│  │                                 │   │
│  │  • Connect to OANDA streaming   │   │
│  │  • Receive price ticks          │   │
│  │  • Aggregate into M1 candles    │   │
│  │  • Handle reconnection          │   │
│  │  • Heartbeat monitoring         │   │
│  └──────────────┬──────────────────┘   │
│                 │                       │
│                 │ Write M1 candles      │
│                 ▼                       │
│  ┌─────────────────────────────────┐   │
│  │     Supabase Client             │   │
│  │     (writes to Timescale)       │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
          │
          │ Timescale handles:
          │ • M1 → M5 → M15 → H1 → H4 → D1
          │ • Via continuous aggregates
          ▼
┌─────────────────────────────────────────┐
│         Supabase (Timescale)            │
└─────────────────────────────────────────┘
```

### Worker Code

```typescript
// worker/src/index.ts

import { createClient } from '@supabase/supabase-js';

const OANDA_API_KEY = process.env.OANDA_API_KEY!;
const OANDA_ACCOUNT_ID = process.env.OANDA_ACCOUNT_ID!;
const OANDA_STREAM_URL = process.env.OANDA_STREAM_URL || 'https://stream-fxpractice.oanda.com';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!  // Use service key for writes
);

const PAIRS = ['EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF', 'AUD_USD', 'USD_CAD', 'NZD_USD'];

// Track current candle being built for each pair
const currentCandles: Map<string, {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    minuteStart: Date;
}> = new Map();

async function streamPrices() {
    const instruments = PAIRS.join(',');
    
    console.log(`Connecting to OANDA stream for: ${instruments}`);
    
    const response = await fetch(
        `${OANDA_STREAM_URL}/v3/accounts/${OANDA_ACCOUNT_ID}/pricing/stream?instruments=${instruments}`,
        {
            headers: {
                'Authorization': `Bearer ${OANDA_API_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );

    if (!response.ok) {
        throw new Error(`OANDA stream error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    console.log('Stream connected, processing ticks...');

    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            console.log('Stream ended');
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // Keep incomplete line in buffer

        for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
                const data = JSON.parse(line);
                
                if (data.type === 'PRICE') {
                    await processTick(data);
                } else if (data.type === 'HEARTBEAT') {
                    // OANDA sends heartbeats every 5 seconds
                    // Could log or track for monitoring
                }
            } catch (e) {
                console.error('Error parsing tick:', e, line);
            }
        }
    }
}

async function processTick(tick: {
    instrument: string;
    time: string;
    bids: Array<{ price: string }>;
    asks: Array<{ price: string }>;
}) {
    const pair = tick.instrument;
    const tickTime = new Date(tick.time);
    const midPrice = (parseFloat(tick.bids[0].price) + parseFloat(tick.asks[0].price)) / 2;
    
    // Get the start of the current minute
    const minuteStart = new Date(tickTime);
    minuteStart.setSeconds(0, 0);
    
    const key = pair;
    const current = currentCandles.get(key);
    
    // Check if we need to close the current candle and start a new one
    if (current && current.minuteStart.getTime() !== minuteStart.getTime()) {
        // Save completed candle
        await saveCandle(pair, current);
        currentCandles.delete(key);
    }
    
    // Update or create candle
    if (!currentCandles.has(key)) {
        currentCandles.set(key, {
            open: midPrice,
            high: midPrice,
            low: midPrice,
            close: midPrice,
            volume: 1,
            minuteStart
        });
    } else {
        const candle = currentCandles.get(key)!;
        candle.high = Math.max(candle.high, midPrice);
        candle.low = Math.min(candle.low, midPrice);
        candle.close = midPrice;
        candle.volume += 1;
    }
}

async function saveCandle(pair: string, candle: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    minuteStart: Date;
}) {
    const { error } = await supabase
        .from('candles')
        .upsert({
            time: candle.minuteStart.toISOString(),
            pair,
            timeframe: 'M1',
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            complete: true
        }, {
            onConflict: 'time,pair,timeframe'
        });

    if (error) {
        console.error(`Error saving candle for ${pair}:`, error);
    } else {
        console.log(`Saved M1 candle: ${pair} @ ${candle.minuteStart.toISOString()} O:${candle.open.toFixed(5)} H:${candle.high.toFixed(5)} L:${candle.low.toFixed(5)} C:${candle.close.toFixed(5)}`);
    }
}

// Main loop with reconnection
async function main() {
    console.log('OANDA Streaming Worker starting...');
    
    while (true) {
        try {
            await streamPrices();
        } catch (error) {
            console.error('Stream error:', error);
            console.log('Reconnecting in 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

main();
```

### Railway Deployment

```bash
# railway.json
{
    "build": {
        "builder": "nixpacks"
    },
    "deploy": {
        "restartPolicyType": "always"
    }
}

# package.json (worker)
{
    "name": "oanda-stream-worker",
    "scripts": {
        "start": "tsx src/index.ts"
    },
    "dependencies": {
        "@supabase/supabase-js": "^2.x",
        "tsx": "^4.x"
    }
}
```

### Environment Variables (Railway)

```
OANDA_API_KEY=your_api_key
OANDA_ACCOUNT_ID=your_account_id
OANDA_STREAM_URL=https://stream-fxpractice.oanda.com
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
```

### Cost

- Railway free tier: 500 hours/month (enough for testing)
- Railway Hobby: $5/month (always-on, production)

---

## 6. Updated Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          DATA SOURCES                                │
└──────────────────────────────────────────────────────────────────────┘
         │                              │                    │
         │                              │                    │
    OANDA Stream                   JBlanked API         Historical
    (Live prices)                  (News events)        (Backfill)
         │                              │                    │
         ▼                              │                    │
┌─────────────────┐                     │                    │
│ Railway Worker  │                     │                    │
│  (24/5 stream)  │                     │                    │
│                 │                     │                    │
│ Aggregates to   │                     │                    │
│ M1 candles      │                     │                    │
└────────┬────────┘                     │                    │
         │                              │                    │
         │ M1 only                      │                    │
         ▼                              ▼                    │
┌──────────────────────────────────────────────────────────┐│
│                    TIMESCALE (Supabase)                  ││
│                                                          ││
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      ││
│  │ M1 Candles  │  │ News Events │  │   Session   │      ││
│  │ (30 days)   │  │   (19k)     │  │   Levels    │      ││
│  └──────┬──────┘  └─────────────┘  └─────────────┘      ││
│         │                                                ││
│         │ Continuous Aggregates (automatic)              ││
│         ▼                                                ││
│  ┌──────────────────────────────────────────────┐       ││
│  │  M5 │ M15 │ M30 │ H1 │ H4 │ D1              │       ││
│  │  (all auto-generated from M1)                │       ││
│  └──────────────────────────────────────────────┘       ││
│                                                          ││
│  + Price Reactions, FVGs, Sweeps                        ││
└───────────────────────────┬──────────────────────────────┘│
                            │                               │
                            │ Nightly sync                  │
                            │ (30+ day old data)            │
                            ▼                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         CLICKHOUSE                                    │
│                                                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
│  │ Historical      │  │ Event Windows   │  │ Aggregated      │       │
│  │ Candles         │  │ (M1 around news)│  │ Statistics      │       │
│  │ (2007-present)  │  │ (580k windows)  │  │ (per event type)│       │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
│                                                                       │
│  + Backtest Results, Backtest Trades                                  │
└──────────────────────────────────────────────────────────────────────┘
                            │
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         CONVEX                                        │
│                                                                       │
│  Users │ Trades │ Strategies │ Claude Conversations │ Alerts         │
│                                                                       │
│  (Application state with real-time subscriptions)                     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 7. Migration Phase Updates

### Updated Phase Order

1. **Setup Infrastructure** (Day 1)
   - Create Supabase project, enable TimescaleDB
   - Create ClickHouse Cloud account
   - Set up Railway project for worker

2. **Create Schemas** (Day 1-2)
   - Run Timescale SQL (including continuous aggregates)
   - Run ClickHouse SQL (including event_candle_windows)

3. **Migrate Historical Candles** (Day 2-3)
   - All candles → ClickHouse
   - Recent 30 days also to Timescale (for continuous aggs to work)

4. **Migrate News Data** (Day 3)
   - News events → Timescale
   - Event windows → ClickHouse
   - Price reactions → Timescale

5. **Deploy Worker** (Day 4)
   - Deploy OANDA worker to Railway
   - Verify M1 candles flowing to Timescale
   - Verify continuous aggregates updating

6. **Update Application** (Day 4-5)
   - Update chart component to query Timescale
   - Update historical queries to use ClickHouse
   - Implement query routing

7. **Verify & Cleanup** (Day 5-6)
   - Run verification checklist
   - Delete candles from Convex
   - Monitor bandwidth usage

---

## 8. Cost Summary (Updated)

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| Convex | Free tier | $0 |
| Supabase | Pro | $25 |
| ClickHouse Cloud | Free tier (10GB) | $0 |
| Railway | Hobby | $5 |
| **Total** | | **$30/month** |

---

---

## Implementation Status (January 2026)

All items from this v2 update have been implemented:

| Item | Status | Notes |
|------|--------|-------|
| Event windows in ClickHouse | ✅ Complete | 580K+ windows migrated |
| Continuous aggregates | ✅ Complete | M1→M5→M15→H1→H4→D1 |
| Version tracking columns | ✅ Complete | Added to news tables |
| Boundary deduplication | ✅ Complete | In query routing logic |
| OANDA streaming worker | ✅ Complete | Running on Railway |
| T+60/T+90 extraction | ✅ Complete | 80K T+60, 1K T+90 rows |
| T-15 baseline pips | ✅ Complete | All calculations updated |

### Additional Work Completed

- Created `lib/db/clickhouse-news.ts` for historical queries
- Created `/api/news/historical` endpoint (queries ClickHouse)
- Created `/api/news/statistics` endpoint
- Updated `NewsEventPanel.tsx` with T-15 baseline and extended windows
- Added multi-event navigation when events stack at same timestamp
- Created verification script: `scripts/verify-data-architecture.ts`
- Created cleanup script: `scripts/cleanup-timescale-historical.ts`
- Created comprehensive documentation: `docs/data-architecture.md`, `docs/api-reference.md`

---

*Addendum Version: 2.1*
*Created: January 2026*
*Updated: January 2026 (Implementation Complete)*
*Applies to: Main Migration Document v2.0*
