# Trading System — System Design

> Last Updated: 2026-02-06 (v1.0)

## Overview

A real-time forex trading platform with AI-powered chart analysis, institutional data integration, and automated trade journaling. Built on a triple-database architecture that separates hot/live data (TimescaleDB), cold/historical data (ClickHouse), and application state (Convex).

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Frontend | Next.js | 16 | App Router, API routes, SSR |
| UI | React | 19 | Component rendering |
| Styling | Tailwind CSS | 4 | Utility-first CSS |
| Charts | TradingView Lightweight Charts | 5.1 | OHLC candlestick rendering |
| State | Zustand | latest | Client state (drawings, chat) |
| Auth | Clerk | latest | User auth, profile sync |
| AI | Anthropic Claude API | SDK | Chat analysis (Sonnet + Haiku) |
| App Database | Convex | latest | Users, trades, conversations |
| Hot Database | TimescaleDB | latest | Live candles, upcoming events |
| Cold Database | ClickHouse | latest | Historical candles, analytics |
| Worker | Node.js (ESM) | latest | Background data sync |
| Hosting (App) | Vercel | — | Next.js deployment |
| Hosting (Worker) | Railway | — | Long-running process |

## Architecture Diagram

```
                    ┌──────────────────────────────┐
                    │         OANDA API             │
                    │    (Candles + Prices)          │
                    └──────────┬───────────────────┘
                               │
                    ┌──────────▼───────────────────┐
                    │      Worker (Railway)          │
                    │                                │
                    │  • Candle sync (10 pairs)      │
                    │  • SSE price streaming         │
                    │  • News updates (hourly)       │
                    │  • COT data (weekly)           │
                    │  • Gap caretaker               │
                    │  • Event reaction processor    │
                    └──┬───────────┬───────────────┘
                       │           │
          ┌────────────▼──┐  ┌────▼────────────┐
          │  TimescaleDB  │  │   ClickHouse     │
          │  (Hot / 30d)  │  │  (Cold / All)    │
          │               │  │                  │
          │ • Live candles│  │ • Full history   │
          │ • Upcoming    │  │ • Event windows  │
          │   events      │  │ • Price reactions│
          │ • Headlines   │  │ • COT archive    │
          │ • Session lvl │  │ • Strategy trades│
          └───────┬───────┘  └────┬─────────────┘
                  │               │
          ┌───────▼───────────────▼──────────────┐
          │           Next.js App (Vercel)         │
          │                                        │
          │  Pages:                                 │
          │  • / (pair cards + live prices)         │
          │  • /chart/[pair] (trading chart)        │
          │  • /trades (trade journal)              │
          │                                        │
          │  API Routes:                            │
          │  • /api/candles (dual-DB query)         │
          │  • /api/chat (Claude SSE streaming)     │
          │  • /api/news/* (events, headlines)      │
          │  • /api/cot/* (institutional data)      │
          │  • /api/stream/[pair] (live prices)     │
          │  • /api/cron/* (nightly sync)           │
          └───────────┬───────────────────────────┘
                      │
          ┌───────────▼───────────────────────────┐
          │            Convex (Cloud)               │
          │                                        │
          │  • Users (Clerk sync)                   │
          │  • Trades (journal + P&L)               │
          │  • Drawings (chart annotations)         │
          │  • Conversations + ChatMessages         │
          │  • StrategySettings                     │
          │  • UserPreferences                      │
          └────────────────────────────────────────┘
```

## Project Structure

