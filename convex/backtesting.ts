/**
 * Backtesting — Convex Functions
 *
 * CRUD for saved query configurations.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getUserQueries = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("savedQueries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const saveQuery = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    config: v.string(),
  },
  handler: async (ctx, { userId, name, config }) => {
    const now = Date.now();
    return await ctx.db.insert("savedQueries", {
      userId,
      name,
      config,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateQuery = mutation({
  args: {
    id: v.id("savedQueries"),
    name: v.optional(v.string()),
    config: v.optional(v.string()),
  },
  handler: async (ctx, { id, name, config }) => {
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (name !== undefined) updates.name = name;
    if (config !== undefined) updates.config = config;
    await ctx.db.patch(id, updates);
  },
});

export const deleteQuery = mutation({
  args: { id: v.id("savedQueries") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
