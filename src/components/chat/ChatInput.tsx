"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Square, ChevronDown } from "lucide-react";
import { useChatStore } from "@/lib/chat/store";
import type { ChatModel, ChatContext } from "@/lib/chat/types";

interface ChatInputProps {
  context: ChatContext;
  onSendMessage: (content: string) => Promise<void>;
}

export function ChatInput({ context, onSendMessage }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const { isStreaming, stopStreaming, model, setModel } = useChatStore();

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Close model picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    }
    if (showModelPicker) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showModelPicker]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    setInput("");
    onSendMessage(trimmed);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, isStreaming, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const models: { id: ChatModel; label: string; description: string }[] = [
    { id: "sonnet", label: "Sonnet", description: "Best for analysis" },
    { id: "haiku", label: "Haiku", description: "Fast & cheap" },
    { id: "opus", label: "Opus", description: "Deepest reasoning" },
  ];

  return (
    <div className="border-t border-gray-700 p-3">
      {/* Input area */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude about the chart..."
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none bg-gray-800 text-gray-100 text-sm rounded-lg px-3 py-2 border border-gray-600 focus:border-blue-500 focus:outline-none placeholder-gray-500 disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            onClick={stopStreaming}
            className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shrink-0"
            title="Stop generating"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Model selector */}
      <div className="flex items-center justify-between mt-2">
        <div className="relative" ref={modelPickerRef}>
          <button
            onClick={() => setShowModelPicker(!showModelPicker)}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="font-medium">{models.find((m) => m.id === model)?.label}</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          {showModelPicker && (
            <div className="absolute bottom-full left-0 mb-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden z-50">
              {models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setModel(m.id);
                    setShowModelPicker(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors ${
                    model === m.id ? "text-blue-400" : "text-gray-300"
                  }`}
                >
                  <span className="font-medium">{m.label}</span>
                  <span className="text-gray-500 ml-1.5">{m.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {isStreaming && (
          <span className="text-[10px] text-gray-500 animate-pulse">Thinking...</span>
        )}
      </div>
    </div>
  );
}
