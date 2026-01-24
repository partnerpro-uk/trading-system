/**
 * News event queries from ClickHouse (Historical Analytics)
 *
 * This module queries the historical news events and reactions stored in ClickHouse.
 * It should be used for:
 * - Historical event analysis (events older than 30 days)
 * - Statistical aggregations across event types
 * - Settlement price analysis (T-15 baseline, T+60, T+90)
 *
 * For live/recent events (within 30 days), use lib/db/news.ts which queries TimescaleDB.
 */

import { getClickHouseClient } from "./index";

// ============================================================================
// Types
// ============================================================================

export interface HistoricalNewsEvent {
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
  datetimeUtc: string | null;
  datetimeNewYork: string | null;
  datetimeLondon: string | null;
}

export interface HistoricalReaction {
  // Baseline price (T-15 minutes before event)
  priceAtMinus15m: number;
  priceAtMinus5m: number | null;

  // Event time prices
  priceAtEvent: number;
  spikeHigh: number;
  spikeLow: number;
  spikeDirection: "UP" | "DOWN" | "NEUTRAL";
  spikeMagnitudePips: number;
  timeToSpikeSeconds: number | null;

  // Settlement prices (short-term)
  priceAtPlus5m: number | null;
  priceAtPlus15m: number | null;
  priceAtPlus30m: number | null;
  priceAtPlus60m: number | null; // High impact events only
  priceAtPlus90m: number | null; // FOMC/ECB events only

  // Extended aftermath prices (from H1 candles)
  priceAtPlus2hr: number | null;
  priceAtPlus4hr: number | null;
  priceAtPlus8hr: number | null;
  priceAtPlus24hr: number | null;

  // Pattern analysis
  patternType: string;
  extendedPatternType: string | null;
  didReverse: boolean;
  reversalMagnitudePips: number | null;
  finalMatchesSpike: boolean;

  // Window info
  windowMinutes: number; // 30, 75, or 105
}

export interface HistoricalEventWithReaction extends HistoricalNewsEvent {
  reaction: HistoricalReaction | null;
}

export interface HistoricalEventForDisplay {
  timestamp: number;
  actualValue?: number;
  forecastValue?: number;
  outcome: "beat" | "miss" | "inline";

  // Baseline price (all pips calculated from this)
  priceAtMinus15m: number;

  // Spike info
  spikeMagnitudePips: number;
  spikeDirection: "UP" | "DOWN" | "NEUTRAL";
  spikeHigh: number;
  spikeLow: number;

  // Settlement prices (raw)
  priceAtEvent: number;
  priceAtPlus5m: number | null;
  priceAtPlus15m: number | null;
  priceAtPlus30m: number | null;
  priceAtPlus60m: number | null;
  priceAtPlus90m: number | null;

  // Pips from T-15 baseline (calculated)
  pipsAtEvent: number;
  pipsAt5m: number | null;
  pipsAt15m: number | null;
  pipsAt30m: number | null;
  pipsAt60m: number | null;
  pipsAt90m: number | null;

  // Extended aftermath pips from T-15 baseline
  pipsAt2hr: number | null;
  pipsAt4hr: number | null;
  pipsAt8hr: number | null;
  pipsAt24hr: number | null;

  // Pattern info
  patternType: string;
  extendedPatternType: string | null;
  didReverse: boolean;
  reversalMagnitudePips?: number;
  windowMinutes: number;
}

