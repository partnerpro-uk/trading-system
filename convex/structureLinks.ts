/**
 * Convex Functions: Structure Links
 *
 * Links trades to market structure entities (BOS, FVG, key levels, sweeps).
 * Each link records the role the entity played in the trade thesis.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

const entityTypeValidator = v.union(
  v.literal("bos"),
  v.literal("fvg"),
  v.literal("key_level"),
  v.literal("sweep")
);

const roleValidator = v.union(
  v.literal("entry_reason"),
  v.literal("exit_target"),
  v.literal("invalidation"),
  v.literal("confluence")
);

/**
 * Get all structure links for a specific trade
 */
export const getByTrade = query({
  args: {
    tradeId: v.id("trades"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const links = await ctx.db
      .query("structureLinks")
      .withIndex("by_trade", (q) => q.eq("tradeId", args.tradeId))
      .collect();

    return links.filter((l) => l.userId === user.clerkId);
  },
});

/**
 * Create a single structure link
 */
export const createLink = mutation({
  args: {
    tradeId: v.id("trades"),
    entityType: entityTypeValidator,
    entityId: v.string(),
    role: roleValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    // Verify trade belongs to user
    const trade = await ctx.db.get(args.tradeId);
    if (!trade || trade.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    const linkId = await ctx.db.insert("structureLinks", {
      ...args,
      userId: user.clerkId,
      createdAt: Date.now(),
    });

    // Increment denormalized count on trade
    await ctx.db.patch(args.tradeId, {
      structureLinkCount: (trade.structureLinkCount ?? 0) + 1,
    });

    return linkId;
  },
});

/**
 * Create multiple structure links at once (for auto-linking on trade entry)
 */
export const createBulkLinks = mutation({
  args: {
    tradeId: v.id("trades"),
    links: v.array(
      v.object({
        entityType: entityTypeValidator,
        entityId: v.string(),
        role: roleValidator,
        note: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    // Verify trade belongs to user
    const trade = await ctx.db.get(args.tradeId);
    if (!trade || trade.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    const now = Date.now();
    const ids: string[] = [];

    for (const link of args.links) {
      const id = await ctx.db.insert("structureLinks", {
        ...link,
        tradeId: args.tradeId,
        userId: user.clerkId,
        createdAt: now,
      });
      ids.push(id);
    }

    // Update denormalized count
    await ctx.db.patch(args.tradeId, {
      structureLinkCount: (trade.structureLinkCount ?? 0) + args.links.length,
    });

    return ids;
  },
});

/**
 * Delete a structure link
 */
export const deleteLink = mutation({
  args: {
    id: v.id("structureLinks"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const link = await ctx.db.get(args.id);
    if (!link || link.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.id);

    // Decrement denormalized count on trade
    const trade = await ctx.db.get(link.tradeId);
    if (trade) {
      await ctx.db.patch(link.tradeId, {
        structureLinkCount: Math.max(0, (trade.structureLinkCount ?? 1) - 1),
      });
    }
  },
});
