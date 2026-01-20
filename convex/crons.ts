import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ═══════════════════════════════════════════════════════════════════════════
// CANDLE FETCHING - DISABLED
// Candles are now stored in ClickHouse (23M+ candles)
// Live data will come from Railway worker → TimescaleDB (future)
// ═══════════════════════════════════════════════════════════════════════════
// Previously had: M5, M15, M30, H1, H4, D, W, MN fetching from OANDA
// Previously had: DXY fetching from Yahoo Finance
// All disabled - data now in ClickHouse

// ═══════════════════════════════════════════════════════════════════════════
// SESSION H/L CALCULATION - DISABLED
// Sessions are now calculated live from candle data in the Chart component
// No need for cron jobs to pre-calculate session H/L
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// NEWS EVENTS - DISABLED
// News events are now stored in TimescaleDB + ClickHouse
// See: docs/trading-system-database-migration.md
// ═══════════════════════════════════════════════════════════════════════════

export default crons;
