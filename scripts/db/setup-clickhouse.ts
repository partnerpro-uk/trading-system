#!/usr/bin/env npx tsx
/**
 * Setup ClickHouse tables directly
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const statements = [
  // Historical candles
  `CREATE TABLE IF NOT EXISTS candles (
    time DateTime64(3) CODEC(DoubleDelta),
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    open Decimal(10, 5) CODEC(Gorilla),
    high Decimal(10, 5) CODEC(Gorilla),
    low Decimal(10, 5) CODEC(Gorilla),
    close Decimal(10, 5) CODEC(Gorilla),
    volume UInt32 CODEC(T64),
    time_to_high_ms UInt32 CODEC(T64),
    time_to_low_ms UInt32 CODEC(T64),
    high_formed_first UInt8,
    body_percent Decimal(5, 2),
    range_pips Decimal(8, 2),
    is_displacement UInt8,
    displacement_score Decimal(5, 2)
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(time)
  ORDER BY (pair, timeframe, time)
  SETTINGS index_granularity = 8192`,

  // Event candle windows
  `CREATE TABLE IF NOT EXISTS event_candle_windows (
    event_id String,
    pair LowCardinality(String),
    window_start DateTime64(3),
    window_end DateTime64(3),
    candle_times Array(DateTime64(3)),
    candle_opens Array(Decimal(10, 5)),
    candle_highs Array(Decimal(10, 5)),
    candle_lows Array(Decimal(10, 5)),
    candle_closes Array(Decimal(10, 5)),
    candle_volumes Array(UInt32),
    candle_count UInt16,
    raw_source LowCardinality(String) DEFAULT 'oanda',
    fetched_at DateTime DEFAULT now(),
    window_version UInt8 DEFAULT 1,
    created_at DateTime DEFAULT now()
  )
  ENGINE = MergeTree()
  ORDER BY (event_id, pair)
  SETTINGS index_granularity = 8192`,

  // Event type statistics
  `CREATE TABLE IF NOT EXISTS event_type_statistics (
    event_type LowCardinality(String),
    pair LowCardinality(String),
    sample_size UInt32,
    date_range_start DateTime,
    date_range_end DateTime,
    avg_spike_pips Decimal(8, 2),
    median_spike_pips Decimal(8, 2),
    max_spike_pips Decimal(8, 2),
    min_spike_pips Decimal(8, 2),
    stddev_spike_pips Decimal(8, 2),
    spike_up_count UInt32,
    spike_down_count UInt32,
    spike_up_pct Decimal(5, 2),
    reversal_within_15m_count UInt32,
    reversal_within_30m_count UInt32,
    reversal_within_60m_count UInt32,
    reversal_within_15m_pct Decimal(5, 2),
    reversal_within_30m_pct Decimal(5, 2),
    reversal_within_60m_pct Decimal(5, 2),
    final_matches_spike_count UInt32,
    final_matches_spike_pct Decimal(5, 2),
    avg_spike_when_no_surprise Decimal(8, 2),
    avg_spike_when_surprise Decimal(8, 2),
    last_updated DateTime DEFAULT now()
  )
  ENGINE = ReplacingMergeTree(last_updated)
  ORDER BY (event_type, pair)`,

  // Backtest results
  `CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID DEFAULT generateUUIDv4(),
    strategy_id String,
    strategy_name String,
    pair LowCardinality(String),
    timeframe LowCardinality(String),
    date_from Date,
    date_to Date,
    total_trades UInt32,
    wins UInt32,
    losses UInt32,
    breakeven UInt32,
    win_rate Decimal(5, 2),
    profit_factor Decimal(8, 2),
    avg_rr Decimal(5, 2),
    max_drawdown Decimal(8, 2),
    max_consecutive_losses UInt8,
    avg_hold_time_minutes UInt32,
    trades_per_week Decimal(5, 2),
    asia_trades UInt32,
    asia_win_rate Decimal(5, 2),
    london_trades UInt32,
    london_win_rate Decimal(5, 2),
    ny_trades UInt32,
    ny_win_rate Decimal(5, 2),
    monday_win_rate Decimal(5, 2),
    tuesday_win_rate Decimal(5, 2),
    wednesday_win_rate Decimal(5, 2),
    thursday_win_rate Decimal(5, 2),
    friday_win_rate Decimal(5, 2),
    created_at DateTime DEFAULT now()
  )
  ENGINE = MergeTree()
  ORDER BY (strategy_id, pair, date_from)`,

  // Backtest trades
  `CREATE TABLE IF NOT EXISTS backtest_trades (
    backtest_id UUID,
    trade_number UInt32,
    pair LowCardinality(String),
    direction LowCardinality(String),
    entry_time DateTime64(3),
    exit_time DateTime64(3),
    entry_price Decimal(10, 5),
    exit_price Decimal(10, 5),
    stop_loss Decimal(10, 5),
    take_profit Decimal(10, 5),
    outcome LowCardinality(String),
    rr_achieved Decimal(5, 2),
    pnl_pips Decimal(8, 2),
    conditions_met Array(String),
    session LowCardinality(String),
    day_of_week UInt8
  )
  ENGINE = MergeTree()
  ORDER BY (backtest_id, entry_time)`,
];

async function main() {
  console.log("🚀 Setting up ClickHouse tables...\n");

  // Test connection
  const versionResult = await clickhouse.query({
    query: "SELECT version()",
    format: "JSONEachRow",
  });
  const version = await versionResult.json();
  console.log(`✓ Connected to ClickHouse v${(version as any)[0]["version()"]}\n`);

  // Execute each statement
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const match = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/);
    const tableName = match ? match[1] : `Statement ${i + 1}`;

    try {
      await clickhouse.command({ query: stmt });
      console.log(`✓ Created: ${tableName}`);
    } catch (err: any) {
      if (err.message?.includes("already exists")) {
        console.log(`✓ Already exists: ${tableName}`);
      } else {
        console.error(`✗ Failed: ${tableName}`, err.message);
      }
    }
  }

  // Verify
  console.log("\n📋 Verifying tables...");
  const tablesResult = await clickhouse.query({
    query: "SHOW TABLES",
    format: "JSONEachRow",
  });
  const tables = (await tablesResult.json()) as any[];
  console.log(`\n✓ Tables created: ${tables.map((t) => t.name).join(", ")}`);

  await clickhouse.close();
  console.log("\n✅ ClickHouse setup complete!");
}

main().catch(console.error);
