/**
 * Chart Context API
 *
 * Returns drawing context for Claude to understand chart state.
 * Provides semantic understanding of chart annotations.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Drawing,
  isHorizontalLineDrawing,
  isFibonacciDrawing,
  isRectangleDrawing,
  isPositionDrawing,
  isLongPositionDrawing,
  isTrendlineDrawing,
} from "@/lib/drawings/types";
import {
  describeDrawing,
  describeAllDrawings,
  extractKeyLevels,
  isNearPrice,
  isPriceAbove,
  isPriceBelow,
} from "@/lib/drawings/describe";
import { getColorName } from "@/lib/drawings/colors";
import { getLatestCOTForPair, generateCOTSummary } from "@/lib/db/cot";

/**
 * Parse query parameters
 */
function parseParams(req: NextRequest): {
  pair: string;
  timeframe: string;
  currentPrice: number | null;
  thresholdPips: number;
} {
  const url = new URL(req.url);
  const pair = url.searchParams.get("pair") || "";
  const timeframe = url.searchParams.get("timeframe") || "";
  const currentPriceStr = url.searchParams.get("currentPrice");
  const currentPrice = currentPriceStr ? parseFloat(currentPriceStr) : null;
  const thresholdPips = parseInt(url.searchParams.get("thresholdPips") || "20", 10);

  return { pair, timeframe, currentPrice, thresholdPips };
}

/**
 * Group drawings by type
 */
function groupByType(drawings: Drawing[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const d of drawings) {
    groups[d.type] = (groups[d.type] || 0) + 1;
  }
  return groups;
}

/**
 * GET /api/chart/context
 *
 * Returns drawing context for Claude to understand chart state.
 *
 * Query params:
 * - pair: Currency pair (e.g., "EUR_USD")
 * - timeframe: Timeframe (e.g., "M15")
 * - currentPrice: Current price (optional, for proximity filtering)
 * - thresholdPips: Pips threshold for "nearby" (default 20)
 *
 * Note: This endpoint reads drawings from localStorage via client-side request.
 * In production, you would read from Convex/database instead.
 * For now, the client should include drawings in the request body (POST).
 */
export async function GET(req: NextRequest) {
  const { pair, timeframe, currentPrice, thresholdPips } = parseParams(req);

  if (!pair || !timeframe) {
    return NextResponse.json(
      { error: "Missing required params: pair, timeframe" },
      { status: 400 }
    );
  }

  // In a real implementation, we would fetch drawings from the database here
  // For now, return the structure for client-side usage
  return NextResponse.json({
    message: "Use POST with drawings in body, or call from client with useDrawingContext hook",
    requiredParams: {
      pair,
      timeframe,
      currentPrice: currentPrice || "optional - for proximity filtering",
      thresholdPips,
    },
  });
}

/**
 * POST /api/chart/context
 *
 * Returns drawing context given drawings in the request body.
 * This allows the client to send current drawings for analysis.
 *
 * Request body:
 * {
 *   pair: string,
 *   timeframe: string,
 *   currentPrice: number,
 *   drawings: Drawing[],
 *   thresholdPips?: number
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pair, timeframe, currentPrice, drawings, thresholdPips = 20 } = body;

    if (!pair || !timeframe || !drawings || !Array.isArray(drawings)) {
      return NextResponse.json(
        { error: "Missing required fields: pair, timeframe, drawings" },
        { status: 400 }
      );
    }

    // Generate drawing context + fetch COT data in parallel
    const [context, cotPosition] = await Promise.all([
      Promise.resolve(generateContext(drawings, currentPrice, thresholdPips)),
      getLatestCOTForPair(pair).catch(() => null),
    ]);

    // Build institutional context if available
    let institutional = null;
    if (cotPosition) {
      institutional = {
        pair,
        reportDate: cotPosition.report_date,
        levMoneyNet: cotPosition.lev_money_net_positions,
        levMoneyChange: cotPosition.weekly_change_lev_money,
        assetMgrNet: cotPosition.asset_mgr_net_positions,
        dealerNet: cotPosition.dealer_net_positions,
        sentiment: cotPosition.sentiment,
        percentile: cotPosition.lev_money_percentile,
        isExtreme: cotPosition.sentiment.isExtreme,
        summary: generateCOTSummary(cotPosition, cotPosition.sentiment),
      };
    }

    return NextResponse.json({
      chartState: {
        pair,
        timeframe,
        currentPrice,
      },
      ...context,
      institutional,
    });
  } catch (error) {
    console.error("Error generating chart context:", error);
    return NextResponse.json(
      { error: "Failed to generate context" },
      { status: 500 }
    );
  }
}

/**
 * Generate Claude-friendly context from drawings
 */
