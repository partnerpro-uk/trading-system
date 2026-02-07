/**
 * Convex Functions: Trade Snapshots
 *
 * CRUD operations for trade chart snapshots.
 * All queries/mutations require authentication and filter by user.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

/**
 * Get all snapshots for a specific trade
 */
export const getSnapshotsByTrade = query({
  args: {
    tradeId: v.id("trades"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_trade", (q) => q.eq("tradeId", args.tradeId))
      .collect();

    // Filter to user's snapshots and sort by timestamp
    return snapshots
      .filter((s) => s.userId === user.clerkId)
      .sort((a, b) => a.timestamp - b.timestamp);
  },
});

/**
 * Get a single snapshot by ID
 */
export const getSnapshot = query({
  args: {
    id: v.id("snapshots"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const snapshot = await ctx.db.get(args.id);

    if (!snapshot || snapshot.userId !== user.clerkId) {
      return null;
    }

    return snapshot;
  },
});

/**
 * Create a new snapshot
 */
export const createSnapshot = mutation({
  args: {
    tradeId: v.id("trades"),
    momentLabel: v.union(
      v.literal("setup"),
      v.literal("entry"),
      v.literal("during"),
      v.literal("exit")
    ),
    pair: v.string(),
    timeframe: v.string(),
    timestamp: v.number(),
    visibleRange: v.object({
      from: v.number(),
      to: v.number(),
    }),
    drawings: v.string(),
    tradeContext: v.string(),
    strategy: v.optional(v.string()),
    analysisNotes: v.optional(v.string()),
    aiDescription: v.optional(v.string()),
    structureContext: v.optional(v.string()),
    createdBy: v.union(v.literal("auto"), v.literal("manual")),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    return await ctx.db.insert("snapshots", {
      ...args,
      userId: user.clerkId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update snapshot notes
 */
export const updateSnapshot = mutation({
  args: {
    id: v.id("snapshots"),
    analysisNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { id, ...updates } = args;

    const snapshot = await ctx.db.get(id);
    if (!snapshot || snapshot.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Delete a snapshot
 */
export const deleteSnapshot = mutation({
  args: {
    id: v.id("snapshots"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const snapshot = await ctx.db.get(args.id);
    if (!snapshot || snapshot.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.id);
  },
});
