/**
 * News event queries from TimescaleDB (Hot/Live Data)
 *
 * This module queries RECENT news events from TimescaleDB.
 * Use for:
 * - Chart display markers (events in visible time range)
 * - Upcoming events calendar
 * - Events within 30-day rolling window
 *
 * For HISTORICAL analytics (events older than 30 days), use:
 * - lib/db/clickhouse-news.ts
 * - /api/news/historical endpoint
 *
 * @see docs/data-architecture.md for full routing rules
 */

import { getTimescalePool } from "./index";

export interface NewsEvent {
  eventId: string;
  eventType: string;
  name: string;
  country: string;
  currency: string;
  timestamp: number; // Unix milliseconds
  impact: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  description: string | null;
  // Timezone data
  datetimeUtc: string | null;
  datetimeNewYork: string | null;
  datetimeLondon: string | null;
  sourceTz: string | null;
  tradingSession: string | null;
}

export interface EventReaction {
  spikeDirection: "UP" | "DOWN" | "NEUTRAL" | null;
  spikeMagnitudePips: number | null;
  patternType: string | null;
  didReverse: boolean | null;
  reversalMagnitudePips: number | null;
  finalMatchesSpike: boolean | null;
  priceAtEvent: number | null;
  spikeHigh: number | null;
  spikeLow: number | null;
}

export interface EventStats {
  totalOccurrences: number;
  avgSpikePips: number | null;
  upCount: number;
  downCount: number;
  reversalRate: number | null;
}

export interface NewsEventWithReaction extends NewsEvent {
  reaction: EventReaction | null;
  stats: EventStats | null;
}

/**
 * Get news events in a time range for a specific pair
 */
export async function getEventsInTimeRange(
  pair: string,
  startTime: number, // Unix ms
  endTime: number,
  impactFilter?: string // "high" | "medium" | "all"
): Promise<NewsEvent[]> {
  const pool = getTimescalePool();

  // Extract currencies from pair (e.g., "EUR_USD" -> ["EUR", "USD"])
  const [base, quote] = pair.split("_");

  // Build query
  let query = `
    SELECT
      event_id as "eventId",
      event_type as "eventType",
      name,
      country,
      currency,
      EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp,
      impact,
      actual,
      forecast,
      previous,
      description
    FROM news_events
    WHERE timestamp >= to_timestamp($1 / 1000.0)
      AND timestamp <= to_timestamp($2 / 1000.0)
      AND currency IN ($3, $4)
  `;

  const params: (string | number)[] = [startTime, endTime, base, quote];

  // Add impact filter
  if (impactFilter && impactFilter !== "all") {
    query += ` AND impact = $5`;
    params.push(impactFilter);
  }

  query += ` ORDER BY timestamp ASC LIMIT 500`;

  const result = await pool.query(query, params);

  return result.rows.map((row) => ({
    ...row,
    timestamp: parseInt(row.timestamp, 10),
  }));
}

/**
 * Get news events with reactions for a specific pair in a time range
 * Stats are skipped by default for faster loading (can be fetched separately)
 */
export async function getEventsWithReactions(
  pair: string,
  startTime: number, // Unix ms
  endTime: number,
  impactFilter?: string, // "high" | "medium" | "all"
  includeStats?: boolean // Skip stats by default for faster loading
): Promise<NewsEventWithReaction[]> {
  const pool = getTimescalePool();

  // Extract currencies from pair (e.g., "EUR_USD" -> ["EUR", "USD"])
  const [base, quote] = pair.split("_");

  // Query events with their reactions for this specific pair
  let query = `
    SELECT
      n.event_id as "eventId",
      n.event_type as "eventType",
      n.name,
      n.country,
      n.currency,
      EXTRACT(EPOCH FROM n.timestamp) * 1000 as timestamp,
      n.impact,
      n.actual,
      n.forecast,
      n.previous,
      n.description,
      n.datetime_utc as "datetimeUtc",
      n.datetime_new_york as "datetimeNewYork",
      n.datetime_london as "datetimeLondon",
      n.source_tz as "sourceTz",
      n.trading_session as "tradingSession",
      r.spike_direction as "spikeDirection",
      r.spike_magnitude_pips as "spikeMagnitudePips",
      r.pattern_type as "patternType",
      r.did_reverse as "didReverse",
      r.reversal_magnitude_pips as "reversalMagnitudePips",
      r.final_matches_spike as "finalMatchesSpike",
      r.price_at_event as "priceAtEvent",
      r.spike_high as "spikeHigh",
      r.spike_low as "spikeLow"
    FROM news_events n
    LEFT JOIN event_price_reactions r
      ON n.event_id = r.event_id AND r.pair = $5
    WHERE n.timestamp >= to_timestamp($1 / 1000.0)
      AND n.timestamp <= to_timestamp($2 / 1000.0)
      AND n.currency IN ($3, $4)
  `;

  const params: (string | number)[] = [startTime, endTime, base, quote, pair];

  // Add impact filter
  if (impactFilter && impactFilter !== "all") {
    query += ` AND n.impact = $6`;
    params.push(impactFilter);
  }

  query += ` ORDER BY n.timestamp ASC LIMIT 500`;

  const result = await pool.query(query, params);

  // Only fetch stats if requested (slower)
  let statsMap = new Map<string, EventStats>();
  if (includeStats) {
    const eventIds = Array.from(new Set(result.rows.map((r) => r.eventId)));
    statsMap = await getEventStats(eventIds, pair);
  }

  return result.rows.map((row) => ({
    eventId: row.eventId,
    eventType: row.eventType,
    name: row.name,
    country: row.country,
    currency: row.currency,
    timestamp: parseInt(row.timestamp, 10),
    impact: row.impact,
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    description: row.description,
    datetimeUtc: row.datetimeUtc,
    datetimeNewYork: row.datetimeNewYork,
    datetimeLondon: row.datetimeLondon,
    sourceTz: row.sourceTz,
    tradingSession: row.tradingSession,
    reaction: row.spikeDirection
      ? {
          spikeDirection: row.spikeDirection,
          spikeMagnitudePips: row.spikeMagnitudePips ? parseFloat(row.spikeMagnitudePips) : null,
          patternType: row.patternType,
          didReverse: row.didReverse,
          reversalMagnitudePips: row.reversalMagnitudePips ? parseFloat(row.reversalMagnitudePips) : null,
          finalMatchesSpike: row.finalMatchesSpike,
          priceAtEvent: row.priceAtEvent ? parseFloat(row.priceAtEvent) : null,
          spikeHigh: row.spikeHigh ? parseFloat(row.spikeHigh) : null,
          spikeLow: row.spikeLow ? parseFloat(row.spikeLow) : null,
        }
      : null,
    stats: statsMap.get(getEventNameFromId(row.eventId)) || null,
  }));
}

