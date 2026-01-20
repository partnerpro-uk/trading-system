import { defineSchema } from "convex/server";

// ═══════════════════════════════════════════════════════════════════════════════
// CONVEX SCHEMA - Application Layer Only
// ═══════════════════════════════════════════════════════════════════════════════
//
// Per migration docs (docs/trading-system-database-migration.md):
// - Candles → TimescaleDB (live 30d) + ClickHouse (historical)
// - Sessions → TimescaleDB (session_levels table)
// - News Events → TimescaleDB + ClickHouse
// - Event Reactions/Windows/Stats → TimescaleDB + ClickHouse
//
// REMOVED TABLES:
// - candles (migrated to TimescaleDB/ClickHouse)
// - sessions (migrated to TimescaleDB session_levels)
// - economicEvents (migrated to TimescaleDB/ClickHouse)
// - eventPriceReactions (migrated to TimescaleDB/ClickHouse)
// - eventCandleWindows (migrated to ClickHouse)
// - eventTypeStatistics (migrated to ClickHouse)
//
// Application tables (users, trades, strategies) to be added when auth is implemented
// ═══════════════════════════════════════════════════════════════════════════════

export default defineSchema({
  // Empty schema - all data tables migrated to TimescaleDB/ClickHouse
});
