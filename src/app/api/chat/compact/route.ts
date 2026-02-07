/**
 * Chat Compaction API
 *
 * Summarizes older messages into a compact summary using Haiku.
 * Called by the useChat hook when cumulative tokens approach the model limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { compactMessages } from "@/lib/chat/compaction";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: { messages: { role: "user" | "assistant"; content: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages) || messages.length < 14) {
    return NextResponse.json(
      { error: "Need at least 14 messages to compact (keeps 12 recent)" },
      { status: 400 }
    );
  }

  try {
    const result = await compactMessages(messages);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Compaction failed",
      },
      { status: 500 }
    );
  }
}
