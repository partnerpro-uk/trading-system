# ForexFactoryScraper

A web scraper that downloads forex economic calendar data from [ForexFactory.com](https://www.forexfactory.com/), optimized for Convex DB integration.

## Features

- **Incremental Scraping**: Resumes from last scraped event automatically
- **Future Events**: Scrapes scheduled/upcoming events (configurable days ahead)
- **DST-Aware Timezones**: Proper handling for US/UK daylight saving transitions
- **Convex-Ready Output**: JSONL format with unique event IDs, UTC timestamps, and upsert tracking
- **Cloudflare Bypass**: Uses undetected-chromedriver to avoid bot detection
- **Retry Logic**: Exponential backoff for resilient scraping
- **Trading Session Classification**: Automatically categorizes events by forex session

## Requirements

- Google Chrome browser installed
- Python 3.7+

Install dependencies:
```bash
pip install -r requirements.txt
```

## Usage

```bash
# Default: scrape historical + 30 days ahead
python ffs.py

# Start from a specific date
python ffs.py --start-date 2024-01-01

# Only scrape future/scheduled events (starts from today)
python ffs.py --future-only

# Scrape more days into the future
python ffs.py --days-ahead 60

# Custom output file
python ffs.py --output my_data.jsonl

# Historical data with calendar navigation (more reliable for old dates)
python ffs.py --start-date 2015-01-01 --days-ahead 30 --use-calendar-nav
```

### CLI Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--start-date` | Start date (YYYY-MM-DD format) | Resume from last scraped |
| `--days-ahead` | Days ahead to scrape future events | 30 |
| `--output`, `-o` | Output JSONL file path | `forex_factory_catalog.jsonl` |
| `--future-only` | Only scrape future events | False |
| `--use-calendar-nav` | Use calendar widget navigation (recommended for historical data) | False |

## Output Format

Output is JSONL (JSON Lines) - one JSON object per line for easy streaming and import.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | string | Unique ID: `{name}_{currency}_{YYYY-MM-DD}_{HH:MM}` |
| `status` | string | `"scheduled"` (future) or `"released"` (has actual value) |
| `timestamp_utc` | int | Event time in UTC milliseconds |
| `scraped_at` | int | When scraped (UTC ms) - for upsert tracking |
| `datetime_utc` | string | Human-readable UTC time |
| `datetime_new_york` | string | Human-readable NY time (EST/EDT) |
| `datetime_london` | string | Human-readable London time (GMT/BST) |
| `day_of_week` | string | Mon/Tue/Wed/Thu/Fri/Sat/Sun |
| `trading_session` | string | asian/london/new_york/london_ny_overlap/off_hours |
| `currency` | string | USD/GBP/EUR/JPY/etc. |
| `source_tz` | string | Source timezone for the currency |
| `impact` | string | high/medium/low/non_economic |
| `event` | string | Event name |
| `actual` | string/null | Actual reported value |
| `forecast` | string/null | Forecasted value |
| `previous` | string/null | Previous period value |
| `deviation` | float/null | Actual - Forecast |
| `deviation_pct` | float/null | Deviation as percentage |
| `outcome` | string/null | beat/miss/met (null for scheduled) |

### Example Record

```json
{
  "event_id": "CPI_m_m_USD_2024-01-15_14:30",
  "status": "released",
  "timestamp_utc": 1705329000000,
  "scraped_at": 1705400000000,
  "datetime_utc": "2024-01-15 14:30:00",
  "datetime_new_york": "2024-01-15 09:30:00",
  "datetime_london": "2024-01-15 14:30:00",
  "day_of_week": "Mon",
  "trading_session": "london_ny_overlap",
  "currency": "USD",
  "source_tz": "US/Eastern",
  "impact": "high",
  "event": "CPI m/m",
  "actual": "0.3%",
  "forecast": "0.2%",
  "previous": "0.1%",
  "deviation": 0.1,
  "deviation_pct": 50.0,
  "outcome": "beat"
}
```

## Convex Integration

The output is optimized for Convex DB:

1. **event_id**: Use as unique identifier for upserts
2. **status**: Filter scheduled vs released events
3. **scraped_at**: Track when data was last updated (for upsert logic)
4. **timestamp_utc**: Native Convex timestamp format (milliseconds)

### Upsert Strategy

```javascript
// Convex mutation example
export const upsertEvent = mutation({
  args: { event: v.object({...}) },
  handler: async (ctx, { event }) => {
    const existing = await ctx.db
      .query("events")
      .withIndex("by_event_id", q => q.eq("event_id", event.event_id))
      .first();

    if (existing) {
      // Only update if new scrape is more recent
      if (event.scraped_at > existing.scraped_at) {
        await ctx.db.patch(existing._id, event);
      }
    } else {
      await ctx.db.insert("events", event);
    }
  }
});
```

### Deduplication

For historical backfills, dedupe on `event_id` only - it's unique per event (`{name}_{currency}_{date}_{time}`). The `scraped_at` field will differ between scrapes but historical data doesn't change, so simply skip if `event_id` exists.

For future/scheduled events, use the upsert strategy above to update `actual` values when they become available.

## Trading Sessions

Events are classified by forex trading session (UTC times):

| Session | UTC Hours | Description |
|---------|-----------|-------------|
| `asian` | 21:00-06:00 | Sydney/Tokyo session |
| `london` | 07:00-16:00 | London session |
| `new_york` | 12:00-21:00 | New York session |
| `london_ny_overlap` | 12:00-16:00 | Most liquid period |
| `asian_london_overlap` | 06:00-07:00 | Asian/London handoff |
| `off_hours` | Other | Low liquidity period |

## Supported Currencies

The scraper maps each currency to its source timezone for accurate local time representation:

| Currency | Source Timezone |
|----------|-----------------|
| USD | America/New_York |
| GBP | Europe/London |
| EUR | Europe/Berlin (ECB) |
| JPY | Asia/Tokyo |
| AUD | Australia/Sydney |
| NZD | Pacific/Auckland |
| CAD | America/Toronto |
| CHF | Europe/Zurich |
| CNY | Asia/Shanghai |
| + more | ... |

## Files Generated

| File | Description |
|------|-------------|
| `forex_factory_catalog.jsonl` | Main output (JSONL format) |
| `scraper.log` | Detailed logging |
| `errors.csv` | Events that failed to parse |

## Notes

- Chrome runs in non-headless mode due to Cloudflare protection
- Historical data available from January 1, 2007
- Random delays (1-3s) between requests to avoid rate limiting
- Retry with exponential backoff on failures (max 3 attempts)

## License

MIT
