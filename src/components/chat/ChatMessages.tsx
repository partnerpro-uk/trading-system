"use client";

import { useEffect, useRef } from "react";
import { useChatStore } from "@/lib/chat/store";
import { ChatMessage } from "./ChatMessage";
import { Bot, Loader2 } from "lucide-react";

export function ChatMessages() {
  const { messages, isStreaming, streamingContent, streamingToolCalls, streamingDrawingActions } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, streamingToolCalls]);

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
      {!hasMessages && (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <Bot className="w-10 h-10 text-gray-600 mb-3" />
          <p className="text-sm text-gray-400 mb-1">Ask Claude about the chart</p>
          <p className="text-xs text-gray-600 max-w-[200px]">
            Analyze setups, draw levels, check news events, or review COT positioning
          </p>
        </div>
      )}

      {/* Existing messages */}
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}

      {/* Streaming assistant message */}
      {isStreaming && (
        <div className="flex gap-2">
          <div className="shrink-0 w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-gray-300" />
          </div>
          <div className="flex-1 min-w-0">
            {/* Streaming drawing actions */}
            {streamingDrawingActions.length > 0 && (
              <div className="mb-1 space-y-1">
                {streamingDrawingActions.map((action) => (
                  <div
                    key={action.toolCallId}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-900/30 rounded border border-blue-800/50 text-xs"
                  >
                    <span className="text-gray-300 truncate">{action.description}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Streaming tool calls */}
            {streamingToolCalls.length > 0 && (
              <div className="mb-1 space-y-1">
                {streamingToolCalls
                  .filter((tc) => !tc.name.startsWith("draw_") && tc.name !== "remove_drawing" && tc.name !== "scroll_chart")
                  .map((tc) => (
                    <div
                      key={tc.id}
                      className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800/50 rounded border border-gray-700 text-xs"
                    >
                      <span className="text-gray-400 truncate">{tc.name.replace(/_/g, " ")}</span>
                      {(tc.status === "pending" || tc.status === "running") && (
                        <Loader2 className="w-3 h-3 text-blue-400 animate-spin ml-auto shrink-0" />
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* Streaming text */}
            {streamingContent ? (
              <div className="inline-block rounded-lg px-3 py-2 text-sm bg-gray-800 text-gray-100 max-w-full">
                <div className="whitespace-pre-wrap break-words">{streamingContent}</div>
                <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse" />
              </div>
            ) : streamingToolCalls.length === 0 && streamingDrawingActions.length === 0 ? (
              <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 bg-gray-800 text-gray-400 text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Thinking...
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
