# Event Definitions Knowledge Base

A curated database of 603 forex market-moving events and speakers that gives Claude rich context for understanding price reactions.

## Overview

| Dataset | Count | Purpose |
|---------|-------|---------|
| Economic Events | 436 | Scheduled data releases (CPI, NFP, FOMC, etc.) |
| Speaker Profiles | 167 | Central bank officials with stance & credibility |
| **Total** | **603** | Complete forex event intelligence |

## The Problem This Solves

When a news event occurs (e.g., "US CPI comes in hot"), Claude needs to understand:

1. **What does this event measure?** (inflation, employment, growth)
2. **How does a beat/miss typically affect markets?** (USD up, bonds down)
3. **Is this speaker hawkish or dovish?** (affects interpretation)
4. **Could this cause structural repricing?** (regime change potential)
5. **What related events should we watch?** (NFP pairs with unemployment rate)

This database provides that context in a structured, queryable format.

## Data Location

```
data/event_definitions/
├── economic_events.json     # 436 scheduled events
├── speakers.json            # 167 central bank speakers
├── geopolitical_events.json # 13 duration-based events (separate feature)
└── README.md                # Full schema documentation
```

## Economic Events (436)

### Coverage by Country

| Country | Events | Key Releases |
|---------|--------|--------------|
| US | 89 | NFP, CPI, FOMC, GDP, PCE |
| UK | 72 | BOE, CPI, GDP, Employment |
| Eurozone | 68 | ECB, HICP, PMIs, GDP |
| Canada | 52 | BOC, CPI, Employment, GDP |
| Australia | 48 | RBA, CPI, Employment |
| Japan | 36 | BOJ, CPI, Tankan |
| New Zealand | 28 | RBNZ, CPI, GDP |
| Switzerland | 24 | SNB, CPI, KOF |
| China | 19 | PMIs, Trade, GDP |

### Coverage by Category

| Category | Count | Examples |
|----------|-------|----------|
| inflation | 52 | CPI, PPI, PCE, Import Prices |
| employment | 48 | NFP, Unemployment, Jobless Claims |
| pmi | 44 | Manufacturing PMI, Services PMI |
| gdp | 36 | GDP Advance, Prelim, Final |
| central_bank_decision | 32 | FOMC, BOE, ECB, BOJ decisions |
| consumer | 28 | Retail Sales, Consumer Confidence |
| housing | 24 | Building Permits, Home Sales |
| trade | 20 | Trade Balance, Current Account |
| manufacturing | 16 | Factory Orders, Industrial Production |
| central_bank_minutes | 12 | FOMC Minutes, BOE Minutes |

### Schema Highlights

```json
{
  "event_name": "Non-Farm Employment Change",
  "aliases": ["Non-Farm Payrolls", "NFP"],
  "category": "employment",

  "beat_interpretation": {
    "direction": "bullish",
    "currency_impact": "USD strengthens",
    "equity_impact": "Mixed - growth vs rate expectations",
    "bond_impact": "Yields rise"
  },

  "miss_interpretation": {
    "direction": "bearish",
    "currency_impact": "USD weakens",
    "equity_impact": "Mixed - growth concerns vs rate relief",
    "bond_impact": "Yields fall"
  },

  "regime_change_potential": "high",
  "regime_change_examples": "March 2020 COVID NFP (-701K), post-pandemic recovery prints",

  "related_events": ["ADP Employment Change", "Unemployment Rate", "Average Hourly Earnings"],
  "trading_notes": "Released simultaneously with Unemployment Rate. Watch revision to prior month."
}
```

## Speaker Profiles (167)

### Coverage by Institution

| Institution | Speakers | Notes |
|-------------|----------|-------|
| Federal Reserve | 57 | Chair, Governors, Regional Presidents |
| Bank of England | 34 | Governor, Deputies, MPC Members |
| Bank of Canada | 22 | Governor, Deputy Governors |
| RBA/RBNZ | 19 | Australian & NZ central bankers |
| ECB/SNB/Bundesbank | 18 | European central bankers |
| Bank of Japan | 3 | Governor, Deputies |
| Political Leaders | 14 | US Presidents, UK PMs, Treasury |

### Stance Classifications

| Stance | Meaning | Example |
|--------|---------|---------|
| very hawkish | Strongly prioritizes inflation | Bullard (historical) |
| hawkish | Favors tighter policy | Waller, Mester |
| pragmatic | Data-dependent, shifts with conditions | Powell |
| dovish | Favors accommodation | Brainard (historical) |
| very dovish | Strongly prioritizes employment | Kashkari (2020) |

### Schema Highlights

```json
{
  "event_name": "Fed Chair Powell Speaks",
  "category": "central_bank_speech",

  "speaker": {
    "full_name": "Jerome H. Powell",
    "institution": "Federal Reserve",
    "role": "Chair",
    "tenure_start": "2018-02-05",
    "tenure_end": "2026-05-15",
    "voting_member": true,
    "stance": "pragmatic",
    "stance_description": "Data-dependent centrist who has shown willingness to pivot"
  },

  "typical_impact": "very high",
  "regime_change_potential": "very high",
  "regime_change_examples": "Jackson Hole 2022 hawkish pivot, Nov 2023 dovish pivot",

  "what_to_watch": "Changes to forward guidance language, hints at pace of cuts/hikes"
}
```

