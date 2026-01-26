import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * GET /api/strategies/[id]/visuals
 *
 * Returns the visuals.json for a strategy, which defines:
 * - Indicator configurations (EMA, SMA, ATR, etc.)
 * - Custom indicator references
 * - Marker conditions
 * - Zone definitions
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Read visuals.json from the strategy folder
    const visualsPath = path.join(
      process.cwd(),
      "strategies",
      id,
      "visuals.json"
    );

    const visualsContent = await readFile(visualsPath, "utf-8");
    const visuals = JSON.parse(visualsContent);

    return NextResponse.json(visuals);
  } catch (error) {
    // Check if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "Strategy visuals not found", strategyId: id },
        { status: 404 }
      );
    }

    console.error("Error reading strategy visuals:", error);
    return NextResponse.json(
      { error: "Failed to read strategy visuals" },
      { status: 500 }
    );
  }
}
