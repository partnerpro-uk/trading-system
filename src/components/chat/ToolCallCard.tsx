"use client";

import { Database, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { ToolCall } from "@/lib/chat/types";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const TOOL_LABELS: Record<string, string> = {
  get_candles: "Fetching candles",
  get_current_price: "Getting price",
  get_news_events: "Loading events",
  get_event_statistics: "Loading event stats",
  get_headlines: "Searching headlines",
  get_cot_positioning: "Loading COT data",
  get_cot_history: "Loading COT history",
  get_trade_history: "Loading trades",
  get_trade_stats: "Loading trade stats",
};

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const label = TOOL_LABELS[toolCall.name] || toolCall.name;
  const isLoading = toolCall.status === "pending" || toolCall.status === "running";
  const isError = toolCall.status === "error";
  const isComplete = toolCall.status === "complete";

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800/50 rounded border border-gray-700 text-xs">
      <Database className="w-3 h-3 text-gray-500 shrink-0" />
      <span className="text-gray-400 truncate">{label}</span>
      <div className="ml-auto shrink-0">
        {isLoading && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
        {isComplete && <CheckCircle2 className="w-3 h-3 text-green-400" />}
        {isError && <XCircle className="w-3 h-3 text-red-400" />}
      </div>
    </div>
  );
}
