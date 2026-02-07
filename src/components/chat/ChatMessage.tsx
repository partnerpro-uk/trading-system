"use client";

import { useMemo } from "react";
import { Bot, User } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/lib/chat/types";
import { ToolCallCard } from "./ToolCallCard";
import { DrawingActionCard } from "./DrawingActionCard";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  const formattedTime = useMemo(() => {
    return new Date(message.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, [message.timestamp]);

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
          isUser ? "bg-blue-600" : "bg-gray-700"
        }`}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-white" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-gray-300" />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""}`}>
        {/* Drawing actions (before text) */}
        {message.drawingActions && message.drawingActions.length > 0 && (
          <div className="mb-1 space-y-1">
            {message.drawingActions.map((action) => (
              <DrawingActionCard key={action.toolCallId} action={action} />
            ))}
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-1 space-y-1">
            {message.toolCalls
              .filter((tc) => !tc.name.startsWith("draw_") && tc.name !== "remove_drawing" && tc.name !== "scroll_chart")
              .map((tc) => (
                <ToolCallCard key={tc.id} toolCall={tc} />
              ))}
          </div>
        )}

        {/* Text content */}
        {message.content && (
          <div
            className={`inline-block rounded-lg px-3 py-2 text-sm max-w-full ${
              isUser
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-100"
            }`}
          >
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
        )}

        {/* Timestamp + model */}
        <div className={`mt-0.5 text-[10px] text-gray-600 ${isUser ? "text-right" : ""}`}>
          {formattedTime}
          {message.model && !isUser && (
            <span className="ml-1.5 text-gray-700">
              {message.model === "sonnet" ? "Sonnet" : message.model === "opus" ? "Opus" : "Haiku"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