function generateContext(
  drawings: Drawing[],
  currentPrice: number | null,
  thresholdPips: number
) {
  // Summary description
  const summary = currentPrice
    ? describeAllDrawings(drawings, currentPrice, thresholdPips)
    : `${drawings.length} drawings on chart`;

  // Individual descriptions
  const descriptions = drawings.map((d) => ({
    id: d.id,
    type: d.type,
    description: describeDrawing(d),
    label: d.label,
    tags: d.tags,
    notes: d.notes,
    importance: d.importance,
    createdBy: d.createdBy,
  }));

  // Extract key levels if we have current price
  const keyLevels = currentPrice
    ? extractKeyLevels(drawings, currentPrice)
    : [];

  // Horizontal lines
  const horizontalLines = drawings
    .filter(isHorizontalLineDrawing)
    .map((d) => ({
      id: d.id,
      price: d.price,
      label: d.label,
      color: d.color,
      colorName: getColorName(d.color),
    }));

  // Fibonacci levels
  const fibLevels = drawings
    .filter(isFibonacciDrawing)
    .flatMap((d) =>
      d.levels.map((level) => ({
        price: d.anchor1.price + (d.anchor2.price - d.anchor1.price) * level,
        level: `${(level * 100).toFixed(1)}%`,
        fibId: d.id,
        label: d.label,
      }))
    );

  // Positions
  const positions = drawings.filter(isPositionDrawing).map((d) => ({
    id: d.id,
    direction: isLongPositionDrawing(d) ? "long" : "short",
    entryPrice: d.entry.price,
    takeProfit: d.takeProfit,
    stopLoss: d.stopLoss,
    riskReward: d.riskRewardRatio,
    label: d.label,
    isActive: d.isActive,
  }));

  // Zones (rectangles)
  const zones = drawings.filter(isRectangleDrawing).map((d) => ({
    id: d.id,
    topPrice: Math.max(d.anchor1.price, d.anchor2.price),
    bottomPrice: Math.min(d.anchor1.price, d.anchor2.price),
    label: d.label,
    color: d.borderColor,
    colorName: getColorName(d.borderColor),
  }));

  // Trendlines
  const trendlines = drawings.filter(isTrendlineDrawing).map((d) => ({
    id: d.id,
    type: d.type,
    anchor1: d.anchor1,
    anchor2: d.anchor2,
    label: d.label,
    color: d.color,
    colorName: getColorName(d.color),
  }));

  // Group by position relative to price
  let resistance: typeof descriptions = [];
  let support: typeof descriptions = [];
  let nearby: typeof descriptions = [];

  if (currentPrice) {
    nearby = drawings
      .filter((d) => isNearPrice(d, currentPrice, thresholdPips))
      .map((d) => descriptions.find((desc) => desc.id === d.id)!);
    resistance = drawings
      .filter(
        (d) =>
          isPriceAbove(d, currentPrice) &&
          !isNearPrice(d, currentPrice, thresholdPips)
      )
      .map((d) => descriptions.find((desc) => desc.id === d.id)!);
    support = drawings
      .filter(
        (d) =>
          isPriceBelow(d, currentPrice) &&
          !isNearPrice(d, currentPrice, thresholdPips)
      )
      .map((d) => descriptions.find((desc) => desc.id === d.id)!);
  }

  return {
    summary,
    stats: {
      total: drawings.length,
      byType: groupByType(drawings),
      labeled: drawings.filter((d) => d.label).length,
      withNotes: drawings.filter((d) => d.notes).length,
      withTags: drawings.filter((d) => d.tags?.length).length,
    },
    drawings: {
      all: descriptions,
      horizontalLines,
      fibLevels,
      positions,
      zones,
      trendlines,
    },
    levels: {
      key: keyLevels,
      resistance,
      support,
      nearby,
    },
  };
}
