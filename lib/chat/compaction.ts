/**
 * Chat Context Compaction
 *
 * When a conversation approaches the model's context limit,
 * older messages are summarized into a compact block via Haiku.
 * The summary preserves key trading data: prices, drawing IDs,
 * analysis conclusions, and open positions.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODEL_IDS } from "./types";

const SUMMARIZATION_PROMPT = `Summarize this trading conversation between a trader and Claude.
Preserve ALL of the following:
- Specific price levels mentioned (support, resistance, entries, stops, targets)
- Drawing IDs that were created or modified (so Claude can reference them later)
- Key analysis conclusions and the reasoning behind them
- Any open positions, pending signals, or active trade ideas
- The trader's current bias, plan, and any rules/preferences they stated
- Institutional/COT positioning discussed
- Important events or news mentioned

Be concise but precise with numbers. Use bullet points.
Do NOT include pleasantries or meta-commentary about the conversation.`;

export async function compactMessages(
  messages: { role: "user" | "assistant"; content: string }[],
  keepRecentCount: number = 12
): Promise<{
  summary: string;
  compactedUpToIndex: number;
  summaryTokenEstimate: number;
}> {
  const compactedUpToIndex = Math.max(0, messages.length - keepRecentCount);
  if (compactedUpToIndex <= 2) {
    throw new Error("Not enough messages to compact");
  }

  const olderMessages = messages.slice(0, compactedUpToIndex);

  const conversationText = olderMessages
    .map((m) => `${m.role === "user" ? "Trader" : "Claude"}: ${m.content}`)
    .join("\n\n");

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await anthropic.messages.create({
    model: MODEL_IDS.haiku,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `${SUMMARIZATION_PROMPT}\n\n---\n\n${conversationText}`,
      },
    ],
  });

  const summary = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    summary,
    compactedUpToIndex,
    summaryTokenEstimate: Math.ceil(summary.length / 4),
  };
}
