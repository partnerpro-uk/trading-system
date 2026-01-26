/**
 * Convex Functions: Drawings
 *
 * CRUD operations for chart drawings (Fibonacci, trendlines, etc.)
 * All queries/mutations require authentication and filter by user.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

/**
 * Get all drawings for a specific chart (pair + timeframe)
 */
export const getDrawings = query({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    return await ctx.db
      .query("drawings")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .filter((q) =>
        q.and(
          q.eq(q.field("pair"), args.pair),
          q.eq(q.field("timeframe"), args.timeframe)
        )
      )
      .collect();
  },
});

/**
 * Get drawings by strategy
 */
export const getDrawingsByStrategy = query({
  args: {
    strategyId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const drawings = await ctx.db
      .query("drawings")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .collect();

    return drawings.filter((d) => d.userId === user.clerkId);
  },
});

/**
 * Get a single drawing by ID
 */
export const getDrawing = query({
  args: {
    id: v.id("drawings"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const drawing = await ctx.db.get(args.id);

    if (!drawing || drawing.userId !== user.clerkId) {
      return null;
    }

    return drawing;
  },
});

/**
 * Create a new drawing
 */
export const createDrawing = mutation({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    type: v.union(
      v.literal("fibonacci"),
      v.literal("trendline"),
      v.literal("ray"),
      v.literal("arrow"),
      v.literal("extendedLine"),
      v.literal("horizontalLine"),
      v.literal("verticalLine"),
      v.literal("rectangle"),
      v.literal("parallelChannel"),
      v.literal("position")
    ),
    anchors: v.string(),
    config: v.string(),
    strategyId: v.optional(v.string()),
    tradeId: v.optional(v.id("trades")),
    createdBy: v.union(
      v.literal("user"),
      v.literal("strategy"),
      v.literal("claude")
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    return await ctx.db.insert("drawings", {
      ...args,
      userId: user.clerkId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update a drawing
 */
export const updateDrawing = mutation({
  args: {
    id: v.id("drawings"),
    anchors: v.optional(v.string()),
    config: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { id, ...updates } = args;

    const drawing = await ctx.db.get(id);
    if (!drawing || drawing.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Delete a drawing
 */
export const deleteDrawing = mutation({
  args: {
    id: v.id("drawings"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const drawing = await ctx.db.get(args.id);
    if (!drawing || drawing.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * Bulk upsert drawings (for syncing local store)
 */
export const syncDrawings = mutation({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    drawings: v.array(
      v.object({
        localId: v.string(),
        type: v.union(
          v.literal("fibonacci"),
          v.literal("trendline"),
          v.literal("ray"),
          v.literal("arrow"),
          v.literal("extendedLine"),
          v.literal("horizontalLine"),
          v.literal("verticalLine"),
          v.literal("rectangle"),
          v.literal("parallelChannel"),
          v.literal("position")
        ),
        anchors: v.string(),
        config: v.string(),
        strategyId: v.optional(v.string()),
        tradeId: v.optional(v.id("trades")),
        createdBy: v.union(
          v.literal("user"),
          v.literal("strategy"),
          v.literal("claude")
        ),
        createdAt: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    // Get existing drawings for this chart belonging to this user
    const existing = await ctx.db
      .query("drawings")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .filter((q) =>
        q.and(
          q.eq(q.field("pair"), args.pair),
          q.eq(q.field("timeframe"), args.timeframe)
        )
      )
      .collect();

    // Delete drawings that are no longer in the sync set
    for (const drawing of existing) {
      const matchingLocal = args.drawings.find(
        (d) => d.createdAt === drawing.createdAt
      );
      if (!matchingLocal) {
        await ctx.db.delete(drawing._id);
      }
    }

    // Upsert drawings
    const results: string[] = [];
    for (const drawing of args.drawings) {
      const existingDrawing = existing.find(
        (d) => d.createdAt === drawing.createdAt
      );

      if (existingDrawing) {
        await ctx.db.patch(existingDrawing._id, {
          anchors: drawing.anchors,
          config: drawing.config,
          updatedAt: now,
        });
        results.push(existingDrawing._id);
      } else {
        const id = await ctx.db.insert("drawings", {
          pair: args.pair,
          timeframe: args.timeframe,
          type: drawing.type,
          anchors: drawing.anchors,
          config: drawing.config,
          strategyId: drawing.strategyId,
          tradeId: drawing.tradeId,
          createdBy: drawing.createdBy,
          userId: user.clerkId,
          createdAt: drawing.createdAt,
          updatedAt: now,
        });
        results.push(id);
      }
    }

    return results;
  },
});

/**
 * Clear all drawings for a chart
 */
export const clearDrawings = mutation({
  args: {
    pair: v.string(),
    timeframe: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const drawings = await ctx.db
      .query("drawings")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .filter((q) =>
        q.and(
          q.eq(q.field("pair"), args.pair),
          q.eq(q.field("timeframe"), args.timeframe)
        )
      )
      .collect();

    for (const drawing of drawings) {
      await ctx.db.delete(drawing._id);
    }

    return drawings.length;
  },
});
