import { NextRequest, NextResponse } from "next/server";
import { getLatestCOTForPair, generateCOTSummary } from "@/lib/db/cot";
import { getCOTExtremes } from "@/lib/db/clickhouse-cot";

/**
 * GET /api/cot/context
 *
 * Get Claude-formatted COT context for a pair.
 * Used by the chart context endpoint to enrich Claude's analysis.
 *
 * Query params:
 * - pair: string (required, e.g. "EUR_USD")
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get("pair");

  if (!pair) {
    return NextResponse.json(
      { error: "pair parameter is required" },
      { status: 400 }
    );
  }

  try {
    const [position, extremes] = await Promise.all([
      getLatestCOTForPair(pair),
      getCOTExtremes(pair, 156), // 3-year lookback
    ]);

    if (!position) {
      return NextResponse.json({
        pair,
        available: false,
        summary: `No COT positioning data available for ${pair.replace("_", "/")}.`,
        timestamp: Date.now(),
      });
    }

    const summary = generateCOTSummary(position, position.sentiment);

    return NextResponse.json({
      pair,
      available: true,
      reportDate: position.report_date,
      levMoneyNet: position.lev_money_net_positions,
      levMoneyChange: position.weekly_change_lev_money,
      assetMgrNet: position.asset_mgr_net_positions,
      dealerNet: position.dealer_net_positions,
      sentiment: position.sentiment,
      percentile: position.lev_money_percentile,
      isExtreme: position.sentiment.isExtreme,
      extremes: extremes
        ? {
            threeYearHigh: extremes.max_lev_money_net,
            threeYearLow: extremes.min_lev_money_net,
            threeYearPercentile: extremes.current_percentile,
          }
        : null,
      summary,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[COT Context API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch COT context", details: String(error) },
      { status: 500 }
    );
  }
}