export interface EventTypeStats {
  eventType: string;
  totalOccurrences: number;
  avgSpikePips: number | null;
  upCount: number;
  downCount: number;
  reversalRate: number | null;
  beatWinRate: number | null;
  missWinRate: number | null;
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get historical events with reactions from ClickHouse
 *
 * @param eventType - The event type to filter by
 * @param pair - The currency pair (e.g., "EUR_USD")
 * @param beforeTimestamp - Only get events before this timestamp (Unix ms)
 * @param limit - Maximum number of events to return
 */
export async function getHistoricalEventsFromClickHouse(
  eventType: string,
  pair: string,
  beforeTimestamp: number,
  limit: number = 20
): Promise<HistoricalEventWithReaction[]> {
  const clickhouse = getClickHouseClient();

  // Extract currencies from pair
  const [base, quote] = pair.split("_");

  const result = await clickhouse.query({
    query: `
      SELECT
        n.event_id as eventId,
        n.event_type as eventType,
        n.name,
        n.country,
        n.currency,
        toInt64(toUnixTimestamp64Milli(n.timestamp)) as timestamp,
        n.impact,
        n.actual,
        n.forecast,
        n.previous,
        n.description,
        n.datetime_utc as datetimeUtc,
        n.datetime_new_york as datetimeNewYork,
        n.datetime_london as datetimeLondon,
        r.price_at_minus_15m as priceAtMinus15m,
        r.price_at_minus_5m as priceAtMinus5m,
        r.price_at_event as priceAtEvent,
        r.spike_high as spikeHigh,
        r.spike_low as spikeLow,
        r.spike_direction as spikeDirection,
        r.spike_magnitude_pips as spikeMagnitudePips,
        r.time_to_spike_seconds as timeToSpikeSeconds,
        r.price_at_plus_5m as priceAtPlus5m,
        r.price_at_plus_15m as priceAtPlus15m,
        r.price_at_plus_30m as priceAtPlus30m,
        r.price_at_plus_60m as priceAtPlus60m,
        r.price_at_plus_90m as priceAtPlus90m,
        r.price_t_plus_2hr as priceAtPlus2hr,
        r.price_t_plus_4hr as priceAtPlus4hr,
        r.price_t_plus_8hr as priceAtPlus8hr,
        r.price_t_plus_24hr as priceAtPlus24hr,
        r.pattern_type as patternType,
        r.extended_pattern_type as extendedPatternType,
        r.did_reverse as didReverse,
        r.reversal_magnitude_pips as reversalMagnitudePips,
        r.final_matches_spike as finalMatchesSpike,
        r.window_minutes as windowMinutes
      FROM news_events n
      INNER JOIN event_price_reactions r
        ON n.event_id = r.event_id AND r.pair = {pair:String}
      WHERE n.event_type = {eventType:String}
        AND n.timestamp < fromUnixTimestamp64Milli({beforeTimestamp:Int64})
        AND n.currency IN ({base:String}, {quote:String})
        AND n.actual IS NOT NULL
        AND n.actual != ''
      ORDER BY n.timestamp DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      eventType,
      pair,
      beforeTimestamp,
      base,
      quote,
      limit,
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as RawHistoricalEventRow[];

  return rows.map((row) => ({
    eventId: row.eventId,
    eventType: row.eventType,
    name: row.name,
    country: row.country,
    currency: row.currency,
    timestamp: parseInt(String(row.timestamp), 10),
    impact: row.impact,
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    description: row.description,
    datetimeUtc: row.datetimeUtc,
    datetimeNewYork: row.datetimeNewYork,
    datetimeLondon: row.datetimeLondon,
    reaction: row.priceAtEvent
      ? {
          priceAtMinus15m: parseFloat(String(row.priceAtMinus15m)),
          priceAtMinus5m: row.priceAtMinus5m ? parseFloat(String(row.priceAtMinus5m)) : null,
          priceAtEvent: parseFloat(String(row.priceAtEvent)),
          spikeHigh: parseFloat(String(row.spikeHigh)),
          spikeLow: parseFloat(String(row.spikeLow)),
          spikeDirection: (row.spikeDirection as "UP" | "DOWN" | "NEUTRAL") || "NEUTRAL",
          spikeMagnitudePips: parseFloat(String(row.spikeMagnitudePips)),
          timeToSpikeSeconds: row.timeToSpikeSeconds ? parseInt(String(row.timeToSpikeSeconds), 10) : null,
          priceAtPlus5m: row.priceAtPlus5m ? parseFloat(String(row.priceAtPlus5m)) : null,
          priceAtPlus15m: row.priceAtPlus15m ? parseFloat(String(row.priceAtPlus15m)) : null,
          priceAtPlus30m: row.priceAtPlus30m ? parseFloat(String(row.priceAtPlus30m)) : null,
          priceAtPlus60m: row.priceAtPlus60m ? parseFloat(String(row.priceAtPlus60m)) : null,
          priceAtPlus90m: row.priceAtPlus90m ? parseFloat(String(row.priceAtPlus90m)) : null,
          priceAtPlus2hr: row.priceAtPlus2hr ? parseFloat(String(row.priceAtPlus2hr)) : null,
          priceAtPlus4hr: row.priceAtPlus4hr ? parseFloat(String(row.priceAtPlus4hr)) : null,
          priceAtPlus8hr: row.priceAtPlus8hr ? parseFloat(String(row.priceAtPlus8hr)) : null,
          priceAtPlus24hr: row.priceAtPlus24hr ? parseFloat(String(row.priceAtPlus24hr)) : null,
          patternType: row.patternType || "",
          extendedPatternType: row.extendedPatternType || null,
          didReverse: Boolean(row.didReverse),
          reversalMagnitudePips: row.reversalMagnitudePips ? parseFloat(String(row.reversalMagnitudePips)) : null,
          finalMatchesSpike: Boolean(row.finalMatchesSpike),
          windowMinutes: parseInt(String(row.windowMinutes), 10) || 30,
        }
      : null,
  }));
}

/**
 * Get event type statistics from ClickHouse
 */
export async function getEventTypeStatistics(
  eventType: string,
  pair: string
): Promise<EventTypeStats | null> {
  const clickhouse = getClickHouseClient();

  const [base, quote] = pair.split("_");

  const result = await clickhouse.query({
    query: `
      SELECT
        n.event_type as eventType,
        count() as totalOccurrences,
        avg(r.spike_magnitude_pips) as avgSpikePips,
        countIf(r.spike_direction = 'UP') as upCount,
        countIf(r.spike_direction = 'DOWN') as downCount,
        avg(r.did_reverse) as reversalRate
      FROM news_events n
      INNER JOIN event_price_reactions r ON n.event_id = r.event_id AND r.pair = {pair:String}
      WHERE n.event_type = {eventType:String}
        AND n.currency IN ({base:String}, {quote:String})
      GROUP BY n.event_type
    `,
    query_params: {
      eventType,
      pair,
      base,
      quote,
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as RawEventTypeStats[];

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    eventType: row.eventType,
    totalOccurrences: parseInt(String(row.totalOccurrences), 10),
    avgSpikePips: row.avgSpikePips ? parseFloat(String(row.avgSpikePips)) : null,
    upCount: parseInt(String(row.upCount), 10),
    downCount: parseInt(String(row.downCount), 10),
    reversalRate: row.reversalRate ? parseFloat(String(row.reversalRate)) : null,
    beatWinRate: null, // Calculated separately if needed
    missWinRate: null,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate pip value for a pair
 */
export function getPipValue(pair: string): number {
  const isJpy = pair.includes("JPY");
  return isJpy ? 0.01 : 0.0001;
}

/**
 * Calculate pips from baseline
 */
export function calculatePipsFromBaseline(
  baselinePrice: number,
  currentPrice: number | null,
  pair: string
): number | null {
  if (currentPrice === null || baselinePrice === 0) return null;
  const pipValue = getPipValue(pair);
  return (currentPrice - baselinePrice) / pipValue;
}

/**
 * Transform raw historical events into display format with calculated pips
 */
export function transformToDisplayFormat(
  events: HistoricalEventWithReaction[],
  pair: string,
  eventType: string
): HistoricalEventForDisplay[] {
  const pipValue = getPipValue(pair);

  return events
    .filter((e) => e.reaction !== null)
    .map((event) => {
      const r = event.reaction!;
      const baseline = r.priceAtMinus15m;

      // Parse actual and forecast values
      const actualValue = event.actual ? parseFloat(event.actual.replace(/[%,K]/g, "")) : undefined;
      const forecastValue = event.forecast ? parseFloat(event.forecast.replace(/[%,K]/g, "")) : undefined;

      // Classify outcome
      const outcome = classifyOutcome(actualValue, forecastValue, eventType);

      return {
        timestamp: event.timestamp,
        actualValue,
        forecastValue,
        outcome,

        // Baseline
        priceAtMinus15m: baseline,

        // Spike info
        spikeMagnitudePips: r.spikeMagnitudePips,
        spikeDirection: r.spikeDirection,
        spikeHigh: r.spikeHigh,
        spikeLow: r.spikeLow,

        // Settlement prices (raw)
        priceAtEvent: r.priceAtEvent,
        priceAtPlus5m: r.priceAtPlus5m,
        priceAtPlus15m: r.priceAtPlus15m,
        priceAtPlus30m: r.priceAtPlus30m,
        priceAtPlus60m: r.priceAtPlus60m,
        priceAtPlus90m: r.priceAtPlus90m,

        // Pips from T-15 baseline
        pipsAtEvent: (r.priceAtEvent - baseline) / pipValue,
        pipsAt5m: r.priceAtPlus5m ? (r.priceAtPlus5m - baseline) / pipValue : null,
        pipsAt15m: r.priceAtPlus15m ? (r.priceAtPlus15m - baseline) / pipValue : null,
        pipsAt30m: r.priceAtPlus30m ? (r.priceAtPlus30m - baseline) / pipValue : null,
        pipsAt60m: r.priceAtPlus60m ? (r.priceAtPlus60m - baseline) / pipValue : null,
        pipsAt90m: r.priceAtPlus90m ? (r.priceAtPlus90m - baseline) / pipValue : null,

        // Extended aftermath pips
        pipsAt2hr: r.priceAtPlus2hr ? (r.priceAtPlus2hr - baseline) / pipValue : null,
        pipsAt4hr: r.priceAtPlus4hr ? (r.priceAtPlus4hr - baseline) / pipValue : null,
        pipsAt8hr: r.priceAtPlus8hr ? (r.priceAtPlus8hr - baseline) / pipValue : null,
        pipsAt24hr: r.priceAtPlus24hr ? (r.priceAtPlus24hr - baseline) / pipValue : null,

        // Pattern info
        patternType: r.patternType,
        extendedPatternType: r.extendedPatternType,
        didReverse: r.didReverse,
        reversalMagnitudePips: r.reversalMagnitudePips ?? undefined,
        windowMinutes: r.windowMinutes,
      };
    });
}

// Lower-is-better events for outcome classification
const LOWER_IS_BETTER_EVENTS = [
  "UNEMPLOYMENT",
  "UNEMPLOYMENT_RATE",
  "JOBLESS_CLAIMS",
  "INITIAL_CLAIMS",
  "CONTINUING_CLAIMS",
  "CPI_MOM",
  "CPI_YOY",
  "CPI",
  "CORE_CPI_MOM",
  "CORE_CPI_YOY",
  "CORE_CPI",
  "PPI_MOM",
  "PPI_YOY",
  "PPI",
  "CORE_PPI",
];

function classifyOutcome(
  actual: number | undefined,
  forecast: number | undefined,
  eventType: string
): "beat" | "miss" | "inline" {
  if (actual === undefined || forecast === undefined) return "inline";
  if (forecast === 0) {
    if (actual === 0) return "inline";
    return actual > 0 ? "beat" : "miss";
  }
  const deviationPct = Math.abs((actual - forecast) / forecast) * 100;
  if (deviationPct <= 5) return "inline";
  const lowerIsBetter = LOWER_IS_BETTER_EVENTS.includes(eventType);
  if (lowerIsBetter) return actual < forecast ? "beat" : "miss";
  return actual > forecast ? "beat" : "miss";
}

// ============================================================================
// Internal Types
// ============================================================================

interface RawHistoricalEventRow {
  eventId: string;
  eventType: string;
  name: string;
  country: string;
  currency: string;
  timestamp: number | string;
  ts: number | string; // Alias used in chart query to avoid column name conflict
  impact: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  description: string | null;
  datetimeUtc: string | null;
  datetimeNewYork: string | null;
  datetimeLondon: string | null;
  priceAtMinus15m: number | string;
  priceAtMinus5m: number | string | null;
  priceAtEvent: number | string;
  spikeHigh: number | string;
  spikeLow: number | string;
  spikeDirection: string;
  spikeMagnitudePips: number | string;
  timeToSpikeSeconds: number | string | null;
  priceAtPlus5m: number | string | null;
  priceAtPlus15m: number | string | null;
  priceAtPlus30m: number | string | null;
  priceAtPlus60m: number | string | null;
  priceAtPlus90m: number | string | null;
  priceAtPlus2hr: number | string | null;
  priceAtPlus4hr: number | string | null;
  priceAtPlus8hr: number | string | null;
  priceAtPlus24hr: number | string | null;
  patternType: string;
  extendedPatternType: string | null;
  didReverse: number | boolean;
  reversalMagnitudePips: number | string | null;
  finalMatchesSpike: number | boolean;
  windowMinutes: number | string;
}

interface RawEventTypeStats {
  eventType: string;
  totalOccurrences: number | string;
  avgSpikePips: number | string | null;
  upCount: number | string;
  downCount: number | string;
  reversalRate: number | string | null;
}

// ============================================================================
// Chart Display Events (for markers on historical charts)
// ============================================================================

/**
 * Get upcoming news events (next 7 days) from ClickHouse
 * Returns high/medium impact events sorted by timestamp
 */
export async function getUpcomingEvents(
  limit: number = 10
): Promise<HistoricalNewsEvent[]> {
  try {
    const clickhouse = getClickHouseClient();

    const now = Math.floor(Date.now() / 1000);
    const weekFromNow = now + 7 * 24 * 60 * 60;

    const query = `
      SELECT
        event_id as eventId,
        event_type as eventType,
        name,
        country,
        currency,
        toUnixTimestamp(timestamp) * 1000 as ts,
        impact,
        actual,
        forecast,
        previous,
        description,
        datetime_utc as datetimeUtc,
        datetime_new_york as datetimeNewYork,
        datetime_london as datetimeLondon
      FROM news_events
      WHERE timestamp >= fromUnixTimestamp(${now})
        AND timestamp <= fromUnixTimestamp(${weekFromNow})
        AND impact IN ('High', 'Medium')
      ORDER BY timestamp ASC
      LIMIT ${limit}
    `;

    const result = await clickhouse.query({
      query,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as RawHistoricalEventRow[];

    return rows.map((row) => ({
      eventId: row.eventId,
      eventType: row.eventType || "Unknown",
      name: row.name,
      country: row.country,
      currency: row.currency,
      timestamp:
        typeof row.ts === "string"
          ? parseInt(row.ts, 10)
          : Number(row.ts),
      impact: row.impact || "None",
      actual: row.actual,
      forecast: row.forecast,
      previous: row.previous,
      description: row.description,
      datetimeUtc: row.datetimeUtc,
      datetimeNewYork: row.datetimeNewYork,
      datetimeLondon: row.datetimeLondon,
    }));
  } catch (error) {
    console.error("[ClickHouse] Error fetching upcoming events:", error);
    return [];
  }
}

/**
 * Get news events in a time range for chart display from ClickHouse
 * Used when viewing historical periods (older than 90 days)
 */
export async function getEventsInTimeRangeFromClickHouse(
  pair: string,
  startTime: number, // Unix ms
  endTime: number,
  impactFilter?: string // "high" | "medium" | "low" | "all"
): Promise<HistoricalNewsEvent[]> {
  try {
    const clickhouse = getClickHouseClient();

    // Extract currencies from pair (e.g., "EUR_USD" -> ["EUR", "USD"])
    const [base, quote] = pair.split("_");

    // Validate currency codes (prevent SQL injection)
    if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) {
      console.error("[ClickHouse] Invalid currency codes:", base, quote);
      return [];
    }

    // Build impact filter clause
    let impactClause = "";
    if (impactFilter && impactFilter !== "all") {
      const impacts =
        impactFilter === "high"
          ? ["High"]
          : impactFilter === "medium"
          ? ["High", "Medium"]
          : ["High", "Medium", "Low"];
      impactClause = `AND impact IN ('${impacts.join("','")}')`;
    }

    // Convert ms timestamps to seconds for ClickHouse DateTime comparison
    const startTimeSec = Math.floor(startTime / 1000);
    const endTimeSec = Math.floor(endTime / 1000);

    // Query with inline values (validated inputs)
    const query = `
      SELECT
        event_id as eventId,
        event_type as eventType,
        name,
        country,
        currency,
        toUnixTimestamp(timestamp) * 1000 as ts,
        impact,
        actual,
        forecast,
        previous,
        description,
        datetime_utc as datetimeUtc,
        datetime_new_york as datetimeNewYork,
        datetime_london as datetimeLondon
      FROM news_events
      WHERE timestamp >= fromUnixTimestamp(${startTimeSec})
        AND timestamp <= fromUnixTimestamp(${endTimeSec})
        AND currency IN ('${base}', '${quote}')
        ${impactClause}
      ORDER BY timestamp ASC
      LIMIT 500
    `;

    const result = await clickhouse.query({
      query,
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as RawHistoricalEventRow[];

  return rows.map((row) => ({
    eventId: row.eventId,
    eventType: row.eventType || "Unknown",
    name: row.name,
    country: row.country,
    currency: row.currency,
    timestamp:
      typeof row.ts === "string"
        ? parseInt(row.ts, 10)
        : Number(row.ts),
    impact: row.impact || "None",
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    description: row.description,
    datetimeUtc: row.datetimeUtc,
    datetimeNewYork: row.datetimeNewYork,
    datetimeLondon: row.datetimeLondon,
  }));
  } catch (error) {
    console.error("[ClickHouse] Error fetching events:", error);
    return []; // Return empty array to not break chart loading
  }
}
