# ADR 001: Triple Database Architecture

**Date**: January 2026
**Status**: Accepted
**Deciders**: Essam

## Context

The AI Trading System needs to handle:
- **23M+ historical candles** (2007-present, growing)
- **87K+ news events** with price reaction windows
- **Real-time streaming** from OANDA (24/5)
- **Heavy analytical queries** for backtesting and pattern discovery
- **Application state** for trades, strategies, Claude conversations

Originally, everything was in Convex. This caused **83GB+ bandwidth usage** (76GB reads) from scanning candle documents, which is unsustainable.

## Decision Drivers

1. **Cost**: Convex bandwidth charges on time-series reads
2. **Performance**: Need sub-second queries on millions of rows for backtesting
3. **Real-time**: Need instant updates for live charts and trade logging
4. **Query patterns**: Three distinct patterns that no single database optimizes

## Considered Options

### Option 1: Single Database (Convex only)
- **Pros**: Simple, one SDK, real-time subscriptions
- **Cons**: Bandwidth explosion on time-series, slow analytical queries, expensive at scale

### Option 2: Two Databases (Convex + TimescaleDB)
- **Pros**: Better for time-series, JOINs work
- **Cons**: Still slow for heavy analytics, backtesting would strain Timescale

### Option 3: Three Databases (Convex + TimescaleDB + ClickHouse)
- **Pros**: Each DB optimized for its query pattern, cost-effective, future-proof
- **Cons**: More complexity, three SDKs, data sync needed

## Decision

**We chose Option 3: Triple Database Architecture**

| Database | Purpose | Data |
|----------|---------|------|
| **Convex** | Application state | Users, trades, strategies, Claude conversations |
| **TimescaleDB** | Hot operational data | 30-day candles, upcoming news, session levels |
| **ClickHouse** | Cold analytics | Historical candles, event windows, reactions, statistics |

### Why Each Database

**Convex** (Application Layer)
- Real-time subscriptions for UI updates
- Optimistic updates for trade entry
- File storage for screenshots
- Clerk auth integration
- Low document count (~50k trades over years)

**TimescaleDB via Supabase** (Operational Layer)
- Hypertables with automatic time partitioning
- Continuous aggregates: M1 → M5 → M15 → H1 → H4 → D1
- JOINs between candles, news, sessions
- 30-day rolling window keeps it lean (~500MB)
- Familiar PostgreSQL

**ClickHouse** (Analytics Layer)
- 10-100x faster than Postgres for analytical scans
- Column-oriented: only reads columns needed
- Extreme compression: 23M candles → ~200MB
- Vectorized execution: millions of rows per second
- Perfect for backtesting queries

### Query Routing

```
Recent data (< 30 days)     → TimescaleDB
Historical data (> 30 days) → ClickHouse
Application state           → Convex
Cross-boundary queries      → Both, merged in API
```

### Data Flow

```
OANDA Stream → Railway Worker → TimescaleDB (M1 candles)
                                     ↓
                              Continuous Aggregates (M5, M15, H1, H4, D1)
                                     ↓
                              Nightly Sync (30+ day old) → ClickHouse
```

## Consequences

**Positive**
- Convex bandwidth: 83GB → <5GB (stays on free tier)
- Historical queries: 10-100x faster
- Backtesting: Can scan 10 years in <1 second
- Cost: ~$30/month total (Supabase Pro + Railway)

**Negative**
- Three systems to manage
- Query routing logic needed
- Data sync between Timescale and ClickHouse
- Three SDKs in codebase

**Risks**
- Sync job failure could cause data gaps → Mitigated by idempotent sync with verification
- Query routing bugs → Mitigated by clear time boundaries and tests

## Current Data (January 2026)

| Location | Data | Count |
|----------|------|-------|
| ClickHouse | Historical candles | 23M+ |
| ClickHouse | News events | 87,783 |
| ClickHouse | Event candle windows | 717,497 |
| ClickHouse | Price reactions | 633,503 |
| ClickHouse | Event statistics | 4,435 |
| TimescaleDB | Live candles | 30-day rolling |
| TimescaleDB | Upcoming news | 30-day window |
| Convex | App state | Users, trades |

## API Endpoints by Database

| Endpoint | Database | Purpose |
|----------|----------|---------|
| `/api/candles` | ClickHouse + Timescale | Routes by time range |
| `/api/news/events` | TimescaleDB | Chart markers |
| `/api/news/historical` | ClickHouse | Past event reactions |
| `/api/news/statistics` | ClickHouse | Aggregated stats |
| `/api/news/definitions` | JSON files | Knowledge base |

## Related Documents

- [Database Migration Plan](../trading-system-database-migration.md) - Full schema and migration steps
- [Migration V2 Updates](../trading-system-migration-v2-updates.md) - Implementation details

---

*Recorded: January 2026*
