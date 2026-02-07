"use client";

import type { ChatModel } from "@/lib/chat/types";
import {
  CONTEXT_LIMITS,
  getTokenBarColor,
  formatTokenCount,
} from "@/lib/chat/context-limits";

interface TokenBarProps {
  inputTokens: number;
  model: ChatModel;
  compact?: boolean;
}

export function TokenBar({ inputTokens, model, compact = false }: TokenBarProps) {
  const limit = CONTEXT_LIMITS[model];
  const ratio = Math.min(inputTokens / limit, 1);
  const color = getTokenBarColor(inputTokens, model);

  const barColors = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
  };

  const textColors = {
    green: "text-gray-500",
    yellow: "text-yellow-400",
    red: "text-red-400",
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColors[color]} rounded-full transition-all`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <span className={`text-[9px] ${textColors[color]}`}>
          {formatTokenCount(inputTokens)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-[10px] font-mono ${textColors[color]}`}>
        {formatTokenCount(inputTokens)}/{formatTokenCount(limit)}
      </span>
      <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColors[color]} rounded-full transition-all`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
