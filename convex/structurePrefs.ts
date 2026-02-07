/**
 * Convex Functions: Structure Preferences
 *
 * Per-user chart structure overlay preferences.
 * Persists toggle state so overlays survive page reloads.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

/**
 * Get structure preferences for the authenticated user
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);

    const prefs = await ctx.db
      .query("structurePrefs")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .first();

    return prefs;
  },
});

/**
 * Upsert structure preferences
 */
export const upsert = mutation({
  args: {
    overlayToggles: v.object({
      swings: v.boolean(),
      bos: v.boolean(),
      fvgs: v.boolean(),
      levels: v.boolean(),
      premiumDiscount: v.boolean(),
      sweeps: v.boolean(),
    }),
    fvgMinTier: v.number(),
    showRecentOnly: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("structurePrefs")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("structurePrefs", {
        ...args,
        userId: user.clerkId,
        updatedAt: now,
      });
    }
  },
});