/**
 * Extract event name from event_id (e.g., "CPI_m_m_USD_2024-01-15_14:30" -> "CPI_m_m")
 */
function getEventNameFromId(eventId: string): string {
  // Format: {name}_{currency}_{YYYY-MM-DD}_{HH:MM}
  // Split and remove last 3 parts (currency, date, time)
  const parts = eventId.split("_");
  // Currency is always 3 chars, date is YYYY-MM-DD, time is HH:MM
  // So we need to find where the currency starts
  // Reverse find: time is last, date is second to last, currency is third to last
  if (parts.length >= 4) {
    // Remove last 3 parts: time, date, currency
    return parts.slice(0, -3).join("_");
  }
  return eventId;
}

/**
 * Get historical stats for events (by event name pattern) - parallelized
 */
async function getEventStats(
  eventIds: string[],
  pair: string
): Promise<Map<string, EventStats>> {
  if (eventIds.length === 0) return new Map();

  const pool = getTimescalePool();

  // Extract unique event names from IDs
  const eventNames = Array.from(new Set(eventIds.map(getEventNameFromId)));

  // Query all stats in parallel
  const results = await Promise.all(
    eventNames.map(async (eventName) => {
      const result = await pool.query(
        `
        SELECT
          COUNT(*) as total,
          AVG(spike_magnitude_pips::numeric) as avg_spike,
          SUM(CASE WHEN spike_direction = 'UP' THEN 1 ELSE 0 END) as up_count,
          SUM(CASE WHEN spike_direction = 'DOWN' THEN 1 ELSE 0 END) as down_count,
          AVG(CASE WHEN did_reverse THEN 1 ELSE 0 END) as reversal_rate
        FROM event_price_reactions
        WHERE event_id LIKE $1 AND pair = $2
        `,
        [`${eventName}_%`, pair]
      );
      return { eventName, result };
    })
  );

  // Build stats map from parallel results
  const statsMap = new Map<string, EventStats>();
  for (const { eventName, result } of results) {
    if (result.rows[0] && parseInt(result.rows[0].total) > 0) {
      statsMap.set(eventName, {
        totalOccurrences: parseInt(result.rows[0].total),
        avgSpikePips: result.rows[0].avg_spike ? parseFloat(result.rows[0].avg_spike) : null,
        upCount: parseInt(result.rows[0].up_count) || 0,
        downCount: parseInt(result.rows[0].down_count) || 0,
        reversalRate: result.rows[0].reversal_rate ? parseFloat(result.rows[0].reversal_rate) : null,
      });
    }
  }

  return statsMap;
}

/**
 * Get upcoming news events
 */
export async function getUpcomingEvents(
  currency?: string,
  hoursAhead: number = 24,
  impactFilter?: string
): Promise<NewsEvent[]> {
  const pool = getTimescalePool();

  const now = Date.now();
  const cutoff = now + hoursAhead * 60 * 60 * 1000;

  let query = `
    SELECT
      event_id as "eventId",
      event_type as "eventType",
      name,
      country,
      currency,
      EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp,
      impact,
      actual,
      forecast,
      previous,
      description
    FROM news_events
    WHERE timestamp >= to_timestamp($1 / 1000.0)
      AND timestamp <= to_timestamp($2 / 1000.0)
  `;

  const params: (string | number)[] = [now, cutoff];

  if (currency) {
    query += ` AND currency = $3`;
    params.push(currency);
  }

  if (impactFilter && impactFilter !== "all") {
    const paramIdx = params.length + 1;
    query += ` AND impact = $${paramIdx}`;
    params.push(impactFilter);
  }

  query += ` ORDER BY timestamp ASC LIMIT 100`;

  const result = await pool.query(query, params);

  return result.rows.map((row) => ({
    ...row,
    timestamp: parseInt(row.timestamp, 10),
  }));
}
