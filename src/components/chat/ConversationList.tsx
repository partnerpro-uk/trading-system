"use client";

import { useState, useCallback } from "react";
import { Trash2, ChevronUp, MessageSquare, GitBranch } from "lucide-react";
import type { ChatModel } from "@/lib/chat/types";
import { TokenBar } from "./TokenBar";

export interface ConversationItem {
  _id: string;
  pair: string;
  timeframe: string;
  title?: string;
  model: string;
  messageCount: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  lastMessageAt: number;
  createdAt: number;
  status?: string;
  parentConversationId?: string;
}

interface ConversationListProps {
  conversations: ConversationItem[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCollapse: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const hours = diff / (1000 * 60 * 60);
  if (hours < 1) return "Just now";
  if (hours < 24) {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function ConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onDelete,
  onRename,
  onCollapse,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const startEditing = useCallback((id: string, currentTitle: string) => {
    setEditingId(id);
    setEditValue(currentTitle);
  }, []);

  const commitEdit = useCallback(
    (id: string) => {
      if (editValue.trim()) {
        onRename(id, editValue.trim());
      }
      setEditingId(null);
    },
    [editValue, onRename]
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (confirmDeleteId === id) {
        onDelete(id);
        setConfirmDeleteId(null);
      } else {
        setConfirmDeleteId(id);
        setTimeout(() => setConfirmDeleteId(null), 3000);
      }
    },
    [confirmDeleteId, onDelete]
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Collapse header */}
      <button
        onClick={onCollapse}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors border-b border-gray-800"
      >
        <ChevronUp className="w-3 h-3" />
        <span>Conversations</span>
        <span className="text-gray-600 ml-auto">{conversations.length}</span>
      </button>

      {/* Conversation items */}
      <div className="space-y-0.5 p-1">
        {conversations.map((convo) => {
          const isActive = convo._id === activeConversationId;
          const isEditing = editingId === convo._id;
          const isConfirmingDelete = confirmDeleteId === convo._id;
          const turns = Math.ceil(convo.messageCount / 2);

          return (
            <div
              key={convo._id}
              onClick={() => {
                if (!isEditing) onSelect(convo._id);
              }}
              className={`group relative px-2.5 py-2 rounded cursor-pointer transition-colors ${
                isActive
                  ? "bg-blue-900/30 border-l-2 border-blue-500"
                  : "hover:bg-gray-800/50 border-l-2 border-transparent"
              }`}
            >
              {/* Row 1: Pair + time */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-medium text-gray-300">
                    {convo.pair.replace("_", "/")}
                  </span>
                  <span className="text-gray-600">{convo.timeframe}</span>
                  {convo.status === "completed" && (
                    <span className="text-[9px] text-gray-600 border border-gray-700 rounded px-1">
                      completed
                    </span>
                  )}
                  {convo.parentConversationId && (
                    <GitBranch className="w-3 h-3 text-gray-600" />
                  )}
                </div>
                <span className="text-[10px] text-gray-600">
                  {formatRelativeTime(convo.lastMessageAt)}
                </span>
              </div>

              {/* Row 2: Title (editable) */}
              <div className="mt-0.5">
                {isEditing ? (
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitEdit(convo._id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit(convo._id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="w-full bg-gray-800 text-xs text-gray-300 px-1 py-0.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  />
                ) : (
                  <p
                    className="text-xs text-gray-400 truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEditing(convo._id, convo.title || "");
                    }}
                    title="Double-click to rename"
                  >
                    {convo.title || "Untitled conversation"}
                  </p>
                )}
              </div>

              {/* Row 3: Turns + token bar + delete */}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-600">
                    {turns} {turns === 1 ? "turn" : "turns"}
                  </span>
                  {convo.tokenUsage.inputTokens > 0 && (
                    <TokenBar
                      inputTokens={convo.tokenUsage.inputTokens}
                      model={convo.model as ChatModel}
                      compact
                    />
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(convo._id);
                  }}
                  className={`p-1 rounded transition-colors ${
                    isConfirmingDelete
                      ? "text-red-400 bg-red-900/30"
                      : "text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                  }`}
                  title={
                    isConfirmingDelete
                      ? "Click again to confirm"
                      : "Delete conversation"
                  }
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}

        {conversations.length === 0 && (
          <div className="text-center py-8">
            <MessageSquare className="w-6 h-6 text-gray-700 mx-auto mb-2" />
            <p className="text-xs text-gray-600">No conversations yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
