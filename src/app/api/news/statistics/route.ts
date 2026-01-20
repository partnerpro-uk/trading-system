import { NextRequest, NextResponse } from "next/server";
import { getEventTypeStatistics } from "@/lib/db/clickhouse-news";

/**
 * GET /api/news/statistics
 *
 * Get aggregated statistics for an event type from ClickHouse.
 *
 * Query params:
 * - eventType: Event type (required, e.g., "UNEMPLOYMENT")
 * - pair: Currency pair (required, e.g., "EUR_USD")
 *
 * Response:
 * - totalOccurrences: Number of historical events
 * - avgSpikePips: Average spike magnitude
 * - upCount/downCount: Direction statistics
 * - reversalRate: How often price reverses after initial spike
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const eventType = searchParams.get("eventType");
  const pair = searchParams.get("pair");

  if (!eventType || !pair) {
    return NextResponse.json(
      { error: "Missing required parameters: eventType, pair" },
      { status: 400 }
    );
  }

  try {
    const stats = await getEventTypeStatistics(eventType, pair);

    if (!stats) {
      return NextResponse.json({
        eventType,
        pair,
        totalOccurrences: 0,
        avgSpikePips: null,
        upCount: 0,
        downCount: 0,
        reversalRate: null,
        upBias: null,
      });
    }

    // Calculate directional bias
    const total = stats.upCount + stats.downCount;
    const upBias = total > 0 ? (stats.upCount / total) * 100 : null;

    return NextResponse.json({
      ...stats,
      pair,
      upBias: upBias !== null ? Math.round(upBias * 10) / 10 : null,
    });
  } catch (error) {
    console.error("Error fetching event statistics:", error);
    return NextResponse.json(
      { error: "Failed to fetch event statistics" },
      { status: 500 }
    );
  }
}
