# ADR 003: Data Routing Strategy

**Date**: January 2026
**Status**: Accepted
**Deciders**: Project team

## Context

With three databases (Convex, TimescaleDB, ClickHouse), we needed clear rules for which queries go where. The goal is to optimize for:

1. Response time for real-time chart updates
2. Query performance for historical analytics
3. Consistency for app state

See [ADR-001](001-triple-database-architecture.md) for why we chose three databases.

## Decision Drivers

- **Chart responsiveness**: Users expect <100ms for live updates
- **Analytics performance**: Historical queries can scan millions of rows
- **Data freshness**: Live data must be immediately available
- **Cost efficiency**: Don't query expensive analytics DB for simple lookups

## Decision

Route queries based on **data age** and **query type**:

### Routing Rules

| Data Type | Age/Scope | Database | Reason |
|-----------|-----------|----------|--------|
| Candles | Last 30 days | TimescaleDB | Hot data, time-series optimized |
| Candles | Older than 30 days | ClickHouse | Cold analytics, columnar storage |
| News events | Upcoming + recent | TimescaleDB | Chart markers need fast access |
| News events | Historical analysis | ClickHouse | Aggregations across years |
| Event reactions | All | ClickHouse | Analytics only |
| Event statistics | All | ClickHouse | Pre-computed aggregates |
| User state | All | Convex | Real-time sync, auth |
| Trades/Journal | All | Convex | Real-time updates |

### API Endpoint Mapping

| Endpoint | Primary DB | Fallback | Use Case |
|----------|------------|----------|----------|
| `/api/candles` | TimescaleDB | ClickHouse | Chart data (routes by date) |
| `/api/prices` | OANDA | — | Live streaming prices |
| `/api/news/events` | TimescaleDB | — | Chart markers |
| `/api/news/historical` | ClickHouse | — | Past event reactions |
| `/api/news/statistics` | ClickHouse | — | Aggregated stats |
| `/api/news/definitions` | JSON files | — | Static event knowledge |

### Candle Query Routing Logic

```typescript
// Simplified routing logic
function routeCandleQuery(startTime: Date, endTime: Date) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (startTime >= thirtyDaysAgo) {
    // All data is recent - use TimescaleDB
    return queryTimescale(startTime, endTime);
  } else if (endTime < thirtyDaysAgo) {
    // All data is historical - use ClickHouse
    return queryClickHouse(startTime, endTime);
  } else {
    // Split query: historical from ClickHouse, recent from TimescaleDB
    const historical = queryClickHouse(startTime, thirtyDaysAgo);
    const recent = queryTimescale(thirtyDaysAgo, endTime);
    return mergeCandles(historical, recent);
  }
}
```

### News Event Routing

| Query Type | Database | Example |
|------------|----------|---------|
| Events in visible chart range | TimescaleDB | "Show NFP markers for this week" |
| Historical reactions for event type | ClickHouse | "How did EUR/USD react to past NFPs?" |
| Statistics for event type | ClickHouse | "Average spike for CPI releases" |

## Consequences

**Positive:**
- Fast chart updates (<100ms for visible range)
- Efficient analytics (ClickHouse handles 600K+ reactions easily)
- Clear separation of concerns
- Cost-effective (TimescaleDB for hot, ClickHouse for cold)

**Negative:**
- Must maintain routing logic
- Edge cases at 30-day boundary
- Need to sync data between databases

**Mitigations:**
- Worker handles TimescaleDB → ClickHouse sync daily
- Candle cache on frontend reduces API calls
- Event reactions pre-computed, not queried live

## Data Flow Diagram

```
User views chart
       │
       ▼
┌─────────────────┐
│  /api/candles   │
└────────┬────────┘
         │
    ┌────┴────┐
    │ Router  │
    └────┬────┘
         │
    ┌────┴────────────────┐
    │                     │
    ▼                     ▼
┌─────────┐         ┌───────────┐
│Timescale│         │ClickHouse │
│(< 30d)  │         │(> 30d)    │
└─────────┘         └───────────┘
         │                     │
         └──────────┬──────────┘
                    │
                    ▼
            ┌───────────────┐
            │ Merged Result │
            └───────────────┘
```

---

*Recorded: January 2026*
