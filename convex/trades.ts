/**
 * Convex Functions: Trades
 *
 * CRUD operations for the live trade journal.
 * All queries/mutations require authentication and filter by user.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

/**
 * Get all trades for the authenticated user
 */
export const getTrades = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("open"),
        v.literal("closed"),
        v.literal("cancelled")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    let query = ctx.db
      .query("trades")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId));

    const trades = await query.order("desc").take(args.limit || 100);

    // Filter by status if provided
    if (args.status) {
      return trades.filter((t) => t.status === args.status);
    }

    return trades;
  },
});

/**
 * Get trades by strategy for the authenticated user
 */
export const getTradesByStrategy = query({
  args: {
    strategyId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_strategy", (q) => q.eq("strategyId", args.strategyId))
      .order("desc")
      .take(args.limit || 100);

    // Filter to only user's trades
    return trades.filter((t) => t.userId === user.clerkId);
  },
});

/**
 * Get trades by pair for the authenticated user
 */
export const getTradesByPair = query({
  args: {
    pair: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_pair", (q) => q.eq("pair", args.pair))
      .order("desc")
      .take(args.limit || 100);

    // Filter to only user's trades
    return trades.filter((t) => t.userId === user.clerkId);
  },
});

/**
 * Get open trades for the authenticated user
 */
export const getOpenTrades = query({
  args: {},
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);

    const trades = await ctx.db
      .query("trades")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .collect();

    return trades.filter((t) => t.status === "open");
  },
});

/**
 * Get a single trade by ID (must belong to authenticated user)
 */
export const getTrade = query({
  args: {
    id: v.id("trades"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const trade = await ctx.db.get(args.id);

    if (!trade || trade.userId !== user.clerkId) {
      return null;
    }

    return trade;
  },
});

/**
 * Create a new trade (entry)
 */
export const createTrade = mutation({
  args: {
    strategyId: v.string(),
    pair: v.string(),
    timeframe: v.string(),
    direction: v.union(v.literal("LONG"), v.literal("SHORT")),
    entryTime: v.number(),
    entryPrice: v.number(),
    stopLoss: v.number(),
    takeProfit: v.number(),
    quantity: v.optional(v.number()),
    riskPercent: v.optional(v.number()),
    indicatorSnapshot: v.optional(v.string()),
    conditionsMet: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.union(
      v.literal("user"),
      v.literal("claude"),
      v.literal("strategy")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const now = Date.now();

    return await ctx.db.insert("trades", {
      ...args,
      userId: user.clerkId,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Close a trade (exit)
 */
export const closeTrade = mutation({
  args: {
    id: v.id("trades"),
    exitTime: v.number(),
    exitPrice: v.number(),
    outcome: v.union(
      v.literal("TP"),
      v.literal("SL"),
      v.literal("MW"),
      v.literal("ML"),
      v.literal("BE")
    ),
    pnlPips: v.optional(v.number()),
    pnlDollars: v.optional(v.number()),
    barsHeld: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { id, ...updates } = args;

    const trade = await ctx.db.get(id);
    if (!trade) {
      throw new Error("Trade not found");
    }
    if (trade.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(id, {
      ...updates,
      status: "closed",
      updatedAt: Date.now(),
      notes: updates.notes || trade.notes,
    });
  },
});

/**
 * Update trade (modify any editable fields)
 */
export const updateTrade = mutation({
  args: {
    id: v.id("trades"),
    // Risk management
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    // Exit (for manual override)
    exitTime: v.optional(v.number()),
    exitPrice: v.optional(v.number()),
    outcome: v.optional(v.union(
      v.literal("TP"),
      v.literal("SL"),
      v.literal("MW"),
      v.literal("ML"),
      v.literal("BE")
    )),
    pnlPips: v.optional(v.number()),
    // Strategy
    strategyId: v.optional(v.string()),
    // Drawdown
    maxDrawdownPips: v.optional(v.number()),
    // Notes and screenshots
    notes: v.optional(v.string()),
    entryScreenshot: v.optional(v.string()),
    exitScreenshot: v.optional(v.string()),
    // Status override
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("open"),
      v.literal("closed"),
      v.literal("cancelled")
    )),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);
    const { id, ...updates } = args;

    const trade = await ctx.db.get(id);
    if (!trade) {
      throw new Error("Trade not found");
    }
    if (trade.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    // Filter out undefined values
    const cleanUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    await ctx.db.patch(id, {
      ...cleanUpdates,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Cancel a trade (before it opens)
 */
export const cancelTrade = mutation({
  args: {
    id: v.id("trades"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const trade = await ctx.db.get(args.id);
    if (!trade || trade.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.id, {
      status: "cancelled",
      notes: args.notes,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Delete a trade
 */
export const deleteTrade = mutation({
  args: {
    id: v.id("trades"),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const trade = await ctx.db.get(args.id);
    if (!trade || trade.userId !== user.clerkId) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * Get trade statistics for the authenticated user
 */
export const getTradeStats = query({
  args: {
    strategyId: v.optional(v.string()),
    pair: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    // Get all user's trades
    let trades = await ctx.db
      .query("trades")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .collect();

    // Filter by strategy if provided
    if (args.strategyId) {
      trades = trades.filter((t) => t.strategyId === args.strategyId);
    }

    // Filter by pair if provided
    if (args.pair) {
      trades = trades.filter((t) => t.pair === args.pair);
    }

    // Filter to closed trades only
    const closedTrades = trades.filter((t) => t.status === "closed");

    if (closedTrades.length === 0) {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgWinPips: 0,
        avgLossPips: 0,
        totalPnlPips: 0,
        totalPnlDollars: 0,
        avgBarsHeld: 0,
        expectancy: 0,
      };
    }

    const wins = closedTrades.filter((t) =>
      ["TP", "MW", "BE"].includes(t.outcome || "")
    );
    const losses = closedTrades.filter((t) =>
      ["SL", "ML"].includes(t.outcome || "")
    );

    const totalPnlPips = closedTrades.reduce(
      (sum, t) => sum + (t.pnlPips || 0),
      0
    );
    const totalPnlDollars = closedTrades.reduce(
      (sum, t) => sum + (t.pnlDollars || 0),
      0
    );

    const winPips = wins.reduce((sum, t) => sum + (t.pnlPips || 0), 0);
    const lossPips = losses.reduce((sum, t) => sum + Math.abs(t.pnlPips || 0), 0);

    const totalBars = closedTrades.reduce(
      (sum, t) => sum + (t.barsHeld || 0),
      0
    );

    const winRate = (wins.length / closedTrades.length) * 100;
    const avgWinPips = wins.length > 0 ? winPips / wins.length : 0;
    const avgLossPips = losses.length > 0 ? lossPips / losses.length : 0;
    const avgBarsHeld = totalBars / closedTrades.length;

    // Expectancy = (Win Rate * Avg Win) - (Loss Rate * Avg Loss)
    const expectancy =
      (winRate / 100) * avgWinPips - ((100 - winRate) / 100) * avgLossPips;

    return {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 100) / 100,
      avgWinPips: Math.round(avgWinPips * 100) / 100,
      avgLossPips: Math.round(avgLossPips * 100) / 100,
      totalPnlPips: Math.round(totalPnlPips * 100) / 100,
      totalPnlDollars: Math.round(totalPnlDollars * 100) / 100,
      avgBarsHeld: Math.round(avgBarsHeld * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
    };
  },
});
