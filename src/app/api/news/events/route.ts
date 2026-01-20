import { NextRequest, NextResponse } from "next/server";
import { getEventsWithReactions } from "@/lib/db/news";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * GET /api/news/events
 *
 * Fetch news events with reactions from TimescaleDB for chart display.
 * This endpoint queries TimescaleDB which contains recent events (30-day window).
 *
 * For historical event analysis (older than 30 days), use:
 * - /api/news/historical (queries ClickHouse)
 *
 * Query params:
 * - pair: Currency pair (required, e.g., "EUR_USD")
 * - startTime: Unix timestamp (ms) - start of time range
 * - endTime: Unix timestamp (ms) - end of time range
 * - impactFilter: "high" | "medium" | "low" | "all" (optional, default: "all")
 *
 * Note: startTime is clamped to 30 days ago to ensure queries stay within
 * TimescaleDB's retention window. Events older than 30 days are in ClickHouse.
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

  let startTime = parseInt(startTimeParam, 10);
  const endTime = parseInt(endTimeParam, 10);

  // Clamp startTime to 30 days ago - older events are in ClickHouse, not TimescaleDB
  const thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
  if (startTime < thirtyDaysAgo) {
    startTime = thirtyDaysAgo;
  }

  try {
    const events = await getEventsWithReactions(pair, startTime, endTime, impactFilter);

    return NextResponse.json({ events });
  } catch (error) {
    console.error("Error fetching news events:", error);
    return NextResponse.json(
      { error: "Failed to fetch news events" },
      { status: 500 }
    );
  }
}
