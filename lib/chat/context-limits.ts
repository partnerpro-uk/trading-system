/**
 * Chat Context Limits
 *
 * Model context windows, compaction/splitting thresholds,
 * and token estimation utilities.
 */

import type { ChatModel } from "./types";

export const CONTEXT_LIMITS: Record<ChatModel, number> = {
  haiku: 200_000,
  sonnet: 200_000,
  opus: 1_000_000,
};

export const COMPACTION_THRESHOLD = 0.7;
export const SPLIT_THRESHOLD = 0.9;

export function getCompactionThreshold(model: ChatModel): number {
  return Math.floor(CONTEXT_LIMITS[model] * COMPACTION_THRESHOLD);
}

export function getSplitThreshold(model: ChatModel): number {
  return Math.floor(CONTEXT_LIMITS[model] * SPLIT_THRESHOLD);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getTokenBarColor(
  tokens: number,
  model: ChatModel
): "green" | "yellow" | "red" {
  const limit = CONTEXT_LIMITS[model];
  const ratio = tokens / limit;
  if (ratio < 0.6) return "green";
  if (ratio < 0.8) return "yellow";
  return "red";
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
