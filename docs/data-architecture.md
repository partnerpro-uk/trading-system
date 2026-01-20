# Trading System Data Architecture

## Overview

The trading system uses a **triple-database architecture** to optimize for different data access patterns:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │
│  │   TimescaleDB   │  │   ClickHouse    │  │     Convex      │        │
│  │   (Hot/Live)    │  │ (Cold/Analytics)│  │   (App State)   │        │
│  │                 │  │                 │  │                 │        │
│  │ • Live candles  │  │ • Historical    │  │ • Users         │        │
│  │ • Upcoming news │  │   candles       │  │ • Trades        │        │
│  │ • Session levels│  │ • Event windows │  │ • Strategies    │        │
│  │ • Headlines     │  │ • News archive  │  │ • Settings      │        │
│  │                 │  │ • Price reactions│  │                 │        │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘        │
│           │                   │                    │                   │
│           └───────────────────┴────────────────────┘                   │
│                               │                                        │
│                      ┌────────┴────────┐                               │
│                      │   Application   │                               │
│                      │   (Next.js)     │                               │
│                      └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Database Responsibilities

### TimescaleDB (Hot Data - Railway)

**Purpose**: Real-time data and upcoming events

| Table | Description | Retention |
|-------|-------------|-----------|
| `candles` | M1 candles + continuous aggregates (M5, M15, H1, H4, D1) | 30 days |
| `news_events` | Upcoming news events (for chart display) | 30 days |
| `session_levels` | Recent session highs/lows | 7 days |
| `news_headlines` | GDELT real-time headlines | 7 days |

**Reference Data (persistent)**:
| Table | Description |
|-------|-------------|
| `event_definitions` | 436 economic event definitions (synced from JSON) |
| `speaker_definitions` | 167 speaker profiles (synced from JSON) |
| `geopolitical_events` | World events (synced from JSON) |
| `gpr_index` | Geopolitical Risk Index (monthly) |

### ClickHouse (Cold Data - Aiven)

**Purpose**: Historical analytics and aggregations

| Table | Description | Volume |
|-------|-------------|--------|
| `candles` | Historical M1 candles (2007-present) | 23M rows |
| `event_candle_windows` | M1 arrays per event (T-15 to T+90) | 580K rows |
| `news_events` | Historical news events (>30 days old) | 92K rows |
| `event_price_reactions` | Price reactions with settlements | 580K rows |
| `event_type_statistics` | Aggregated stats per event type | Computed |

### Convex (Application State)

**Purpose**: User-facing application data

| Table | Description |
|-------|-------------|
| `users` | User profiles, auth, preferences |
| `trades` | Logged trading history |
| `strategies` | User trading strategies |
| `conversations` | Claude AI conversations |

## Data Flow

### 1. Live Price Data

```
OANDA Stream → Railway Worker → TimescaleDB candles → Chart
```

### 2. News Events

```
ForexFactory Scraper → TimescaleDB (upcoming)
                     ↓ (after 30 days)
              ClickHouse (archive)
```

### 3. Historical Analysis

```
User clicks event marker
        ↓
/api/news/historical
        ↓
ClickHouse event_price_reactions
        ↓
UI displays T-15 to T+90 settlements
```

### 4. Candle Backfill

```
OANDA Historical API → ClickHouse candles
         ↓ (nightly sync)
    TimescaleDB (recent 30 days)
```

## Query Routing Rules

| Query Type | Database | Example |
|------------|----------|---------|
| Live candles for chart | TimescaleDB | Chart view M1-D1 |
| Historical candles (>30d) | ClickHouse | Backtest data |
| Upcoming news events | TimescaleDB | Calendar, markers |
| Historical event analysis | ClickHouse | `/api/news/historical` |
| Event statistics | ClickHouse | `/api/news/statistics` |
| User trades/settings | Convex | Profile, trade log |

## Event Window Structure

### Window Types

| Type | Duration | Use Case |
|------|----------|----------|
| Standard | 30 min (T-15 to T+15) | Low/medium impact |
| High Impact | 75 min (T-15 to T+60) | High impact events |
| Extended | 105 min (T-15 to T+90) | FOMC, ECB decisions |

### Time Index Reference

For event_candle_windows arrays (1-indexed):

| Time | Index | Notes |
|------|-------|-------|
| T-15 | 1 | Baseline price |
| T-10 | 6 | |
| T-5 | 11 | |
| T+0 | 16 | Event release |
| T+5 | 21 | |
| T+15 | 31 | |
| T+30 | 46 | |
| T+59 | 75 | Last in 75-min window |
| T+89 | 105 | Last in 105-min window |

### Pip Calculations

**Important**: All settlement pips are calculated from T-15 baseline (not T+0):

```
pipsAt15m = (priceAtPlus15m - priceAtMinus15m) / pipValue
```

This gives a more accurate picture of total price movement around the event.

## Cron Jobs and Workers

| Job | Schedule | Database | Purpose |
|-----|----------|----------|---------|
| `sync-to-clickhouse` | Daily 4am | Both | Move candles to ClickHouse |
| `gdelt-headlines` | Every 15min | TimescaleDB | Fetch news headlines |
| `railway-candle-worker` | Continuous | TimescaleDB | Stream live candles |

## Environment Variables

```bash
# TimescaleDB (Railway)
TIMESCALE_URL=postgres://...

# ClickHouse (Aiven)
CLICKHOUSE_HOST=https://...
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=...

# Convex
NEXT_PUBLIC_CONVEX_URL=https://...
```

## File Locations

| Module | Path | Purpose |
|--------|------|---------|
| DB Clients | `lib/db/index.ts` | Connection singletons |
| TimescaleDB News | `lib/db/news.ts` | Recent news queries |
| ClickHouse News | `lib/db/clickhouse-news.ts` | Historical analytics |
| Candle Queries | `lib/db/candles.ts` | Price data |

## Migration History

1. **v1**: Convex-only architecture
2. **v2**: Added TimescaleDB for candles (May 2024)
3. **v3**: Added ClickHouse for historical analytics (Dec 2024)
4. **v4**: Migrated news_events and reactions to ClickHouse (Jan 2025)

## Verification Checklist

After any migration:

- [ ] TimescaleDB `news_events` has only upcoming 30 days
- [ ] ClickHouse `news_events` has historical archive
- [ ] ClickHouse `event_price_reactions` has T+60/T+90 populated
- [ ] `/api/news/historical` returns data from ClickHouse
- [ ] UI settlement bars show T-15 baseline calculations
