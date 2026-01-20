import { action, mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Session time definitions in their local timezones
// These are the "business hours" of each session
const SESSION_TIMES = {
  // Asia: Tokyo 00:00-09:00 JST = 18:00-03:00 NY (previous day to current day)
  ASIA: {
    timezone: "America/New_York",
    startHour: 18, // 6 PM NY (previous day)
    endHour: 3, // 3 AM NY (current day)
    spansOvernight: true,
  },
  // London: 08:00-17:00 GMT/BST = 03:00-12:00 NY (during EST)
  LONDON: {
    timezone: "America/New_York",
    startHour: 3, // 3 AM NY
    endHour: 12, // 12 PM NY
    spansOvernight: false,
  },
  // New York: 08:00-17:00 EST/EDT
  NY: {
    timezone: "America/New_York",
    startHour: 8, // 8 AM NY
    endHour: 17, // 5 PM NY
    spansOvernight: false,
  },
} as const;

type SessionType = keyof typeof SESSION_TIMES;

// Get session boundaries for a specific date (in Unix ms)
function getSessionBoundaries(
  dateStr: string, // "2024-01-17" format
  session: SessionType
): { startTime: number; endTime: number } {
  const config = SESSION_TIMES[session];
  const [year, month, day] = dateStr.split("-").map(Number);

  // Create dates in NY timezone conceptually
  // We work in UTC but calculate based on NY hours
  // Note: This is simplified - for production, use date-fns-tz

  // For now, assume EST (UTC-5) - a proper implementation would handle DST
  const NYOffsetMs = 5 * 60 * 60 * 1000; // EST offset

  if (config.spansOvernight) {
    // Asia spans from previous day evening to current day morning
    // Start: previous day at startHour NY time
    const prevDay = new Date(Date.UTC(year, month - 1, day - 1, config.startHour));
    const startTime = prevDay.getTime() + NYOffsetMs;

    // End: current day at endHour NY time
    const currDay = new Date(Date.UTC(year, month - 1, day, config.endHour));
    const endTime = currDay.getTime() + NYOffsetMs;

    return { startTime, endTime };
  } else {
    // London and NY are same-day sessions
    const startDate = new Date(Date.UTC(year, month - 1, day, config.startHour));
    const startTime = startDate.getTime() + NYOffsetMs;

    const endDate = new Date(Date.UTC(year, month - 1, day, config.endHour));
    const endTime = endDate.getTime() + NYOffsetMs;

    return { startTime, endTime };
  }
}

// Get current active session(s)
export const getCurrentSession = query({
  args: {},
  handler: async () => {
    const now = Date.now();
    const NYOffsetMs = 5 * 60 * 60 * 1000;

    // Get current NY time
    const nyNow = new Date(now - NYOffsetMs);
    const nyHour = nyNow.getUTCHours();

    const activeSessions: SessionType[] = [];

    // Check each session
    // Asia: 18:00-03:00 NY
    if (nyHour >= 18 || nyHour < 3) {
      activeSessions.push("ASIA");
    }

    // London: 03:00-12:00 NY
    if (nyHour >= 3 && nyHour < 12) {
      activeSessions.push("LONDON");
    }

    // NY: 08:00-17:00 NY
    if (nyHour >= 8 && nyHour < 17) {
      activeSessions.push("NY");
    }

    return {
      activeSessions,
      nyHour,
      timestamp: now,
    };
  },
});

// Get sessions for a specific pair and date
export const getSessionsForDate = query({
  args: {
    pair: v.string(),
    date: v.string(), // "2024-01-17"
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_pair_date", (q) =>
        q.eq("pair", args.pair).eq("date", args.date)
      )
      .collect();

    return sessions;
  },
});

// Get recent sessions for a pair (for chart display)
export const getRecentSessions = query({
  args: {
    pair: v.string(),
    days: v.optional(v.number()), // How many days back
  },
  handler: async (ctx, args) => {
    const days = args.days ?? 5;

    // Calculate date range
    const now = Date.now();
    const NYOffsetMs = 5 * 60 * 60 * 1000;
    const nyDate = new Date(now - NYOffsetMs);

    // Get dates for the last N days
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(nyDate);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split("T")[0]);
    }

    // Fetch sessions for all dates
    const allSessions = [];
    for (const date of dates) {
      const sessionsForDate = await ctx.db
        .query("sessions")
        .withIndex("by_pair_date", (q) => q.eq("pair", args.pair).eq("date", date))
        .collect();
      allSessions.push(...sessionsForDate);
    }

    return allSessions;
  },
});

// Get today's sessions for a pair
export const getTodaySessions = query({
  args: {
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    // Get today's date in NY timezone (simplified)
    const now = Date.now();
    const NYOffsetMs = 5 * 60 * 60 * 1000;
    const nyDate = new Date(now - NYOffsetMs);
    const dateStr = nyDate.toISOString().split("T")[0];

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_pair_date", (q) =>
        q.eq("pair", args.pair).eq("date", dateStr)
      )
      .collect();

    // Also get yesterday's Asia session (it may still be relevant)
    const yesterday = new Date(nyDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const yesterdaySessions = await ctx.db
      .query("sessions")
      .withIndex("by_pair_date_session", (q) =>
        q.eq("pair", args.pair).eq("date", yesterdayStr).eq("session", "ASIA")
      )
      .collect();

    return [...sessions, ...yesterdaySessions];
  },
});

