/**
 * Convex Functions: Users
 *
 * User management and sync from Clerk.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

/**
 * Sync user from Clerk on login.
 * Creates user if not exists, updates lastLoginAt if exists.
 */
export const syncUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      // Update last login
      await ctx.db.patch(existing._id, { lastLoginAt: Date.now() });
      return existing._id;
    }

    // Create new user
    return ctx.db.insert("users", {
      clerkId: identity.subject,
      email: identity.email || "",
      name: identity.name,
      isAdmin: false,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    });
  },
});

/**
 * Get current user profile
 */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);

    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", user.clerkId))
      .unique();
  },
});

/**
 * Check if current user is admin
 */
export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);

    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", user.clerkId))
      .unique();

    return userRecord?.isAdmin || false;
  },
});

/**
 * Admin only: Get all users' trading stats
 */
export const getAllUsersStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);

    // Check if admin
    const userRecord = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", user.clerkId))
      .unique();

    if (!userRecord?.isAdmin) {
      throw new Error("Not authorized - admin only");
    }

    // Get all users
    const allUsers = await ctx.db.query("users").collect();

    // Get stats for each user
    const stats = await Promise.all(
      allUsers.map(async (u) => {
        const trades = await ctx.db
          .query("trades")
          .withIndex("by_user", (q) => q.eq("userId", u.clerkId))
          .collect();

        const closedTrades = trades.filter((t) => t.status === "closed");
        const wins = closedTrades.filter((t) =>
          ["TP", "MW"].includes(t.outcome || "")
        );
        const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnlPips || 0), 0);

        return {
          userId: u.clerkId,
          name: u.name || u.email,
          email: u.email,
          totalTrades: closedTrades.length,
          openTrades: trades.filter((t) => t.status === "open").length,
          winRate: closedTrades.length > 0
            ? Math.round((wins.length / closedTrades.length) * 10000) / 100
            : 0,
          totalPnlPips: Math.round(totalPnl * 100) / 100,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
        };
      })
    );

    // Sort by total PnL descending
    return stats.sort((a, b) => b.totalPnlPips - a.totalPnlPips);
  },
});
