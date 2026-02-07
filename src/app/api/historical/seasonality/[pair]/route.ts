/**
 * Seasonal Bias API
 *
 * GET /api/historical/seasonality/[pair]?timeframe=D
 *
 * Returns quarterly/monthly directional bias from BOS events.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSeasonalBias } from "@/lib/db/clickhouse-structure";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;
  const timeframe = request.nextUrl.searchParams.get("timeframe") || undefined;

  try {
    const rawBias = await getSeasonalBias(pair, timeframe);

    // Group by quarter/month and compute net bias
    const grouped = new Map<string, { bullish: number; bearish: number; avgMagnitude: number }>();

    for (const row of rawBias) {
      const key = `${row.quarter}-${row.month}`;
      if (!grouped.has(key)) {
        grouped.set(key, { bullish: 0, bearish: 0, avgMagnitude: 0 });
      }
      const entry = grouped.get(key)!;
      if (row.direction === "bullish") {
        entry.bullish = row.bosCount;
        entry.avgMagnitude = row.avgMagnitudePips;
      } else if (row.direction === "bearish") {
        entry.bearish = row.bosCount;
      }
    }

    const seasonal = Array.from(grouped.entries()).map(([key, val]) => {
      const [quarter, month] = key.split("-").map(Number);
      const total = val.bullish + val.bearish;
      return {
        quarter,
        month,
        bullishCount: val.bullish,
        bearishCount: val.bearish,
        netBias: total > 0 ? ((val.bullish - val.bearish) / total * 100).toFixed(1) : "0",
        avgMagnitude: val.avgMagnitude,
      };
    });

    return NextResponse.json({ pair, timeframe: timeframe || "all", seasonal });
  } catch (error) {
    console.error("[Seasonality] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch seasonal bias", details: String(error) },
      { status: 500 }
    );
  }
}
