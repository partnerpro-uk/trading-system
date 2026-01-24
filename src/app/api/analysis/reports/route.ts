import { NextRequest, NextResponse } from "next/server";
import {
  getReports,
  saveReport,
  initReportsTable,
  type AnalysisReport,
} from "../../../../../lib/db/reports";

// Ensure table exists on first request
let tableInitialized = false;

async function ensureTable() {
  if (!tableInitialized) {
    try {
      await initReportsTable();
      tableInitialized = true;
    } catch (error) {
      console.error("Failed to initialize reports table:", error);
      // Continue anyway - table might already exist
      tableInitialized = true;
    }
  }
}

/**
 * GET /api/analysis/reports
 * List analysis reports, optionally filtered by pair/timeframe
 */
export async function GET(request: NextRequest) {
  try {
    await ensureTable();

    const searchParams = request.nextUrl.searchParams;
    const pair = searchParams.get("pair") || undefined;
    const timeframe = searchParams.get("timeframe") || undefined;
    const limitStr = searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    const reports = await getReports({ pair, timeframe, limit });

    return NextResponse.json({
      reports,
      count: reports.length,
    });
  } catch (error) {
    console.error("Error fetching reports:", error);
    return NextResponse.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/analysis/reports
 * Save a new analysis report
 */
export async function POST(request: NextRequest) {
  try {
    await ensureTable();

    const body = await request.json();

    // Validate required fields
    const requiredFields = [
      "pair",
      "timeframe",
      "model",
      "tpDist",
      "slDist",
      "chunkBars",
      "totalTrades",
      "wins",
      "losses",
      "winRate",
      "profitFactor",
      "totalPnl",
    ];

    for (const field of requiredFields) {
      if (body[field] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    const reportData: Omit<AnalysisReport, "id" | "createdAt"> = {
      pair: body.pair,
      timeframe: body.timeframe,
      model: body.model,
      tpDist: body.tpDist,
      slDist: body.slDist,
      chunkBars: body.chunkBars,
      featureLevels: body.featureLevels || {},
      aiMethod: body.aiMethod || "off",
      aiModalities: body.aiModalities || [],
      totalTrades: body.totalTrades,
      wins: body.wins,
      losses: body.losses,
      winRate: body.winRate,
      profitFactor: body.profitFactor,
      totalPnl: body.totalPnl,
      avgPnl: body.avgPnl || 0,
      sharpe: body.sharpe || 0,
      sortino: body.sortino || 0,
      candlesStart: new Date(body.candlesStart || body.candleRange?.from || Date.now()),
      candlesEnd: new Date(body.candlesEnd || body.candleRange?.to || Date.now()),
      candleCount: body.candleCount || 0,
      notes: body.notes || "",
    };

    const id = await saveReport(reportData);

    return NextResponse.json({
      id,
      message: "Report saved successfully",
    });
  } catch (error) {
    console.error("Error saving report:", error);
    return NextResponse.json(
      { error: "Failed to save report" },
      { status: 500 }
    );
  }
}