```
trading-system/
├── convex/                    # Convex backend (schema, mutations, queries)
│   ├── schema.ts              # Table definitions
│   ├── trades.ts              # Trade journal CRUD
│   ├── chat.ts                # Conversation management
│   ├── drawings.ts            # Drawing persistence
│   └── users.ts               # Clerk user sync
│
├── worker/                    # Background worker (Railway)
│   └── src/
│       ├── index.ts           # Main: candle sync + SSE server
│       ├── jblanked-news.ts   # Economic calendar updates
│       ├── gap-caretaker.ts   # Data continuity monitor
│       ├── event-reaction-processor.ts
│       ├── cot-data.ts        # CFTC COT data
│       └── historical-backfill/
│
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Home (pair cards)
│   │   ├── chart/[pair]/      # Trading chart page
│   │   ├── trades/            # Trade journal page
│   │   └── api/               # API routes (see below)
│   │
│   ├── components/
│   │   ├── chart/             # Chart, toolbar, sidebar, overlays
│   │   ├── chat/              # Claude chat panel (6 components)
│   │   └── journal/           # Trade journal UI
│   │
│   └── hooks/                 # React hooks (candles, position sync)
│
├── lib/
│   ├── drawings/              # Drawing system
│   │   ├── types.ts           # 11 drawing types + BaseDrawing
│   │   ├── store.ts           # Zustand store + persistence
│   │   └── describe.ts        # Natural language descriptions
│   │
│   ├── chat/                  # Claude chat integration
│   │   ├── types.ts           # Message, tool, SSE types
│   │   ├── store.ts           # Chat Zustand store
│   │   ├── tools.ts           # 22 tool definitions
│   │   └── context.ts         # System prompt + dynamic context
│   │
│   └── db/                    # Database modules
│       ├── index.ts           # Pool management
│       ├── candles.ts         # Candle queries
│       ├── news.ts            # Event queries
│       ├── headlines.ts       # Headline queries
│       ├── cot.ts             # COT queries
│       ├── clickhouse-news.ts # ClickHouse news
│       ├── clickhouse-cot.ts  # ClickHouse COT
│       └── fcr.ts             # First-candle reaction
│
├── strategies/                # Trading strategy definitions
├── scripts/                   # Setup + migration scripts
├── data/                      # Static data files
└── docs/                      # Documentation
```

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/candles` | GET | Fetch candles (dual-DB: Timescale recent + ClickHouse historical) |
| `/api/candles/range` | GET | Fetch candles in time range |
| `/api/chat` | POST | Claude AI chat with SSE streaming |
| `/api/chat/tool-result` | POST | Client tool result callback |
| `/api/news/events` | GET | Economic calendar events |
| `/api/news/upcoming` | GET | Upcoming events (next 24h) |
| `/api/news/historical` | GET | Historical event analytics |
| `/api/news/statistics` | GET | Aggregated event stats |
| `/api/news/definitions` | GET | Event type definitions |
| `/api/cot/latest` | GET | Latest COT positioning |
| `/api/cot/history` | GET | Historical COT data |
| `/api/cot/context` | GET | COT context for chart |
| `/api/prices` | GET | Current price data |
| `/api/stream/[pair]` | GET | Real-time price stream (SSE) |
| `/api/trades` | GET/POST | Trade journal CRUD |
| `/api/drawings` | GET/POST | Drawing persistence |
| `/api/strategies` | GET | Strategy list |
| `/api/strategies/[id]` | GET | Strategy detail |
| `/api/cron/sync-to-clickhouse` | POST | Nightly candle archival |
| `/api/cron/gdelt-headlines` | POST | Headline fetching |

## Data Flow

### Candle Data Pipeline

```
OANDA API ──► Worker (every 5s) ──► TimescaleDB (M1 candles)
                                         │
                                    Continuous Aggregates
                                    (M5, M15, H1, H4, D1)
                                         │
                                    Nightly Cron ──► ClickHouse (archive > 30d)
```

### News & Events Pipeline

```
JBlanked API ──► Worker (hourly) ──► TimescaleDB (upcoming)
                                         │
                                    Event Reaction Processor
                                         │
                                    ClickHouse (analyzed reactions)
```

### COT Data Pipeline

```
CFTC (weekly) ──► Worker ──► TimescaleDB + ClickHouse
```

## Supported Currency Pairs

EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD, NZD/USD, XAU/USD, XAG/USD, SPX500/USD

## Security

- **Authentication**: Clerk (JWT-based, synced to Convex)
- **API Keys**: Environment variables only (OANDA, Anthropic, DB credentials)
- **Database**: SSL connections, sslmode parameter handling
- **Worker**: Authenticated SSE endpoint for price streaming

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-06 | Initial architecture documentation |
