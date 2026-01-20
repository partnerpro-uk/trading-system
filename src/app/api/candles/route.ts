import { NextRequest, NextResponse } from "next/server";
import { getLatestCandles, getCandlesBefore, getCandleCount } from "@/lib/db/candles";

/**
 * GET /api/candles
 *
 * Fetch candles from dual-database (Timescale + ClickHouse) for chart display.
 *
 * Query params:
 * - pair: Currency pair (required, e.g., "EUR_USD")
 * - timeframe: Timeframe (required, e.g., "M15")
 * - limit: Max candles to return (optional, default: 500)
 * - before: Unix timestamp (ms) - fetch candles before this time (for scroll-back)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");
  const limitParam = searchParams.get("limit");
  const beforeParam = searchParams.get("before");

  // Validate required params
  if (!pair || !timeframe) {
    return NextResponse.json(
      { error: "Missing required parameters: pair and timeframe" },
      { status: 400 }
    );
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 500;

  try {
    let candles;

    if (beforeParam) {
      // Scroll-back: fetch candles before the given timestamp
      const beforeTimestamp = parseInt(beforeParam, 10);
      candles = await getCandlesBefore(pair, timeframe, beforeTimestamp, limit);
    } else {
      // Initial load: get latest candles
      candles = await getLatestCandles(pair, timeframe, limit);
    }

    return NextResponse.json({ candles });
  } catch (error) {
    console.error("Error fetching candles:", error);
    return NextResponse.json(
      { error: "Failed to fetch candles" },
      { status: 500 }
    );
  }
}

/**
 * HEAD /api/candles
 *
 * Get candle count without fetching data (useful for pagination info).
 */
export async function HEAD(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");

  if (!pair || !timeframe) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const count = await getCandleCount(pair, timeframe);

    return new NextResponse(null, {
      status: 200,
      headers: {
        "X-Total-Count": count.toString(),
      },
    });
  } catch (error) {
    console.error("Error getting candle count:", error);
    return new NextResponse(null, { status: 500 });
  }
}
