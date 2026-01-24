import { NextRequest, NextResponse } from "next/server";
import { getCandlesInRange, getEstimatedRangeCount } from "../../../../../lib/db/candles";

/**
 * GET /api/candles/range
 *
 * Optimized endpoint for fetching candles within a date range.
 * Single query instead of pagination - much faster for 1M, 3M, 6M, 1Y, ALL presets.
 *
 * Query params:
 * - pair: Currency pair (required, e.g., "EUR_USD")
 * - timeframe: Timeframe (required, e.g., "H1")
 * - from: Start timestamp in ms (optional, null = earliest)
 * - to: End timestamp in ms (optional, null = latest)
 * - limit: Max candles (optional, default: 100000)
 *
 * Response:
 * - candles: Array of candle objects sorted ascending by time
 * - count: Number of candles returned
 * - range: { from, to } timestamps of actual data
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const limitParam = searchParams.get("limit");

  if (!pair || !timeframe) {
    return NextResponse.json(
      { error: "Missing required parameters: pair and timeframe" },
      { status: 400 }
    );
  }

  const from = fromParam ? parseInt(fromParam, 10) : null;
  const to = toParam ? parseInt(toParam, 10) : null;
  const limit = limitParam ? parseInt(limitParam, 10) : 100000;

  // Validate timestamps
  if (fromParam && isNaN(from!)) {
    return NextResponse.json({ error: "Invalid from timestamp" }, { status: 400 });
  }
  if (toParam && isNaN(to!)) {
    return NextResponse.json({ error: "Invalid to timestamp" }, { status: 400 });
  }

  try {
    const candles = await getCandlesInRange(pair, timeframe, from, to, limit);

    // Get range from actual data
    const range = candles.length > 0
      ? {
          from: candles[0].timestamp,
          to: candles[candles.length - 1].timestamp,
        }
      : null;

    return NextResponse.json({
      candles,
      count: candles.length,
      range,
    });
  } catch (error) {
    console.error("Error fetching candle range:", error);
    return NextResponse.json(
      { error: "Failed to fetch candles" },
      { status: 500 }
    );
  }
}

/**
 * HEAD /api/candles/range
 *
 * Get estimated count without fetching data (fast metadata query).
 * Returns count in X-Total-Count header.
 */
export async function HEAD(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (!pair || !timeframe) {
    return new NextResponse(null, { status: 400 });
  }

  const from = fromParam ? parseInt(fromParam, 10) : null;
  const to = toParam ? parseInt(toParam, 10) : null;

  try {
    const count = await getEstimatedRangeCount(pair, timeframe, from, to);

    return new NextResponse(null, {
      status: 200,
      headers: {
        "X-Total-Count": count.toString(),
      },
    });
  } catch (error) {
    console.error("Error getting range count:", error);
    return new NextResponse(null, { status: 500 });
  }
}
