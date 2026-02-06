/**
 * Tool Result Callback
 *
 * Receives results from client-side tool execution (drawings).
 * Currently a simple acknowledgment — in a future iteration this
 * could feed results back into an active streaming session.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { toolUseId, result } = body;

    if (!toolUseId) {
      return NextResponse.json(
        { error: "toolUseId is required" },
        { status: 400 }
      );
    }

    // For now, simply acknowledge the result
    // In a more sophisticated implementation, this would feed back
    // into the active streaming session via a shared state mechanism
    return NextResponse.json({
      received: true,
      toolUseId,
      success: result?.success ?? true,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
