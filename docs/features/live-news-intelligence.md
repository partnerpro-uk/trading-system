# Live News Intelligence System

Real-time geopolitical news monitoring using GDELT, with Claude-assisted event discovery and human review workflow.

## Overview

A hybrid system that:
1. **Background polling**: Fetches headlines from GDELT every 6 hours
2. **Intelligent scoring**: Filters noise, keeps forex-relevant geopolitical news
3. **Claude discovery**: Claude can search web and draft new events
4. **Human review**: Drafts are staged for approval before merging

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 LIVE NEWS INTELLIGENCE SYSTEM                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. BACKGROUND HEADLINES (Vercel Cron → GDELT → news_headlines) │
│     └─ Runs every 6 hours at 00:00, 06:00, 12:00, 18:00 UTC     │
│     └─ Stores headlines scoring >= 5 importance                  │
│                                                                  │
│  2. CLAUDE SEARCH (On-demand via WebSearch tool)                │
│     └─ Triggered by: price anomaly, user query, scheduled check │
│     └─ Searches web for current events affecting specific pairs │
│                                                                  │
│  3. DRAFTS TABLE (Claude → geopolitical_news_drafts → Human)    │
│     └─ Claude discovers event → stages draft → human reviews    │
│     └─ Approved drafts → merged to geopolitical_events.json     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
lib/
├── gdelt/
│   ├── index.ts              # Module exports
│   └── monitor.ts            # GDELT API, scoring algorithm
└── db/
    └── headlines.ts          # Query functions for headlines & drafts

src/app/api/cron/
└── gdelt-headlines/
    └── route.ts              # Vercel cron endpoint

vercel.json                   # Cron schedule configuration
```

## GDELT Monitor

### API Endpoint

```
https://api.gdeltproject.org/api/v2/doc/doc?
  query=(war OR sanctions OR military OR invasion OR conflict OR crisis OR tariff) sourcelang:eng
  &mode=artlist
  &maxrecords=75
  &format=json
  &sort=datedesc
```

### Importance Scoring Algorithm

Headlines are scored 0-10 based on:

| Factor | Points |
|--------|--------|
| High-value keywords (war, invasion, sanctions, nuclear) | +3 each (max 6) |
| Medium keywords (tariff, conflict, crisis, troops) | +2 each (max 4) |
| Forex-relevant country mentioned | +2 |
| Multiple countries (international event) | +1 |

**Threshold**: Only headlines scoring >= 5 are stored.

### Country to Currency Mapping

```typescript
const FOREX_COUNTRIES = {
  "United States": ["USD"],
  "China": ["CNH", "AUD"],
  "Russia": ["EUR", "XAU"],
  "Ukraine": ["EUR", "XAU"],
  "Israel": ["XAU"],
  "Iran": ["XAU", "OIL"],
  "Venezuela": ["OIL", "USD"],
  "United Kingdom": ["GBP"],
  // ... more mappings
};
```

## Database Tables

### news_headlines

Stores GDELT headlines for Claude to query:

```sql
CREATE TABLE news_headlines (
    id UUID PRIMARY KEY,
    source VARCHAR(50),           -- 'gdelt'
    headline TEXT NOT NULL,
    url TEXT,
    published_at TIMESTAMPTZ,
    countries TEXT[],             -- ['US', 'Iran']
    themes TEXT[],                -- ['military', 'sanctions']
    currencies TEXT[],            -- ['USD', 'XAU', 'OIL']
    importance_score INTEGER,     -- 1-10
    goldstein_scale DECIMAL,      -- GDELT conflict scale
    fetched_at TIMESTAMPTZ,
    UNIQUE(source, url)
);
```

### geopolitical_news_drafts

Staging table for Claude-discovered events:

```sql
CREATE TABLE geopolitical_news_drafts (
    id UUID PRIMARY KEY,
    discovered_at TIMESTAMPTZ,
    discovery_trigger VARCHAR,    -- 'price_anomaly', 'user_query'
    trigger_pair VARCHAR,         -- 'XAU_USD'
    trigger_description TEXT,     -- "Gold spiked $50 with no news"
    headline TEXT NOT NULL,
    source_url TEXT,
    event_date DATE,
    affected_pairs TEXT[],
    estimated_impact VARCHAR,     -- 'high', 'medium', 'low'
    category VARCHAR,             -- 'geopolitical_conflict'
    claude_summary TEXT,
    status VARCHAR DEFAULT 'pending',
    reviewed_at TIMESTAMPTZ,
    merged_to_event_id VARCHAR,
    search_results JSONB
);
```

## Vercel Cron Configuration

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/gdelt-headlines",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

Runs at: 00:00, 06:00, 12:00, 18:00 UTC

## Query Functions

### Get Recent Headlines

```typescript
import { getRecentHeadlines } from '@/lib/db/headlines';