## Database Tables

### event_definitions

```sql
CREATE TABLE event_definitions (
    event_name VARCHAR(255) PRIMARY KEY,
    aliases TEXT[] DEFAULT '{}',
    category VARCHAR(50),
    short_description TEXT,
    detailed_description TEXT,
    measures TEXT,
    release_frequency VARCHAR(50),
    typical_release_time VARCHAR(100),
    source_authority VARCHAR(255),
    country VARCHAR(10),
    primary_currency VARCHAR(5),
    secondary_currencies TEXT[] DEFAULT '{}',
    typical_impact VARCHAR(20),
    beat_interpretation JSONB,
    miss_interpretation JSONB,
    global_spillover VARCHAR(20),
    spillover_description TEXT,
    revision_tendency TEXT,
    related_events TEXT[] DEFAULT '{}',
    historical_context TEXT,
    trading_notes TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

### speaker_definitions

```sql
CREATE TABLE speaker_definitions (
    event_name VARCHAR(255) PRIMARY KEY,
    category VARCHAR(50),
    speaker JSONB NOT NULL,
    typical_impact VARCHAR(20),
    what_to_watch TEXT,
    market_sensitivity TEXT,
    regime_change_potential VARCHAR(20),
    regime_change_examples TEXT,
    primary_currency VARCHAR(5),
    related_events TEXT[] DEFAULT '{}',
    synced_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Sync Process

### GitHub Action

Changes to JSON files automatically sync to Timescale:

```yaml
# .github/workflows/sync-event-definitions.yml
name: Sync Event Definitions to Timescale

on:
  push:
    branches: [main]
    paths:
      - 'data/event_definitions/**'
      - 'scripts/sync-event-definitions.ts'
  workflow_dispatch: # Manual trigger
```

### Manual Sync

```bash
npx tsx scripts/sync-event-definitions.ts
```

**Output:**
```
Syncing event definitions to Timescale...
✓ Connected to Timescale
✓ Loaded 436 economic events
✓ Loaded 167 speakers
✓ Loaded 13 geopolitical events
✓ Synced 436 economic events
✓ Synced 167 speakers
✓ Synced 13 geopolitical events
Done!
```

## Usage Examples

### Claude Interpreting a News Event

```
User: "US CPI just came in at 3.2% vs 3.0% expected"

Claude queries event_definitions:
→ SELECT * FROM event_definitions WHERE event_name ILIKE '%CPI%' AND country = 'US';

Claude's knowledge:
- beat_interpretation: "USD strengthens, yields rise"
- regime_change_potential: "medium-high"
- related_events: ["Core CPI", "PCE Price Index"]
- trading_notes: "Core more important than headline for Fed"

Claude responds with context about whether this is temporary displacement
or could shift Fed expectations...
```

### Claude Assessing a Speaker

```
User: "Waller is speaking tomorrow, should I be careful?"

Claude queries speaker_definitions:
→ SELECT * FROM speaker_definitions WHERE event_name ILIKE '%Waller%';

Claude's knowledge:
- stance: "hawkish"
- typical_impact: "high"
- voting_member: true
- regime_change_potential: "medium-high"
- what_to_watch: "Views on inflation persistence, pace of cuts"

Claude advises based on Waller's historical tendency to move markets
when deviating from consensus...
```

### Helper Function

```sql
-- Get upcoming news with full context
SELECT * FROM get_upcoming_news_with_definitions(24);

-- Returns event details JOINED with definition context
-- (beat/miss interpretation, impact level, spillover effects)
```

## Key Concepts

### Regime Change vs Temporary Displacement

The database distinguishes between:

**Temporary Displacement**
- Headline surprise causes 50-150 pip spike
- But forward guidance unchanged
- Price reverts within hours/days
- Example: Most monthly CPI prints

**Structural Repricing**
- Fundamental shift in rate expectations
- Price establishes new range
- No reversion expected
- Example: Liz Truss mini-budget (GBP to 1.03)

Fields that help identify regime change potential:
- `regime_change_potential`: low / medium / high / very high
- `regime_change_examples`: Historical cases
- `global_spillover`: How much it affects other markets

### Impact Hierarchy

```
very high  → Major market mover (NFP, FOMC, Fed Chair)
high       → Significant impact (CPI, PMIs, voting members)
medium-high → Notable impact (tier-2 data, non-voting members)
medium     → Moderate impact (most scheduled releases)
low-medium → Minor impact (revisions, regional data)
low        → Minimal direct impact (surveys, minor indicators)
```

## Data Quality

- **436 economic events** manually curated with trading-relevant context
- **167 speaker profiles** with current stance assessments
- Tenure dates verified for current officials
- Historical officials marked with "historical" suffix
- Beat/miss interpretations based on typical market reactions
- Related events mapped for context clustering

## Adding New Events/Speakers

1. Edit the relevant JSON file in `data/event_definitions/`
2. Follow the existing schema
3. Update metadata `total_events` or `total_speakers` count
4. Commit and push (GitHub Action syncs automatically)

Or manually sync:
```bash
npx tsx scripts/sync-event-definitions.ts
```

## Related Documentation

- [Data README](../../data/event_definitions/README.md) - Full schema details
- [Geopolitical Events](./geopolitical-events.md) - Duration-based events
- [Live News Intelligence](./live-news-intelligence.md) - Real-time GDELT feed
