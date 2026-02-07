/**
 * Convex Functions: Chat
 *
 * CRUD operations for Claude AI chat conversations and messages.
 * All queries/mutations require authentication.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

// ─── Conversations ───────────────────────────────────────────────────────────

/**
 * Create a new conversation
 */
export const createConversation = mutation({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    model: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    return await ctx.db.insert("conversations", {
      userId: user.clerkId,
      pair: args.pair,
      timeframe: args.timeframe,
      model: args.model,
      title: args.title,
      messageCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      },
      lastMessageAt: now,
      createdAt: now,
      status: "active",
    });
  },
});

/**
 * Get conversations for the authenticated user
 */
export const getConversations = query({
  args: {
    pair: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .order("desc")
      .take(args.limit || 20);

    // Filter by pair if provided
    if (args.pair) {
      return conversations.filter((c) => c.pair === args.pair);
    }

    return conversations;
  },
});

/**
 * Update conversation stats (message count, token usage, title)
 */
export const updateConversationStats = mutation({
  args: {
    conversationId: v.id("conversations"),
    messageCount: v.optional(v.number()),
    title: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
        cacheReadTokens: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    const updates: Record<string, unknown> = {
      lastMessageAt: Date.now(),
    };

    if (args.messageCount !== undefined) {
      updates.messageCount = args.messageCount;
    }

    if (args.title !== undefined) {
      updates.title = args.title;
    }

    if (args.tokenUsage) {
      updates.tokenUsage = {
        inputTokens:
          conversation.tokenUsage.inputTokens + args.tokenUsage.inputTokens,
        outputTokens:
          conversation.tokenUsage.outputTokens + args.tokenUsage.outputTokens,
        cacheReadTokens:
          conversation.tokenUsage.cacheReadTokens + args.tokenUsage.cacheReadTokens,
      };
    }

    await ctx.db.patch(args.conversationId, updates);
  },
});

/**
 * Delete a conversation and all its messages
 */
export const deleteConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    // Delete all messages
    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();

    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    // Delete conversation
    await ctx.db.delete(args.conversationId);
  },
});

// ─── Messages ────────────────────────────────────────────────────────────────

/**
 * Add a message to a conversation
 */
export const addMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    toolCalls: v.optional(v.string()),
    toolResults: v.optional(v.string()),
    drawingActions: v.optional(v.string()),
    tokenUsage: v.optional(
      v.object({
        inputTokens: v.number(),
        outputTokens: v.number(),
      })
    ),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    const messageId = await ctx.db.insert("chatMessages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      toolCalls: args.toolCalls,
      toolResults: args.toolResults,
      drawingActions: args.drawingActions,
      tokenUsage: args.tokenUsage,
      model: args.model,
      createdAt: Date.now(),
    });

    // Update conversation stats
    await ctx.db.patch(args.conversationId, {
      messageCount: conversation.messageCount + 1,
      lastMessageAt: Date.now(),
    });

    return messageId;
  },
});

/**
 * Get messages for a conversation
 */
export const getMessages = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    return await ctx.db
      .query("chatMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .collect();
  },
});

// ─── Context Management ─────────────────────────────────────────────────────

/**
 * Rename a conversation
 */
export const updateConversationTitle = mutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    await ctx.db.patch(args.conversationId, { title: args.title });
  },
});

/**
 * Store compacted summary of older messages
 */
export const compactConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
    summary: v.string(),
    summaryUpToMessage: v.id("chatMessages"),
    summaryTokenEstimate: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    await ctx.db.patch(args.conversationId, {
      summary: args.summary,
      summaryUpToMessage: args.summaryUpToMessage,
      summaryTokenEstimate: args.summaryTokenEstimate,
    });
  },
});

/**
 * Split a conversation: mark current as completed, create continuation
 */
export const splitConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const old = await ctx.db.get(args.conversationId);

    if (!old || old.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    // Mark old as completed
    await ctx.db.patch(args.conversationId, { status: "completed" });

    // Create continuation
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      userId: user.clerkId,
      pair: old.pair,
      timeframe: old.timeframe,
      model: old.model,
      title: old.title ? `${old.title} (continued)` : "Continued conversation",
      summary: old.summary,
      parentConversationId: args.conversationId,
      status: "active",
      messageCount: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      lastMessageAt: now,
      createdAt: now,
    });
  },
});

/**
 * Get a single conversation by ID
 */
export const getConversation = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation || conversation.userId !== user.clerkId) {
      throw new Error("Conversation not found");
    }

    return conversation;
  },
});
