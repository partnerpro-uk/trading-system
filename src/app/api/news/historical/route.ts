import { NextRequest, NextResponse } from "next/server";
import {
  getHistoricalEventsFromClickHouse,
  transformToDisplayFormat,
  HistoricalEventForDisplay,
} from "@/lib/db/clickhouse-news";

/**
 * GET /api/news/historical
 *
 * Fetch historical events of the same type for tooltip display.
 * Uses ClickHouse for historical analytics data.
 *
 * Query params:
 * - eventType: Event type (required, e.g., "UNEMPLOYMENT")
 * - pair: Currency pair (required, e.g., "EUR_USD")
 * - beforeTimestamp: Unix timestamp (ms) - only get events before this
 * - limit: Number of events per category (default: 5)
 *
 * Response includes:
 * - beatHistory: Events where actual beat forecast
 * - missHistory: Events where actual missed forecast
 * - rawHistory: Most recent events regardless of outcome
 * - hasForecastData: Whether forecast data is available
 *
 * All pip values are calculated from T-15 baseline (not T+0).
 * Extended windows (T+60, T+90) are included when available.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const eventType = searchParams.get("eventType");
  const pair = searchParams.get("pair");
  const beforeTimestampParam = searchParams.get("beforeTimestamp");
  const limitParam = searchParams.get("limit");

  if (!eventType || !pair || !beforeTimestampParam) {
    return NextResponse.json(
      { error: "Missing required parameters: eventType, pair, beforeTimestamp" },
      { status: 400 }
    );
  }

  const beforeTimestamp = parseInt(beforeTimestampParam, 10);
  const limit = limitParam ? parseInt(limitParam, 10) : 5;

  try {
    // Fetch from ClickHouse (historical analytics database)
    const events = await getHistoricalEventsFromClickHouse(
      eventType,
      pair,
      beforeTimestamp,
      limit * 4 // Fetch more to ensure we have enough beats/misses
    );

    // Transform to display format with T-15 baseline pips
    const displayEvents = transformToDisplayFormat(events, pair, eventType);

    // Classify events and build response
    const beatHistory: HistoricalEvent[] = [];
    const missHistory: HistoricalEvent[] = [];
    const rawHistory: HistoricalEvent[] = [];
    let hasForecastData = false;

    for (const event of displayEvents) {
      const eventData = mapToLegacyFormat(event);

      // Classify if both actual and forecast exist
      if (event.actualValue !== undefined && event.forecastValue !== undefined) {
        hasForecastData = true;

        if (event.outcome === "beat" && beatHistory.length < limit) {
          beatHistory.push(eventData);
        } else if (event.outcome === "miss" && missHistory.length < limit) {
          missHistory.push(eventData);
        }
      }

      if (rawHistory.length < limit) {
        rawHistory.push(eventData);
      }

      // Stop if we have enough
      if (beatHistory.length >= limit && missHistory.length >= limit && rawHistory.length >= limit) {
        break;
      }
    }

    return NextResponse.json({
      beatHistory,
      missHistory,
      rawHistory,
      hasForecastData,
    });
  } catch (error) {
    console.error("Error fetching historical events:", error);
    return NextResponse.json(
      { error: "Failed to fetch historical events" },
      { status: 500 }
    );
  }
}

/**
 * Map new display format to legacy format for backwards compatibility
 */
function mapToLegacyFormat(event: HistoricalEventForDisplay): HistoricalEvent {
  return {
    timestamp: event.timestamp,
    actualValue: event.actualValue,
    forecastValue: event.forecastValue,
    outcome: event.outcome,
    spikeMagnitudePips: event.spikeMagnitudePips,
    spikeDirection: event.spikeDirection,
    didReverse: event.didReverse,
    reversalMagnitudePips: event.reversalMagnitudePips,

    // Legacy price fields (raw prices)
    priceAtEvent: event.priceAtEvent,
    spikeHigh: event.spikeHigh,
    spikeLow: event.spikeLow,
    priceAtPlus5m: event.priceAtPlus5m ?? 0,
    priceAtPlus15m: event.priceAtPlus15m ?? 0,
    priceAtPlus30m: event.priceAtPlus30m ?? 0,
    priceAtPlus1hr: event.priceAtPlus60m ?? 0,

    // NEW: T-15 baseline for proper pip calculations
    priceAtMinus15m: event.priceAtMinus15m,

    // NEW: Extended windows (short-term)
    priceAtPlus60m: event.priceAtPlus60m ?? undefined,
    priceAtPlus90m: event.priceAtPlus90m ?? undefined,

    // NEW: Pips calculated from T-15 baseline
    pipsFromBaseline: {
      atEvent: event.pipsAtEvent,
      at5m: event.pipsAt5m,
      at15m: event.pipsAt15m,
      at30m: event.pipsAt30m,
      at60m: event.pipsAt60m,
      at90m: event.pipsAt90m,
      // Extended aftermath pips
      at2hr: event.pipsAt2hr,
      at4hr: event.pipsAt4hr,
      at8hr: event.pipsAt8hr,
      at24hr: event.pipsAt24hr,
    },

    // Pattern types
    patternType: event.patternType,
    extendedPatternType: event.extendedPatternType,

    // NEW: Window info
    windowMinutes: event.windowMinutes,
  };
}

interface HistoricalEvent {
  timestamp: number;
  actualValue?: number;
  forecastValue?: number;
  outcome: "beat" | "miss" | "inline";
  spikeMagnitudePips: number;
  spikeDirection: string;
  didReverse: boolean;
  reversalMagnitudePips?: number;

  // Legacy price fields (raw prices)
  priceAtEvent: number;
  spikeHigh: number;
  spikeLow: number;
  priceAtPlus5m: number;
  priceAtPlus15m: number;
  priceAtPlus30m: number;
  priceAtPlus1hr: number;

  // NEW: T-15 baseline for proper pip calculations
  priceAtMinus15m: number;

  // NEW: Extended windows (null if not available for this window type)
  priceAtPlus60m?: number;
  priceAtPlus90m?: number;

  // NEW: Pips calculated from T-15 baseline (more accurate than from T+0)
  pipsFromBaseline: {
    atEvent: number;
    at5m: number | null;
    at15m: number | null;
    at30m: number | null;
    at60m: number | null;
    at90m: number | null;
    // Extended aftermath pips
    at2hr: number | null;
    at4hr: number | null;
    at8hr: number | null;
    at24hr: number | null;
  };

  // Pattern types
  patternType: string;
  extendedPatternType: string | null;

  // NEW: Window type (30=standard, 75=high impact, 105=FOMC/ECB)
  windowMinutes: number;
}
