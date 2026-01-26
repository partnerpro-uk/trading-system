/**
 * API Route: Drawings
 *
 * REST API for chart drawings.
 * Note: Drawings are primarily managed via Zustand store with localStorage persistence.
 * This API can be used for server-side operations or Convex sync.
 */

import { NextRequest, NextResponse } from "next/server";

// Since drawings are stored in Zustand with localStorage, this API
// is primarily for potential server-side sync operations.
// For client-side use, interact directly with the useDrawingStore hook.

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");

  if (!pair || !timeframe) {
    return NextResponse.json(
      { error: "Missing required parameters: pair and timeframe" },
      { status: 400 }
    );
  }

  // For now, return empty - drawings are managed client-side
  // In future, this could sync with Convex
  return NextResponse.json({
    pair,
    timeframe,
    drawings: [],
    note: "Drawings are managed client-side via Zustand store. Use useChartDrawings hook.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pair, timeframe, drawings } = body;

    if (!pair || !timeframe) {
      return NextResponse.json(
        { error: "Missing required parameters: pair and timeframe" },
        { status: 400 }
      );
    }

    // This endpoint could be used to sync drawings to Convex
    // For now, acknowledge receipt
    return NextResponse.json({
      success: true,
      pair,
      timeframe,
      count: drawings?.length || 0,
      note: "Drawings received. For full persistence, use Convex directly.",
    });
  } catch (error) {
    console.error("Failed to process drawings:", error);
    return NextResponse.json(
      { error: "Failed to process drawings" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pair = searchParams.get("pair");
  const timeframe = searchParams.get("timeframe");
  const id = searchParams.get("id");

  if (!pair || !timeframe) {
    return NextResponse.json(
      { error: "Missing required parameters: pair and timeframe" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    deleted: id || "all",
    note: "Drawings are managed client-side. Use useChartDrawings hook.",
  });
}
