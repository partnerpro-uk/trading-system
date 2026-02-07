"use client";

import { useChatStore } from "@/lib/chat/store";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { Bot, Plus, X } from "lucide-react";
import type { ChatContext } from "@/lib/chat/types";

interface ChatPanelProps {
  context: ChatContext;
  onClose: () => void;
}

export function ChatPanel({ context, onClose }: ChatPanelProps) {
  const { messages, newConversation, isStreaming } = useChatStore();
  const messageCount = messages.length;

  return (
    <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700 min-w-[280px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-gray-200">Claude</span>
          {messageCount > 0 && (
            <span className="text-[10px] text-gray-500">
              {Math.ceil(messageCount / 2)} turns
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={newConversation}
            disabled={isStreaming || messageCount === 0}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-30"
            title="New conversation"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
            title="Close chat"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <ChatMessages />

      {/* Input */}
      <ChatInput context={context} />
    </div>
  );
}