// Get all high-importance headlines from last 24 hours
const headlines = await getRecentHeadlines({ hours: 24 });

// Get headlines affecting specific currency
const goldNews = await getRecentHeadlines({
  currency: 'XAU',
  hours: 48,
  minImportance: 7
});
```

### Get Headlines for a Pair

```typescript
import { getHeadlinesForPair } from '@/lib/db/headlines';

// Get headlines affecting EUR or USD
const news = await getHeadlinesForPair('EUR_USD', 48);
```

### Search Headlines

```typescript
import { searchHeadlines } from '@/lib/db/headlines';

const results = await searchHeadlines('sanctions', { hours: 72 });
```

### Create Event Draft

```typescript
import { createEventDraft } from '@/lib/db/headlines';

const draftId = await createEventDraft({
  headline: 'US Imposes New Iran Sanctions',
  sourceUrl: 'https://...',
  eventDate: new Date(),
  affectedPairs: ['XAU_USD', 'OIL'],
  estimatedImpact: 'high',
  category: 'sanctions',
  claudeSummary: 'New sanctions target Iranian oil exports...',
  discoveryTrigger: 'price_anomaly',
  triggerPair: 'XAU_USD',
  triggerDescription: 'Gold spiked $30 at 14:00 UTC'
});
```

### Review Drafts

```typescript
import { getPendingDrafts, updateDraftStatus } from '@/lib/db/headlines';

// Get all pending drafts
const drafts = await getPendingDrafts();

// Approve a draft
await updateDraftStatus(draftId, 'approved');

// Merge into existing event
await updateDraftStatus(draftId, 'merged', 'ukraine_war_2022');
```

## Workflow Example

**Scenario: User asks "Why did gold spike today?"**

```
1. Claude checks news_headlines:
   → SELECT * FROM get_recent_headlines('XAU', 24);
   → Returns: "US military strikes Iranian facility" (importance: 9)

2. If nothing explains it, Claude uses WebSearch:
   → Searches: "gold price spike January 2026"
   → Finds breaking news not yet in GDELT

3. Claude creates a draft:
   → createEventDraft({
       headline: 'US-Iran Military Escalation',
       affectedPairs: ['XAU_USD', 'OIL'],
       estimatedImpact: 'high',
       claudeSummary: 'US conducted strikes on Iranian...'
     })

4. Human reviews pending drafts:
   → If significant: merges to geopolitical_events.json
   → If minor: approves as standalone or rejects
```

## Manual Testing

### Trigger GDELT Fetch Locally

```bash
# Direct function call
npx tsx -e "
  import { fetchGDELTHeadlines } from './lib/gdelt/monitor';
  fetchGDELTHeadlines().then(console.log);
"
```

### Trigger Cron Endpoint

```bash
# Local development
curl http://localhost:3000/api/cron/gdelt-headlines

# Production (with secret)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/gdelt-headlines
```

### Verify Database

```sql
-- Check headline counts
SELECT COUNT(*), source FROM news_headlines GROUP BY source;

-- Recent high-importance headlines
SELECT headline, importance_score, published_at
FROM news_headlines
WHERE importance_score >= 7
ORDER BY published_at DESC
LIMIT 10;

-- Pending drafts
SELECT headline, category, estimated_impact, discovered_at
FROM geopolitical_news_drafts
WHERE status = 'pending';
```

## Environment Variables

```env
# Required for Timescale connection
TIMESCALE_URL=postgresql://...

# Required for Vercel cron authentication
CRON_SECRET=your-secret-here
```

## Data Flow

```
GDELT API
    ↓
fetchGDELTHeadlines()
    ↓
Score & Filter (importance >= 5)
    ↓
news_headlines table
    ↓
Claude queries via getRecentHeadlines()
    ↓
If new event discovered → createEventDraft()
    ↓
geopolitical_news_drafts table
    ↓
Human review → Approve/Reject/Merge
    ↓
geopolitical_events.json (if merged)
```

## Related Documentation

- [Geopolitical Events System](./geopolitical-events.md) - Static event database
- [Event Definitions README](../../data/event_definitions/README.md) - Schema details
