# ADR 004: JBlanked API for Economic Calendar Data

**Date**: January 2026
**Status**: Accepted
**Deciders**: Project team

## Context

The trading system requires economic calendar data (news events like NFP, CPI, FOMC decisions) for chart display and historical analysis. Previously, we used a custom Python Puppeteer scraper to extract data from ForexFactory.

### Problems with ForexFactory Scraper

1. **Unreliable**: Puppeteer-based scraping broke frequently when ForexFactory changed their HTML structure
2. **Slow**: Browser automation is resource-intensive and slow
3. **Rate limited**: ForexFactory aggressively blocks scrapers
4. **Maintenance burden**: Required constant fixes when the site changed
5. **Missing data**: Scraper often failed to capture all events

## Decision Drivers

- **Reliability**: Need consistent data ingestion without manual intervention
- **Data quality**: Accurate timestamps, impact levels, and values
- **Historical depth**: Access to years of past events for backtesting
- **Timezone handling**: Clear timezone semantics (source vs storage)
- **Cost**: Reasonable API pricing for our usage patterns

## Considered Options

### Option 1: Continue with ForexFactory Scraper

**Pros:**
- Free (no API costs)
- Direct access to source data

**Cons:**
- Constant breakage and maintenance
- No SLA or reliability guarantees
- Ethical concerns with scraping

### Option 2: Investing.com API

**Pros:**
- Large dataset
- Multiple data types

**Cons:**
- Expensive enterprise pricing
- Complex integration
- Overkill for our needs

### Option 3: JBlanked API

**Pros:**
- Purpose-built for economic calendar data
- Reliable REST API with clear documentation
- Historical data from 2023-01-01
- Reasonable pricing
- Returns ForexFactory-sourced data via clean API

**Cons:**
- Limited historical depth (2023+)
- Impact field only available from 2024+

## Decision

**Use JBlanked API** (`https://www.jblanked.com/news/api`) as the sole source for economic calendar data.

### Key Implementation Details

#### Timezone Handling

JBlanked returns times in **EET (Europe/Helsinki)** = UTC+2 winter, UTC+3 summer.

All timestamps are converted to UTC before storage:

```typescript
import { fromZonedTime } from "date-fns-tz";

// JBlanked returns "2024-01-15" and "16:30" in EET
const eetDateTime = `${date}T${time}:00`;
const utcDate = fromZonedTime(eetDateTime, "Europe/Helsinki");
```

#### DST-Aware Trading Sessions

Trading sessions shift with daylight saving time:

| Session | Winter (UTC) | Summer (UTC) |
|---------|--------------|--------------|
| London | 08:00-16:00 | 07:00-15:00 |
| New York | 13:00-21:00 | 12:00-20:00 |
| Tokyo | 00:00-09:00 | 00:00-09:00 (no DST) |
| Sydney | 22:00-07:00 | 22:00-07:00 |

The `getTradingSession()` function calculates DST boundaries for UK (last Sunday March → October) and US (2nd Sunday March → 1st Sunday November).

#### Event ID Format

```
jb_forex-factory_{Event_ID}
```

The `jb_` prefix identifies JBlanked-sourced events, allowing coexistence with any future data sources.

#### Currency Extraction

JBlanked sometimes returns `CURRENCY_USD` format. We extract just the currency code:

```typescript
function extractCurrency(raw: string): string {
  if (raw.startsWith("CURRENCY_")) {
    return raw.replace("CURRENCY_", "");
  }
  return raw;
}
```

### Data Flow

```
JBlanked API
     │
     ▼
Railway Worker (hourly)
     │
     ├──────────────────┐
     ▼                  ▼
TimescaleDB        ClickHouse
(90-day window)    (historical archive)
```

### API Endpoints Used

| Endpoint | Purpose | Schedule |
|----------|---------|----------|
| `/forex-factory/calendar/{date}` | Single day events | Forward-fill (hourly) |
| `/forex-factory/calendar/range/{start}/{end}` | Date range | Backfill (one-time) |

## Consequences

### Positive

- **Reliable ingestion**: No more scraper breakage
- **Clean data**: Consistent format, proper timestamps
- **Historical access**: 26,000+ events from 2023-01-01
- **Reduced maintenance**: API is stable, no HTML parsing
- **Better timezone handling**: Clear EET→UTC conversion

### Negative

- **API cost**: Monthly subscription required
- **Limited history**: Only 2023+ (ForexFactory scraper had older data)
- **Impact field**: Events before 2024 have no impact level (defaults to "None")

### Mitigations

- Historical data gap is acceptable for MVP (most analysis focuses on recent years)
- Impact field defaults to "None" for pre-2024 events
- API cost is offset by reduced maintenance time

## Files Changed

### Deleted (ForexFactory Scraper)

- `worker/src/news-updater.ts` - Puppeteer scraper
- `worker/src/lib/ff-parser.ts` - HTML parser
- `scraper/` directory - Python scraper

### Added/Modified

- `worker/src/jblanked-news.ts` - JBlanked API client with DST-aware sessions
- `worker/src/index.ts` - Integrated hourly news updates
- `docs/data-architecture.md` - Updated data flow documentation

## Verification

After migration:

- [x] ClickHouse `news_events` has 26,821 events from 2023-01-01
- [x] TimescaleDB `news_events` has recent 90 days
- [x] All currencies are valid format (USD, EUR, GBP, etc.)
- [x] Trading sessions are DST-aware
- [x] Railway worker runs hourly forward-fill successfully

---

*Recorded: January 2026*
