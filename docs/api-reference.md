# Trading System API Reference

## Overview

All API routes are located in `src/app/api/`. The application uses Next.js App Router API routes.

## Candle Data

### GET /api/candles

Fetch OHLCV candle data for charting.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pair` | string | Yes | Currency pair (e.g., "EUR_USD") |
| `granularity` | string | Yes | Timeframe (M1, M5, M15, H1, H4, D1) |
| `from` | number | No | Start timestamp (Unix ms) |
| `to` | number | No | End timestamp (Unix ms) |
| `count` | number | No | Number of candles (default: 500) |

**Database**: ClickHouse (historical) + TimescaleDB (recent)

**Response:**
```json
{
  "candles": [
    {
      "time": 1705766400000,
      "open": 1.08765,
      "high": 1.08812,
      "low": 1.08723,
      "close": 1.08790,
      "volume": 1234
    }
  ]
}
```

### GET /api/prices

Get latest prices for multiple pairs (sidebar display).

**Database**: TimescaleDB

**Response:**
```json
{
  "prices": {
    "EUR_USD": { "bid": 1.08765, "ask": 1.08768 },
    "GBP_USD": { "bid": 1.27123, "ask": 1.27128 }
  }
}
```

### GET /api/stream/[pair]

Server-Sent Events stream for real-time prices.

**Database**: OANDA Stream (via Railway worker)

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
```

---

## News Events

### GET /api/news/events

Get news events for chart markers (visible range only).

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `pair` | string | Yes | Currency pair |
| `startTime` | number | Yes | Range start (Unix ms) |
| `endTime` | number | Yes | Range end (Unix ms) |
| `impact` | string | No | Filter: "high", "medium", "all" |
| `includeStats` | boolean | No | Include historical stats |

**Database**: TimescaleDB (recent events)

**Response:**
```json
{
  "events": [
    {
      "eventId": "CPI_m_m_USD_2025-01-15_14:30",
      "eventType": "CPI_MOM",
      "name": "CPI m/m",
      "currency": "USD",
      "timestamp": 1705329000000,
      "impact": "high",
      "actual": "0.3%",
      "forecast": "0.2%",
      "previous": "0.1%",
      "reaction": {
        "spikeDirection": "UP",
        "spikeMagnitudePips": 45.2,
        "didReverse": false
      }
    }
  ]
}
```

### GET /api/news/historical

**NEW (v4)**: Fetch historical events for tooltip display. Now queries ClickHouse.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | string | Yes | Event type (e.g., "CPI_MOM") |
| `pair` | string | Yes | Currency pair |
| `beforeTimestamp` | number | Yes | Get events before this time |
| `limit` | number | No | Events per category (default: 5) |

**Database**: ClickHouse (historical analytics)

**Response:**
```json
{
  "beatHistory": [...],
  "missHistory": [...],
  "rawHistory": [...],
  "hasForecastData": true
}
```

**Each event includes:**
```json
{
  "timestamp": 1705329000000,
  "actualValue": 0.3,
  "forecastValue": 0.2,
  "outcome": "beat",

  "priceAtMinus15m": 1.08500,
  "priceAtEvent": 1.08512,
  "spikeHigh": 1.08567,
  "spikeLow": 1.08498,
  "priceAtPlus15m": 1.08545,
  "priceAtPlus30m": 1.08560,
  "priceAtPlus60m": 1.08572,
  "priceAtPlus90m": 1.08580,

  "pipsFromBaseline": {
    "atEvent": 1.2,
    "at15m": 4.5,
    "at30m": 6.0,
    "at60m": 7.2,
    "at90m": 8.0
  },

  "windowMinutes": 105,
  "spikeMagnitudePips": 6.7,
  "spikeDirection": "UP",
  "didReverse": false
}
```

**Key Changes in v4:**
- All pips calculated from T-15 baseline (not T+0)
- Added `priceAtMinus15m` field
- Added `priceAtPlus60m` and `priceAtPlus90m` for extended windows
- Added `pipsFromBaseline` object with pre-calculated values
- Added `windowMinutes` (30, 75, or 105)

### GET /api/news/statistics

**NEW (v4)**: Get aggregated statistics for an event type.

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | string | Yes | Event type |
| `pair` | string | Yes | Currency pair |

**Database**: ClickHouse

**Response:**
```json
{
  "eventType": "CPI_MOM",
  "pair": "EUR_USD",
  "totalOccurrences": 156,
  "avgSpikePips": 23.4,
  "upCount": 78,
  "downCount": 72,
  "reversalRate": 0.35,
  "upBias": 52.0
}
```

### GET /api/news/upcoming

Get upcoming news events (calendar view).

**Query Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `currency` | string | No | Filter by currency |
| `hoursAhead` | number | No | Hours to look ahead (default: 24) |
| `impact` | string | No | Impact filter |

**Database**: TimescaleDB

---

## Cron Jobs

### POST /api/cron/sync-to-clickhouse

Nightly job to sync recent candles from TimescaleDB to ClickHouse.

**Schedule**: Daily at 4:00 AM UTC

**Database**: Both (reads TimescaleDB, writes ClickHouse)

### POST /api/cron/gdelt-headlines

Fetch and store GDELT news headlines.

**Schedule**: Every 15 minutes

**Database**: TimescaleDB

---

## Database Module Reference

### lib/db/index.ts

```typescript
// Get ClickHouse client singleton
getClickHouseClient(): ClickHouseClient

// Get TimescaleDB pool singleton
getTimescalePool(): Pool

// Cleanup connections
closeAllConnections(): Promise<void>
```

### lib/db/news.ts (TimescaleDB - Recent)

```typescript
// Get events in time range (for chart markers)
getEventsInTimeRange(pair, startTime, endTime, impactFilter?)

// Get events with reactions (chart display)
getEventsWithReactions(pair, startTime, endTime, impactFilter?, includeStats?)

// Get upcoming events (calendar)
getUpcomingEvents(currency?, hoursAhead?, impactFilter?)
```

### lib/db/clickhouse-news.ts (ClickHouse - Historical)

```typescript
// Get historical events with full reaction data
getHistoricalEventsFromClickHouse(eventType, pair, beforeTimestamp, limit?)

// Get event type statistics
getEventTypeStatistics(eventType, pair)

// Transform to display format with T-15 baseline pips
transformToDisplayFormat(events, pair, eventType)

// Calculate pip value for a pair
getPipValue(pair): number
```

---

## Error Handling

All endpoints return standard error format:

```json
{
  "error": "Error message here"
}
```

HTTP Status Codes:
- `200`: Success
- `400`: Bad request (missing/invalid parameters)
- `500`: Server error (database issues, etc.)

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/candles` | 100 req/min |
| `/api/news/*` | 60 req/min |
| `/api/stream/*` | 1 connection per pair |

---

## Changelog

### v4 (January 2025)
- Migrated historical news data to ClickHouse
- Added T-15 baseline pip calculations
- Added T+60 and T+90 settlement prices
- Created `/api/news/statistics` endpoint
- Updated response format for `/api/news/historical`

### v3 (December 2024)
- Added ClickHouse for historical candles
- Created event_candle_windows table

### v2 (May 2024)
- Added TimescaleDB for live candles
- Continuous aggregates for timeframes
