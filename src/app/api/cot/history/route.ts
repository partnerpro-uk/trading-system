import { NextRequest, NextResponse } from "next/server";
import { getCOTHistory } from "@/lib/db/cot";

/**
 * GET /api/cot/history
 *
 * Fetch weekly COT history for the positioning mini-chart.
 *
 * Query params:
 * - pair: string (required, e.g. "EUR_USD")
 * - weeks: number (optional, default: 52)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get("pair");
  const weeks = parseInt(searchParams.get("weeks") || "52", 10);

  if (!pair) {
    return NextResponse.json(
      { error: "pair parameter is required" },
      { status: 400 }
    );
  }

  try {
    const history = await getCOTHistory(pair, weeks);
    return NextResponse.json({ pair, weeks, history, timestamp: Date.now() });
  } catch (error) {
    console.error("[COT History API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch COT history", details: String(error) },
      { status: 500 }
    );
  }
}
