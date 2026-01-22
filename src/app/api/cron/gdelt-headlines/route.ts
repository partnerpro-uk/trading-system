/**
 * GDELT Headlines Cron Endpoint
 *
 * Runs every 6 hours to fetch geopolitical news from GDELT.
 * Stores high-importance headlines to news_headlines table.
 *
 * Schedule: "0 0,6,12,18 * * *" (every 6 hours)
 */

import { NextResponse } from "next/server";
import { fetchGDELTHeadlines } from "@/lib/gdelt/monitor";

export async function GET(request: Request) {
  // Verify cron secret (if deployed to Vercel)
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    console.log("===== GDELT Headlines Fetch Started =====");

    const result = await fetchGDELTHeadlines();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("===== GDELT Headlines Fetch Complete =====");
    console.log(`  Fetched: ${result.fetched}`);
    console.log(`  High importance: ${result.highImportance}`);
    console.log(`  Inserted: ${result.inserted}`);
    console.log(`  Duration: ${duration}s`);

    return NextResponse.json({
      success: true,
      ...result,
      duration: `${duration}s`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("GDELT cron error:", error);

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

// Enable Vercel cron - use Edge or Node.js runtime
export const runtime = "nodejs";
