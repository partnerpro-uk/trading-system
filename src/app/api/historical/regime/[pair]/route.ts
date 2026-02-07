/**
 * Regime Classification API
 *
 * GET /api/historical/regime/[pair]?timeframe=H4
 *
 * Returns monthly regime classification (trending/ranging/volatile) based on BOS patterns.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRegimeClassification } from "@/lib/db/clickhouse-structure";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;
  const timeframe = request.nextUrl.searchParams.get("timeframe") || undefined;

  try {
    const stats = await getRegimeClassification(pair, timeframe);

    return NextResponse.json({ pair, timeframe: timeframe || "all", stats });
  } catch (error) {
    console.error("[Regime Classification] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch regime classification", details: String(error) },
      { status: 500 }
    );
  }
}
