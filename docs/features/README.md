# Feature Documentation

This folder contains detailed documentation for major system features.

## Features

| Feature | Count | Description |
| ------- | ----- | ----------- |
| [Event Definitions Knowledge Base](./event-definitions-knowledge-base.md) | 603 | Scheduled economic events (436) and speaker profiles (167) with beat/miss interpretations, stance classifications, and regime change potential. |
| [Geopolitical Events](./geopolitical-events.md) | 13 | Duration-based world events (wars, crises) with phases, per-pair impacts, and timeframe-specific relevance scores. |
| [Live News Intelligence](./live-news-intelligence.md) | Real-time | GDELT-powered news monitoring with Claude-assisted event discovery. Background polling + intelligent scoring + human review workflow. |

## Quick Links

### Event Definitions Knowledge Base

- **Data**: `data/event_definitions/economic_events.json`, `speakers.json`
- **Sync**: `scripts/sync-event-definitions.ts`
- **Database**: `event_definitions`, `speaker_definitions` tables

### Geopolitical Events

- **Data**: `data/event_definitions/geopolitical_events.json`
- **Sync**: `scripts/sync-event-definitions.ts`
- **Database**: `geopolitical_events` table

### Live News Intelligence

- **GDELT Monitor**: `lib/gdelt/monitor.ts`
- **Headlines API**: `lib/db/headlines.ts`
- **Cron**: `/api/cron/gdelt-headlines` (every 6 hours)
- **Database**: `news_headlines`, `geopolitical_news_drafts` tables

## Architecture Overview

```text
                    ┌─────────────────────────────────────┐
                    │         EVENT KNOWLEDGE BASE        │
                    └─────────────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│    SCHEDULED    │       │  GEOPOLITICAL   │       │   LIVE NEWS     │
│     EVENTS      │       │     EVENTS      │       │  INTELLIGENCE   │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ economic_events │       │ geopolitical_   │       │ news_headlines  │
│ speakers.json   │       │ events.json     │       │ GDELT polling   │
│ 436 events      │       │ 13 events       │       │ Drafts workflow │
│ 167 speakers    │       │ Duration-based  │       │ Claude search   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
         │                           │                           │
         └───────────────────────────┼───────────────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────────┐
                    │          CLAUDE ANALYSIS            │
                    │   "What affects GBP/USD today?"     │
                    └─────────────────────────────────────┘
```

## Database Tables

| Table | Purpose | Source |
| ----- | ------- | ------ |
| `event_definitions` | Scheduled economic events | JSON sync |
| `speaker_definitions` | Central bank speakers | JSON sync |
| `geopolitical_events` | Wars, crises, structural shifts | JSON sync |
| `gpr_index` | Geopolitical Risk Index (monthly) | Manual backfill |
| `news_headlines` | Real-time GDELT headlines | Cron job |
| `geopolitical_news_drafts` | Claude-discovered events | Runtime |

---

## Data Architecture Quick Reference

For full details, see [docs/data-architecture.md](../data-architecture.md).

### Triple Database Architecture

| Database | Purpose | Key Data |
| -------- | ------- | -------- |
| **TimescaleDB** | Hot/Live data | Recent candles (30d), upcoming events, sessions |
| **ClickHouse** | Cold/Historical | Historical candles, event reactions, candle windows |
| **Convex** | App state | Users, trades, strategies, conversations |

### Query Routing Rules

| Query Type | Database | Example |
| ---------- | -------- | ------- |
| Chart data (recent) | TimescaleDB | Last 30 days of candles |
| Chart data (historical) | ClickHouse | Candles older than 30 days |
| News markers | TimescaleDB | Events in visible chart range |
| Historical reactions | ClickHouse | Past event price movements |
| Event statistics | ClickHouse | Aggregated patterns by event type |
| Trade logging | Convex | User trade entries |

### Key API Endpoints

| Endpoint | Database | Purpose |
| -------- | -------- | ------- |
| `/api/candles` | Both | Chart OHLCV data |
| `/api/news/events` | TimescaleDB | Chart markers (30-day window) |
| `/api/news/historical` | ClickHouse | Historical event reactions |
| `/api/news/statistics` | ClickHouse | Event type stats |

### Related Documentation

- [Data Architecture](../data-architecture.md) - Full architecture details
- [API Reference](../api-reference.md) - All endpoint documentation
- [Migration Plan](../trading-system-database-migration.md) - Migration history
