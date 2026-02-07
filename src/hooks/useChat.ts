/**
 * useChat Hook
 *
 * Orchestrates between Zustand (immediate UI) and Convex (persistence).
 * Components use this instead of the raw store for sending messages,
 * switching conversations, and managing conversation lifecycle.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useChatStore } from "@/lib/chat/store";
import type { ChatContext, ChatModel } from "@/lib/chat/types";
import { getCompactionThreshold, getSplitThreshold } from "@/lib/chat/context-limits";

export function useChat(context: ChatContext) {
  // Convex mutations
  const createConversation = useMutation(api.chat.createConversation);
  const addMessage = useMutation(api.chat.addMessage);
  const updateStats = useMutation(api.chat.updateConversationStats);
  const deleteConvo = useMutation(api.chat.deleteConversation);
  const renameConvo = useMutation(api.chat.updateConversationTitle);
  const compactConvo = useMutation(api.chat.compactConversation);
  const splitConvo = useMutation(api.chat.splitConversation);

  // Convex queries
  const conversations = useQuery(api.chat.getConversations, { limit: 30 });

  // Current conversation ID from store
  const conversationId = useChatStore((s) => s.conversationId);

  // Load messages for active conversation
  const convexMessages = useQuery(
    api.chat.getMessages,
    conversationId
      ? { conversationId: conversationId as Id<"conversations"> }
      : "skip"
  );

  // Load active conversation doc (for summary, token usage)
  const activeConversation = useQuery(
    api.chat.getConversation,
    conversationId
      ? { conversationId: conversationId as Id<"conversations"> }
      : "skip"
  );

  // Prevent double conversation creation
  const creatingRef = useRef(false);
  // Track if we're loading from Convex vs local streaming
  const loadedConvoIdRef = useRef<string | null>(null);

  // Sync Convex messages to Zustand when switching conversations
  useEffect(() => {
    if (!conversationId || !convexMessages) return;
    // Only load from Convex when switching to a different conversation
    // (not when messages update from our own writes)
    if (loadedConvoIdRef.current === conversationId) return;
    loadedConvoIdRef.current = conversationId;

    const chatMessages = convexMessages.map((m) => ({
      id: m._id as string,
      role: m.role as "user" | "assistant",
      content: m.content,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
      drawingActions: m.drawingActions ? JSON.parse(m.drawingActions) : undefined,
      tokenUsage: m.tokenUsage,
      model: m.model as ChatModel | undefined,
      timestamp: m.createdAt,
    }));

    useChatStore.setState({ messages: chatMessages, isLoadingConversation: false });

    // Restore cumulative tokens from conversation doc
    if (activeConversation) {
      useChatStore.setState({
        cumulativeTokens: {
          inputTokens: activeConversation.tokenUsage.inputTokens,
          outputTokens: activeConversation.tokenUsage.outputTokens,
          cacheReadTokens: activeConversation.tokenUsage.cacheReadTokens,
        },
        model: activeConversation.model as ChatModel,
      });
    }
  }, [conversationId, convexMessages, activeConversation]);

  // Refs for compaction/split mutation functions (stable across renders)
  const compactConvoRef = useRef(compactConvo);
  compactConvoRef.current = compactConvo;
  const splitConvoRef = useRef(splitConvo);
  splitConvoRef.current = splitConvo;

  // Register persistence callback (includes post-save compaction/split checks)
  useEffect(() => {
    const callback = async (
      message: { content: string; toolCalls?: unknown[]; drawingActions?: unknown[]; tokenUsage?: { inputTokens: number; outputTokens: number }; model?: string },
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
    ) => {
      const convexId = useChatStore.getState().conversationId;
      if (!convexId) return;

      try {
        // Save assistant message to Convex
        await addMessage({
          conversationId: convexId as Id<"conversations">,
          role: "assistant",
          content: message.content,
          toolCalls: message.toolCalls ? JSON.stringify(message.toolCalls) : undefined,
          drawingActions: message.drawingActions ? JSON.stringify(message.drawingActions) : undefined,
          tokenUsage: message.tokenUsage,
          model: message.model,
        });

        // Update conversation stats
        await updateStats({
          conversationId: convexId as Id<"conversations">,
          tokenUsage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
          },
        });
      } catch (e) {
        console.error("[useChat] Failed to persist message:", e);
      }

      // Post-save: check if compaction or splitting is needed
      const { cumulativeTokens, model, messages } = useChatStore.getState();

      // Check splitting first (higher threshold)
      const splitThreshold = getSplitThreshold(model);
      if (cumulativeTokens.inputTokens >= splitThreshold) {
        try {
          const newConvoId = await splitConvoRef.current({
            conversationId: convexId as Id<"conversations">,
          });
          loadedConvoIdRef.current = newConvoId as unknown as string;
          useChatStore.setState({
            conversationId: newConvoId as unknown as string,
            messages: [],
            cumulativeTokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
          });
          return; // Don't compact if we just split
        } catch (e) {
          console.error("[useChat] Split failed:", e);
        }
      }

      // Check compaction (lower threshold)
      const compactThreshold = getCompactionThreshold(model);
      if (cumulativeTokens.inputTokens >= compactThreshold && messages.length >= 14) {
        try {
          const response = await fetch("/api/chat/compact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
            }),
          });
          if (response.ok) {
            const { summary, compactedUpToIndex, summaryTokenEstimate } = await response.json();
            const lastCompactedMessage = messages[compactedUpToIndex - 1];
            if (lastCompactedMessage) {
              await compactConvoRef.current({
                conversationId: convexId as Id<"conversations">,
                summary,
                summaryUpToMessage: lastCompactedMessage.id as Id<"chatMessages">,
                summaryTokenEstimate,
              });
            }
          }
        } catch (e) {
          console.error("[useChat] Compaction failed:", e);
        }
      }
    };

    useChatStore.getState().setOnAssistantMessageComplete(callback);
    return () => useChatStore.getState().setOnAssistantMessageComplete(null);
  }, [addMessage, updateStats]);

  // Send message with Convex persistence
  const sendMessage = useCallback(async (content: string) => {
    const { model, isStreaming } = useChatStore.getState();
    if (isStreaming) return;

    let convexId = useChatStore.getState().conversationId;

    // Create conversation in Convex if first message
    if (!convexId && !creatingRef.current) {
      creatingRef.current = true;
      try {
        const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
        convexId = await createConversation({
          pair: context.pair,
          timeframe: context.timeframe,
          model,
          title,
        }) as unknown as string;
        useChatStore.setState({ conversationId: convexId });
        loadedConvoIdRef.current = convexId;
      } finally {
        creatingRef.current = false;
      }
    }

    // Save user message to Convex
    if (convexId) {
      try {
        await addMessage({
          conversationId: convexId as Id<"conversations">,
          role: "user",
          content,
        });
      } catch (e) {
        console.error("[useChat] Failed to persist user message:", e);
      }
    }

    // Build context with summary if conversation has one
    const contextWithSummary: ChatContext = {
      ...context,
      summary: activeConversation?.summary ?? undefined,
    };

    // Delegate streaming to store
    await useChatStore.getState().sendMessage(content, contextWithSummary);
  }, [context, createConversation, addMessage, activeConversation]);

  // Switch to an existing conversation
  const switchConversation = useCallback((id: string) => {
    loadedConvoIdRef.current = null; // Force reload from Convex
    useChatStore.setState({
      conversationId: id,
      messages: [],
      isLoadingConversation: true,
      showConversationList: false,
      streamingContent: "",
      streamingToolCalls: [],
      streamingDrawingActions: [],
    });
  }, []);

  // Delete a conversation
  const deleteConversation = useCallback(async (id: string) => {
    const currentId = useChatStore.getState().conversationId;
    try {
      await deleteConvo({ conversationId: id as Id<"conversations"> });
      if (currentId === id) {
        loadedConvoIdRef.current = null;
        useChatStore.getState().newConversation();
      }
    } catch (e) {
      console.error("[useChat] Failed to delete conversation:", e);
    }
  }, [deleteConvo]);

  // Rename a conversation
  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      await renameConvo({
        conversationId: id as Id<"conversations">,
        title,
      });
    } catch (e) {
      console.error("[useChat] Failed to rename conversation:", e);
    }
  }, [renameConvo]);

  // Start a new conversation (clears store, keeps panel open)
  const newConversation = useCallback(() => {
    loadedConvoIdRef.current = null;
    useChatStore.getState().newConversation();
  }, []);

  return {
    sendMessage,
    switchConversation,
    deleteConversation,
    renameConversation,
    newConversation,
    conversations: conversations ?? [],
    activeConversation: activeConversation ?? null,
  };
}
