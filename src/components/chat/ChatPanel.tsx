"use client";

import { useChatStore } from "@/lib/chat/store";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { ConversationList } from "./ConversationList";
import type { ConversationItem } from "./ConversationList";
import { TokenBar } from "./TokenBar";
import { Bot, Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import type { ChatContext, ChatModel } from "@/lib/chat/types";

interface ChatPanelProps {
  context: ChatContext;
  onClose: () => void;
  conversations: ConversationItem[];
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onNewConversation: () => void;
  onSendMessage: (content: string) => Promise<void>;
}

export function ChatPanel({
  context,
  onClose,
  conversations,
  onSwitchConversation,
  onDeleteConversation,
  onRenameConversation,
  onNewConversation,
  onSendMessage,
}: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const model = useChatStore((s) => s.model);
  const conversationId = useChatStore((s) => s.conversationId);
  const showConversationList = useChatStore((s) => s.showConversationList);
  const toggleConversationList = useChatStore((s) => s.toggleConversationList);
  const cumulativeTokens = useChatStore((s) => s.cumulativeTokens);
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
        <div className="flex items-center gap-2">
          {cumulativeTokens.inputTokens > 0 && (
            <TokenBar
              inputTokens={cumulativeTokens.inputTokens}
              model={model}
            />
          )}
          <button
            onClick={onNewConversation}
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

      {/* Conversation switcher row */}
      <button
        onClick={toggleConversationList}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-200 hover:bg-gray-800/30 border-b border-gray-800 transition-colors"
      >
        {showConversationList ? (
          <ChevronUp className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0" />
        )}
        <span className="truncate">
          {conversationId
            ? `${context.pair.replace("_", "/")} ${context.timeframe}`
            : "New conversation"}
        </span>
        {conversations.length > 0 && (
          <span className="text-gray-600 ml-auto shrink-0">
            {conversations.length}
          </span>
        )}
      </button>

      {/* Conditional body: conversation list or chat messages */}
      {showConversationList ? (
        <ConversationList
          conversations={conversations}
          activeConversationId={conversationId}
          onSelect={onSwitchConversation}
          onDelete={onDeleteConversation}
          onRename={onRenameConversation}
          onCollapse={toggleConversationList}
        />
      ) : (
        <>
          <ChatMessages />
          <ChatInput context={context} onSendMessage={onSendMessage} />
        </>
      )}
    </div>
  );
}
