import { NextRequest, NextResponse } from "next/server";
import { getEventsInTimeRangeFromClickHouse, HistoricalNewsEvent } from "@/lib/db/clickhouse-news";

/**
 * GET /api/news/events
 *
 * Fetch news events for chart display from ClickHouse.
 * ClickHouse contains all historical events from 2023-01-01 onwards.
 *
 * Query params:
 * - pair: Currency pair (required, e.g., "EUR_USD")
 * - startTime: Unix timestamp (ms) - start of time range
 * - endTime: Unix timestamp (ms) - end of time range
 * - impactFilter: "high" | "medium" | "low" | "all" (optional, default: "all")
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const pair = searchParams.get("pair");
  const startTimeParam = searchParams.get("startTime");
  const endTimeParam = searchParams.get("endTime");
  const impactFilter = searchParams.get("impactFilter") || "all";

  // Validate required params
  if (!pair || !startTimeParam || !endTimeParam) {
    return NextResponse.json(
      { error: "Missing required parameters: pair, startTime, endTime" },
      { status: 400 }
    );
  }

  const startTime = parseInt(startTimeParam, 10);
  const endTime = parseInt(endTimeParam, 10);

  try {
    console.log(`[News API] Fetching events for ${pair} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

    // Query ClickHouse for all events - it has the complete dataset
    const events: HistoricalNewsEvent[] = await getEventsInTimeRangeFromClickHouse(
      pair,
      startTime,
      endTime,
      impactFilter
    );

    console.log(`[News API] Found ${events.length} events`);
    return NextResponse.json({ events });
  } catch (error) {
    console.error("[News API] Error fetching news events:", error);
    return NextResponse.json(
      { error: "Failed to fetch news events", details: String(error) },
      { status: 500 }
    );
  }
}
