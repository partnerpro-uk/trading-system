# Documentation Index

> AI-Augmented Forex Trading System

---

## Quick Links

| Document | Purpose |
|----------|---------|
| [User Stories](plans/user-stories.md) | Who uses what, why, and current status |
| [Vision](trading-system-vision.md) | Core idea and why this matters |
| [Technical Overview](trading-system-technical.md) | Architecture and implementation details |
| [Database Architecture](trading-system-database-migration.md) | Triple database design |

---

## Documentation Structure

```
docs/
├── README.md                          # This file - documentation index
├── plans/
│   └── user-stories.md               # User stories with acceptance criteria
├── trading-system-vision.md          # Product vision and goals
├── trading-system-technical.md       # Technical architecture
├── trading-system-database-migration.md  # Database design and migration
├── trading-system-migration-v2-updates.md # Migration updates
├── data-architecture.md              # Query routing and data flow
├── api-reference.md                  # API endpoints
├── news-events-vision.md             # News intelligence feature vision
├── pre-migration-audit.md            # Pre-migration analysis
└── features/
    ├── README.md                     # Feature documentation index
    ├── event-definitions-knowledge-base.md
    ├── live-news-intelligence.md
    └── geopolitical-events.md
```

---

## Current System Status

### Data (January 2026)

| Table | Count | Location |
|-------|-------|----------|
| Historical candles | 23M+ rows | ClickHouse |
| News events | 87,783 | ClickHouse |
| Event candle windows | 717,497 | ClickHouse |
| Price reactions | 633,503 | ClickHouse |
| Event statistics | 4,435 | ClickHouse |
| Live candles | 30-day rolling | TimescaleDB |
| App state | Users, trades | Convex |

### Features

| Feature | Status |
|---------|--------|
| Live streaming charts | ✅ Complete |
| Multi-pair support | ✅ Complete |
| Timeframe switching | ✅ Complete |
| Session overlays | ✅ Complete |
| News event markers | ✅ Complete |
| Historical reactions | ✅ Complete |
| Event definitions | ✅ Complete |
| Speaker profiles | ✅ Complete |
| Statistics dashboard | ✅ Complete |
| Claude chat integration | 🔜 Planned |
| Trade logging | 🔜 Planned |
| AI zone drawing | 🔜 Planned |

---

## Key Concepts

### Triple Database Architecture

- **Convex**: Real-time app state (users, trades, strategies, Claude conversations)
- **TimescaleDB**: Hot data (30-day candles, upcoming events, session levels)
- **ClickHouse**: Cold analytics (historical candles, event windows, backtests)

### Event Settlement Windows

| Window | Duration | Events | T+60 | T+90 |
|--------|----------|--------|------|------|
| Standard | 30 min | Low/Medium | No | No |
| High Impact | 75 min | High impact | Yes | No |
| Extended | 105 min | FOMC/ECB | Yes | Yes |

### Pip Calculation

All pip calculations use **T-15 baseline** (price 15 minutes before event).

---

## For Developers

### Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env.local` and fill in credentials
3. Run `npm install`
4. Run `npm run dev`

### Key Files

| File | Purpose |
|------|---------|
| `src/app/chart/[pair]/page.tsx` | Main chart page |
| `src/components/chart/Chart.tsx` | Chart component |
| `src/components/chart/NewsEventPanel.tsx` | News event panel |
| `src/app/api/news/*` | News API endpoints |
| `lib/db/clickhouse-*.ts` | ClickHouse queries |
| `worker/src/` | OANDA streaming worker |

### API Endpoints

| Endpoint | Database | Purpose |
|----------|----------|---------|
| `/api/candles` | ClickHouse + Timescale | Chart data |
| `/api/news/events` | TimescaleDB | Chart markers |
| `/api/news/historical` | ClickHouse | Historical reactions |
| `/api/news/statistics` | ClickHouse | Event statistics |
| `/api/news/definitions` | JSON files | Event knowledge base |
| `/api/prices` | OANDA | Live prices |

---

## Updating Documentation

When adding features:

1. Add user story to [plans/user-stories.md](plans/user-stories.md)
2. Update status in this README
3. Add feature docs to `features/` if complex
4. Update version history in modified docs

---

*Last updated: January 2026*
