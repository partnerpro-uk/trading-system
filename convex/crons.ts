import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// M5 candles - fetch every 5 minutes
crons.interval(
  "fetch M5 candles",
  { minutes: 5 },
  internal.oanda.fetchLatestCandles,
  { timeframe: "M5", count: 5 }
);

// M15 candles - fetch every 15 minutes
crons.interval(
  "fetch M15 candles",
  { minutes: 15 },
  internal.oanda.fetchLatestCandles,
  { timeframe: "M15", count: 5 }
);

// M30 candles - fetch every 30 minutes
crons.interval(
  "fetch M30 candles",
  { minutes: 30 },
  internal.oanda.fetchLatestCandles,
  { timeframe: "M30", count: 5 }
);

// H1 candles - fetch every hour
crons.interval(
  "fetch H1 candles",
  { hours: 1 },
  internal.oanda.fetchLatestCandles,
  { timeframe: "H1", count: 5 }
);

// H4 candles - fetch every 4 hours
crons.interval(
  "fetch H4 candles",
  { hours: 4 },
  internal.oanda.fetchLatestCandles,
  { timeframe: "H4", count: 5 }
);

// Daily candles - fetch once per day at 00:05 UTC (after NY close)
crons.cron(
  "fetch D candles",
  "5 0 * * *",
  internal.oanda.fetchLatestCandles,
  { timeframe: "D", count: 5 }
);

// Weekly candles - fetch on Monday at 00:10 UTC
crons.cron(
  "fetch W candles",
  "10 0 * * 1",
  internal.oanda.fetchLatestCandles,
  { timeframe: "W", count: 5 }
);

// Monthly candles - fetch on the 1st of each month at 00:15 UTC
crons.cron(
  "fetch MN candles",
  "15 0 1 * *",
  internal.oanda.fetchLatestCandles,
  { timeframe: "MN", count: 5 }
);

// M5 cleanup - delete candles older than 13 months (Sunday 01:00 UTC)
crons.cron(
  "cleanup old M5 candles",
  "0 1 * * 0",
  internal.candles.cleanupOldM5,
  {}
);

// DXY crons (via Yahoo Finance)
// DXY Daily - fetch once per day at 00:20 UTC
crons.cron(
  "fetch DXY D candles",
  "20 0 * * *",
  internal.yahoo.fetchLatestDXY,
  { timeframe: "D" }
);

// DXY Weekly - fetch on Monday at 00:25 UTC
crons.cron(
  "fetch DXY W candles",
  "25 0 * * 1",
  internal.yahoo.fetchLatestDXY,
  { timeframe: "W" }
);

// DXY Monthly - fetch on the 1st of each month at 00:30 UTC
crons.cron(
  "fetch DXY MN candles",
  "30 0 1 * *",
  internal.yahoo.fetchLatestDXY,
  { timeframe: "MN" }
);

// ═══════════════════════════════════════════════════════════════════════════
// NEWS EVENTS - Economic Calendar
// ═══════════════════════════════════════════════════════════════════════════
// News events are now fetched via external Python scraper + import script
// Run manually: python scraper/ffs.py && npx tsx scripts/import-events-jsonl.ts

// Process recently-released events - fetch candle windows for events that just happened
// Runs every 15 minutes, looks back 2 hours for events needing windows
crons.interval(
  "process recent event windows",
  { minutes: 15 },
  internal.newsEventsActions.processRecentEventWindows,
  {}
);

// ═══════════════════════════════════════════════════════════════════════════
// SESSION H/L CALCULATION
// Calculate session highs/lows after each session ends
// ═══════════════════════════════════════════════════════════════════════════

// After Asia session ends (09:00 UTC = 17:00 Tokyo)
crons.cron(
  "calculate Asia session",
  "5 9 * * 1-5",
  internal.sessions.calculateSessionFromCandles,
  { session: "ASIA" }
);

// After London session ends (16:00 UTC)
crons.cron(
  "calculate London session",
  "5 16 * * 1-5",
  internal.sessions.calculateSessionFromCandles,
  { session: "LONDON" }
);

// After NY session ends (21:00 UTC)
crons.cron(
  "calculate NY session",
  "5 21 * * 1-5",
  internal.sessions.calculateSessionFromCandles,
  { session: "NY" }
);

export default crons;