// Upsert a session record
export const upsertSession = mutation({
  args: {
    pair: v.string(),
    date: v.string(),
    session: v.string(),
    high: v.number(),
    low: v.number(),
    highTime: v.number(),
    lowTime: v.number(),
    startTime: v.number(),
    endTime: v.number(),
    complete: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check if session already exists
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_pair_date_session", (q) =>
        q
          .eq("pair", args.pair)
          .eq("date", args.date)
          .eq("session", args.session)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        high: args.high,
        low: args.low,
        highTime: args.highTime,
        lowTime: args.lowTime,
        complete: args.complete,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("sessions", args);
    }
  },
});

// Calculate session H/L from candle data (internal)
export const calculateSessionFromCandles = internalAction({
  args: {
    pair: v.string(),
    date: v.string(), // "2024-01-17"
    session: v.string(), // "ASIA" | "LONDON" | "NY"
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    error?: string;
    session?: {
      pair: string;
      date: string;
      session: string;
      high: number;
      low: number;
      highTime: number;
      lowTime: number;
      startTime: number;
      endTime: number;
      complete: boolean;
    };
  }> => {
    const sessionType = args.session as SessionType;
    const { startTime, endTime } = getSessionBoundaries(args.date, sessionType);
    const now = Date.now();

    // Query M15 candles within session time range
    // Using M15 for balance between precision and query size
    const candles: Array<{
      timestamp: number;
      high: number;
      low: number;
      open: number;
      close: number;
    }> = await ctx.runQuery(internal.sessions.getCandlesInRange, {
      pair: args.pair,
      timeframe: "M15",
      startTime,
      endTime: Math.min(endTime, now), // Don't query future
    });

    if (candles.length === 0) {
      return { success: false, error: "No candles in session range" };
    }

    // Calculate high and low
    let high: number = candles[0].high;
    let low: number = candles[0].low;
    let highTime: number = candles[0].timestamp;
    let lowTime: number = candles[0].timestamp;

    for (const candle of candles) {
      if (candle.high > high) {
        high = candle.high;
        highTime = candle.timestamp;
      }
      if (candle.low < low) {
        low = candle.low;
        lowTime = candle.timestamp;
      }
    }

    // Determine if session is complete
    const complete = now > endTime;

    // Store the session data
    await ctx.runMutation(internal.sessions.upsertSessionInternal, {
      pair: args.pair,
      date: args.date,
      session: args.session,
      high,
      low,
      highTime,
      lowTime,
      startTime,
      endTime,
      complete,
    });

    return {
      success: true,
      session: {
        pair: args.pair,
        date: args.date,
        session: args.session,
        high,
        low,
        highTime,
        lowTime,
        startTime,
        endTime,
        complete,
      },
    };
  },
});

// Internal query to get candles in a time range
export const getCandlesInRange = internalQuery({
  args: {
    pair: v.string(),
    timeframe: v.string(),
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const candles = await ctx.db
      .query("candles")
      .withIndex("by_pair_tf_time", (q) =>
        q
          .eq("pair", args.pair)
          .eq("timeframe", args.timeframe)
          .gte("timestamp", args.startTime)
          .lte("timestamp", args.endTime)
      )
      .collect();

    return candles;
  },
});

// Internal mutation for upsert (called from action)
export const upsertSessionInternal = internalMutation({
  args: {
    pair: v.string(),
    date: v.string(),
    session: v.string(),
    high: v.number(),
    low: v.number(),
    highTime: v.number(),
    lowTime: v.number(),
    startTime: v.number(),
    endTime: v.number(),
    complete: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_pair_date_session", (q) =>
        q
          .eq("pair", args.pair)
          .eq("date", args.date)
          .eq("session", args.session)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        high: args.high,
        low: args.low,
        highTime: args.highTime,
        lowTime: args.lowTime,
        complete: args.complete,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("sessions", args);
    }
  },
});

// Backfill sessions for historical data
export const backfillSessions = action({
  args: {
    pair: v.string(),
    startDate: v.string(), // "2024-01-01"
    endDate: v.string(), // "2024-01-17"
  },
  handler: async (ctx, args) => {
    const results: Record<string, { success: boolean; error?: string }> = {};

    // Parse dates
    const start = new Date(args.startDate);
    const end = new Date(args.endDate);

    // Iterate through each day
    const current = new Date(start);
    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];

      // Calculate each session
      for (const session of ["ASIA", "LONDON", "NY"] as const) {
        const key = `${dateStr}-${session}`;
        try {
          const result = await ctx.runAction(
            internal.sessions.calculateSessionFromCandles,
            {
              pair: args.pair,
              date: dateStr,
              session,
            }
          );
          results[key] = { success: result.success, error: result.error };
        } catch (error) {
          results[key] = {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }

      // Move to next day
      current.setDate(current.getDate() + 1);
    }

    return results;
  },
});

// Calculate all sessions for today (call periodically or on demand)
export const calculateTodaySessions = action({
  args: {
    pair: v.string(),
  },
  handler: async (ctx, args) => {
    // Get today's date in NY timezone
    const now = Date.now();
    const NYOffsetMs = 5 * 60 * 60 * 1000;
    const nyDate = new Date(now - NYOffsetMs);
    const dateStr = nyDate.toISOString().split("T")[0];

    const results: Record<string, { success: boolean; error?: string }> = {};

    for (const session of ["ASIA", "LONDON", "NY"] as const) {
      try {
        const result = await ctx.runAction(
          internal.sessions.calculateSessionFromCandles,
          {
            pair: args.pair,
            date: dateStr,
            session,
          }
        );
        results[session] = { success: result.success, error: result.error };
      } catch (error) {
        results[session] = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    return results;
  },
});
