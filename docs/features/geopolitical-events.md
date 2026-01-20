# Geopolitical Events System

Duration-based world events that affect forex markets, complementing the scheduled economic events and speaker databases.

## Overview

While economic events (CPI, NFP, FOMC) are **point-in-time** releases, geopolitical events are **duration-based** with distinct phases. This system tracks wars, crises, and structural shifts that fundamentally reshape currency dynamics.

## Data Location

```
data/event_definitions/
├── economic_events.json      # 436 scheduled events
├── speakers.json             # 167 central bank speakers
├── geopolitical_events.json  # 13 major geopolitical events
└── README.md
```

## Schema

Each geopolitical event contains:

```json
{
  "event_id": "ukraine_war_2022",
  "event_name": "Russia-Ukraine War",
  "aliases": ["Ukraine Conflict", "Russian Invasion"],
  "category": "geopolitical_conflict",
  "status": "active",

  "dates": {
    "start_date": "2022-02-24",
    "end_date": null,
    "peak_crisis_date": "2022-03-07"
  },

  "rumor_period": {
    "start_date": "2022-01-15",
    "description": "US intelligence warnings, troop buildup",
    "gold_behavior": "Started bid before invasion"
  },

  "phases": [
    {
      "phase_name": "Initial Invasion",
      "start_date": "2022-02-24",
      "end_date": "2022-04-02",
      "market_regime": "crisis",
      "key_dates": [...]
    }
  ],

  "pair_impacts": {
    "EUR_USD": {
      "immediate_reaction": {
        "direction": "sharply_lower",
        "magnitude": "1800 pips",
        "mechanism": "EUR carries war premium"
      },
      "structural_shift": {
        "occurred": true,
        "description": "EUR permanently repriced"
      },
      "relevance_score": {
        "intraday_15m": 5,
        "swing_daily": 9,
        "position_weekly": 10
      }
    }
  }
}
```

## Event Categories

| Category | Examples |
|----------|----------|
| `financial_crisis` | 2008 GFC |
| `sovereign_debt` | Eurozone Crisis 2010-12 |
| `currency_crisis` | China Devaluation 2015 |
| `monetary_policy_shock` | SNB Floor Removal 2015 |
| `political_shock` | Brexit, UK Mini-Budget |
| `trade_conflict` | US-China Trade War |
| `pandemic` | COVID-19 |
| `geopolitical_conflict` | Ukraine War, Israel-Gaza |
| `structural_trend` | De-dollarization |

## Event Status

| Status | Meaning |
|--------|---------|
| `active` | Ongoing, still affecting markets daily |
| `completed` | Ended, markets normalized |
| `structural` | Ended but caused permanent regime change |
| `dormant` | Not currently active but could reignite |

## Relevance Scores

Each event has per-pair, per-timeframe relevance (1-10):

```json
"relevance_score": {
  "intraday_15m": 5,      // Lower for scalping
  "short_term_1h_4h": 7,  // Moderate for day trading
  "swing_daily": 9,       // High for swing trades
  "position_weekly": 10   // Critical for positions
}
```

**Filtering thresholds:**
- 15m charts: Show events with score >= 7
- 1h/4h charts: Show events with score >= 6
- Daily charts: Show events with score >= 5
- Weekly charts: Show events with score >= 3

## Events Documented (13)

| Event | Status | Key Pairs |
|-------|--------|-----------|
| 2008 Global Financial Crisis | completed | All |
| European Debt Crisis 2010-12 | completed | EUR/USD |
| China Devaluation 2015 | completed | AUD/USD |
| SNB Floor Removal 2015 | completed | EUR/CHF |
| Brexit Referendum 2016 | structural | GBP/USD |
| US-China Trade War | dormant | AUD/USD |
| COVID-19 Pandemic | completed | All, XAU/USD |
| Russia-Ukraine War | active | EUR/USD, XAU/USD |
| UK Mini-Budget Crisis 2022 | completed | GBP/USD |
| Israel-Gaza Conflict | active | XAU/USD |
| China-Taiwan Tensions | dormant | AUD/USD, JPY |
| De-dollarization Trend | active | XAU/USD, DXY |
| US Venezuela Intervention 2026 | active | OIL, USD |

## Database Table

```sql
CREATE TABLE geopolitical_events (
    event_id VARCHAR(100) PRIMARY KEY,
    event_name VARCHAR(255) NOT NULL,
    aliases TEXT[] DEFAULT '{}',
    category VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    peak_crisis_date DATE,
    phases JSONB NOT NULL,
    pair_impacts JSONB NOT NULL,
    macro_backdrop JSONB,
    rumor_period JSONB,
    lessons_learned JSONB,
    short_description TEXT,
    detailed_description TEXT,
    trading_notes TEXT,
    global_spillover VARCHAR(20),
    synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Helper Functions

### Get Active Events for a Pair

```sql
SELECT * FROM get_active_geopolitical_events('EUR/USD');
```

### Get Relevant Context by Timeframe

```sql
-- Returns events with relevance >= threshold for timeframe
SELECT * FROM get_geopolitical_context('XAU/USD', 'daily');
```

## Sync Process

Data syncs from JSON to Timescale via GitHub Action:

```yaml
# .github/workflows/sync-event-definitions.yml
on:
  push:
    paths:
      - 'data/event_definitions/**'
```

Manual sync:
```bash
npx tsx scripts/sync-event-definitions.ts
```

## Usage Example

When Claude analyzes a chart:

```
1. User opens Weekly XAU/USD chart

2. Claude queries geopolitical context:
   SELECT * FROM get_geopolitical_context('XAU/USD', 'weekly');

3. Returns:
   - Ukraine War (relevance: 10) - "Safe haven bid, central bank buying"
   - Israel-Gaza (relevance: 8) - "Middle East risk premium"
   - De-dollarization (relevance: 10) - "Structural gold accumulation"

4. Claude incorporates into analysis:
   "Gold at $4700 reflects three active geopolitical tailwinds..."
```

## Adding New Events

1. Edit `data/event_definitions/geopolitical_events.json`
2. Add event following the schema above
3. Update metadata `total_events` count
4. Commit and push (GitHub Action syncs to database)

Or use the drafts system (see [live-news-intelligence.md](./live-news-intelligence.md)).
