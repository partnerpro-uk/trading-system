import { NextRequest, NextResponse } from "next/server";
import { getUpcomingEvents } from "@/lib/db/clickhouse-news";

/**
 * GET /api/news/upcoming
 *
 * Fetch upcoming high/medium impact news events for sidebar display.
 * Returns the next 10 events within the coming week.
 *
 * Query params:
 * - limit: number (optional, default: 10)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  try {
    const events = await getUpcomingEvents(limit);

    return NextResponse.json({
      events,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[Upcoming Events API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch upcoming events", details: String(error) },
      { status: 500 }
    );
  }
}
