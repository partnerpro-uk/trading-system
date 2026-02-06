import { NextRequest, NextResponse } from "next/server";
import { getLatestCOTPositions, getLatestCOTForPair } from "@/lib/db/cot";

/**
 * GET /api/cot/latest
 *
 * Fetch latest COT positioning data with sentiment classification.
 *
 * Query params:
 * - pair: string (optional, e.g. "EUR_USD") — if omitted, returns all pairs
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get("pair");

  try {
    if (pair) {
      const position = await getLatestCOTForPair(pair);
      if (!position) {
        return NextResponse.json(
          { error: `No COT data found for ${pair}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ position, timestamp: Date.now() });
    }

    const positions = await getLatestCOTPositions();
    return NextResponse.json({ positions, timestamp: Date.now() });
  } catch (error) {
    console.error("[COT Latest API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch COT data", details: String(error) },
      { status: 500 }
    );
  }
}
