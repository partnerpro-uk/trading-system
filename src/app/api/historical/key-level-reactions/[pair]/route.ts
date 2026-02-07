/**
 * Key Level Reaction Rates API
 *
 * GET /api/historical/key-level-reactions/[pair]
 *
 * Returns bounce/break/sweep percentages at key levels (PDH, PDL, PWH, PWL, etc).
 */

import { NextRequest, NextResponse } from "next/server";
import { getKeyLevelReactionRates } from "@/lib/db/clickhouse-structure";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> }
) {
  const { pair } = await params;

  try {
    const stats = await getKeyLevelReactionRates(pair);

    return NextResponse.json({ pair, stats });
  } catch (error) {
    console.error("[Key Level Reactions] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch key level reaction rates", details: String(error) },
      { status: 500 }
    );
  }
}
