/**
 * BOS Follow-Through Patterns API
 *
 * GET /api/historical/bos-patterns/[pair]?timeframe=H4
 *
 * Returns BOS continuation rates, reclaim rates, and displacement frequency.
 */

import { NextRequest, NextResponse } from "next/server";
import { getBOSFollowThrough } from "@/lib/db/clickhouse-structure";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;
  const timeframe = request.nextUrl.searchParams.get("timeframe") || undefined;

  try {
    const stats = await getBOSFollowThrough(pair, timeframe);

    return NextResponse.json({ pair, timeframe: timeframe || "all", stats });
  } catch (error) {
    console.error("[BOS Patterns] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch BOS patterns", details: String(error) },
      { status: 500 }
    );
  }
}
