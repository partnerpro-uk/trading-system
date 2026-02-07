/**
 * Convex Functions: Alerts
 *
 * CRUD for real-time notifications. Worker-generated alerts use createSystemAlert
 * with a shared secret (no user auth). User-facing queries require authentication.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthenticatedUser } from "./lib/auth";

// ─── System Alert (worker-generated) ─────────────────────────────────────────

export const createSystemAlert = mutation({
  args: {
    workerSecret: v.string(),
    userId: v.string(),
    type: v.string(),
    title: v.string(),
    message: v.string(),
    pair: v.optional(v.string()),
    timeframe: v.optional(v.string()),
    severity: v.string(),
    metadata: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const secret = process.env.WORKER_SECRET;
    if (!secret || args.workerSecret !== secret) {
      throw new Error("Unauthorized: invalid worker secret");
    }

    return await ctx.db.insert("alerts", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      message: args.message,
      pair: args.pair,
      timeframe: args.timeframe,
      severity: args.severity,
      read: false,
      metadata: args.metadata,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

// ─── User Alert (user-created) ───────────────────────────────────────────────

export const createAlert = mutation({
  args: {
    type: v.string(),
    title: v.string(),
    message: v.string(),
    pair: v.optional(v.string()),
    timeframe: v.optional(v.string()),
    severity: v.string(),
    metadata: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    return await ctx.db.insert("alerts", {
      userId: user.clerkId,
      type: args.type,
      title: args.title,
      message: args.message,
      pair: args.pair,
      timeframe: args.timeframe,
      severity: args.severity,
      read: false,
      metadata: args.metadata,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getUnreadAlerts = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("alerts")
      .withIndex("by_user_unread", (q) => q.eq("userId", userId).eq("read", false))
      .order("desc")
      .take(50);
  },
});

export const getRecentAlerts = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("alerts")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const markRead = mutation({
  args: { id: v.id("alerts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { read: true });
  },
});

export const markAllRead = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const unread = await ctx.db
      .query("alerts")
      .withIndex("by_user_unread", (q) => q.eq("userId", userId).eq("read", false))
      .collect();

    for (const alert of unread) {
      await ctx.db.patch(alert._id, { read: true });
    }
  },
});

// ─── Alert Preferences ──────────────────────────────────────────────────────

export const getAlertPreferences = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const prefs = await ctx.db
      .query("alertPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    // Return defaults if no prefs exist
    if (!prefs) {
      return {
        structureAlerts: true,
        priceAlerts: true,
        newsAlerts: true,
        tradeAlerts: true,
        browserNotifications: false,
      };
    }

    return {
      structureAlerts: prefs.structureAlerts,
      priceAlerts: prefs.priceAlerts,
      newsAlerts: prefs.newsAlerts,
      tradeAlerts: prefs.tradeAlerts,
      browserNotifications: prefs.browserNotifications,
    };
  },
});

export const updateAlertPreferences = mutation({
  args: {
    structureAlerts: v.optional(v.boolean()),
    priceAlerts: v.optional(v.boolean()),
    newsAlerts: v.optional(v.boolean()),
    tradeAlerts: v.optional(v.boolean()),
    browserNotifications: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    const existing = await ctx.db
      .query("alertPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user.clerkId))
      .first();

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.structureAlerts !== undefined) updates.structureAlerts = args.structureAlerts;
    if (args.priceAlerts !== undefined) updates.priceAlerts = args.priceAlerts;
    if (args.newsAlerts !== undefined) updates.newsAlerts = args.newsAlerts;
    if (args.tradeAlerts !== undefined) updates.tradeAlerts = args.tradeAlerts;
    if (args.browserNotifications !== undefined) updates.browserNotifications = args.browserNotifications;

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("alertPreferences", {
        userId: user.clerkId,
        structureAlerts: args.structureAlerts ?? true,
        priceAlerts: args.priceAlerts ?? true,
        newsAlerts: args.newsAlerts ?? true,
        tradeAlerts: args.tradeAlerts ?? true,
        browserNotifications: args.browserNotifications ?? false,
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── Worker Helpers ──────────────────────────────────────────────────────────

export const getActiveUserIds = query({
  args: { workerSecret: v.string() },
  handler: async (ctx, { workerSecret }) => {
    const secret = process.env.WORKER_SECRET;
    if (!secret || workerSecret !== secret) {
      return [];
    }

    const users = await ctx.db.query("users").collect();
    return users.map((u) => u.clerkId);
  },
});
