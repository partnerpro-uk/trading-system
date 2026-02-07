/**
 * FVG Effectiveness API
 *
 * GET /api/historical/fvg-effectiveness/[pair]?timeframe=H4
 *
 * Returns FVG fill rates, timing, and gap sizes from materialized view.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFVGEffectiveness } from "@/lib/db/clickhouse-structure";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;
  const timeframe = request.nextUrl.searchParams.get("timeframe") || undefined;

  try {
    const stats = await getFVGEffectiveness(pair, timeframe);

    return NextResponse.json({ pair, timeframe: timeframe || "all", stats });
  } catch (error) {
    console.error("[FVG Effectiveness] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch FVG effectiveness", details: String(error) },
      { status: 500 }
    );
  }
}
