#!/usr/bin/env npx tsx
/**
 * Setup Timescale Cloud with full schema + continuous aggregates
 */

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });

const { Client } = pg;

const client = new Client({
  connectionString: process.env.TIMESCALE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log("🚀 Setting up Timescale Cloud...\n");

  await client.connect();
  console.log("✓ Connected to Timescale Cloud\n");

  // Check TimescaleDB version
  const versionResult = await client.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
  );
  if (versionResult.rows.length > 0) {
    console.log(`✓ TimescaleDB version: ${versionResult.rows[0].extversion}\n`);
  } else {
    console.log("⚠️ TimescaleDB extension not found, enabling...");
    await client.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
    console.log("✓ TimescaleDB enabled\n");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("Creating tables...\n");

  // Candles table
  await client.query(`
    CREATE TABLE IF NOT EXISTS candles (
      time TIMESTAMPTZ NOT NULL,
      pair VARCHAR(10) NOT NULL,
      timeframe VARCHAR(5) NOT NULL,
      open DECIMAL(10, 5) NOT NULL,
      high DECIMAL(10, 5) NOT NULL,
      low DECIMAL(10, 5) NOT NULL,
      close DECIMAL(10, 5) NOT NULL,
      volume INTEGER DEFAULT 0,
      complete BOOLEAN DEFAULT true,
      PRIMARY KEY (time, pair, timeframe)
    )
  `);
  console.log("  ✓ candles");

  // Convert to hypertable
  try {
    await client.query(`
      SELECT create_hypertable('candles', 'time', if_not_exists => TRUE)
    `);
    console.log("  ✓ candles → hypertable");
  } catch (err: any) {
    if (err.message.includes("already a hypertable")) {
      console.log("  ✓ candles already a hypertable");
    } else {
      console.log("  ⚠️ hypertable:", err.message);
    }
  }

  // Indexes
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_candles_pair_tf_time
    ON candles (pair, timeframe, time DESC)
  `);
  console.log("  ✓ candles indexes");

  // News events
  await client.query(`
    CREATE TABLE IF NOT EXISTS news_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id VARCHAR(100) UNIQUE NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      country VARCHAR(10) NOT NULL,
      currency VARCHAR(5) NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      impact VARCHAR(10) NOT NULL,
      actual VARCHAR(50),
      forecast VARCHAR(50),
      previous VARCHAR(50),
      description TEXT,
      window_before_minutes INTEGER DEFAULT 15,
      window_after_minutes INTEGER NOT NULL,
      raw_source VARCHAR(20) DEFAULT 'jblanked',
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("  ✓ news_events");

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_news_timestamp ON news_events (timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_news_type ON news_events (event_type);
    CREATE INDEX IF NOT EXISTS idx_news_currency ON news_events (currency);
    CREATE INDEX IF NOT EXISTS idx_news_impact ON news_events (impact);
  `);
  console.log("  ✓ news_events indexes");

  // Price reactions
  await client.query(`
    CREATE TABLE IF NOT EXISTS event_price_reactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id VARCHAR(100) NOT NULL REFERENCES news_events(event_id),
      pair VARCHAR(10) NOT NULL,
      price_at_minus_15m DECIMAL(10, 5),
      price_at_minus_5m DECIMAL(10, 5),
      price_at_event DECIMAL(10, 5) NOT NULL,
      spike_high DECIMAL(10, 5) NOT NULL,
      spike_low DECIMAL(10, 5) NOT NULL,
      spike_direction VARCHAR(10) NOT NULL,
      spike_magnitude_pips DECIMAL(8, 2) NOT NULL,
      time_to_spike_seconds INTEGER,
      price_at_plus_5m DECIMAL(10, 5),
      price_at_plus_15m DECIMAL(10, 5),
      price_at_plus_30m DECIMAL(10, 5),
      price_at_plus_60m DECIMAL(10, 5),
      pattern_type VARCHAR(50) NOT NULL,
      did_reverse BOOLEAN NOT NULL,
      reversal_magnitude_pips DECIMAL(8, 2),
      final_matches_spike BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("  ✓ event_price_reactions");

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_epr_event ON event_price_reactions (event_id);
    CREATE INDEX IF NOT EXISTS idx_epr_pair ON event_price_reactions (pair);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_epr_event_pair ON event_price_reactions (event_id, pair);
  `);
  console.log("  ✓ event_price_reactions indexes");

  // Session levels
  await client.query(`
    CREATE TABLE IF NOT EXISTS session_levels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pair VARCHAR(10) NOT NULL,
      date DATE NOT NULL,
      asia_high DECIMAL(10, 5),
      asia_low DECIMAL(10, 5),
      london_high DECIMAL(10, 5),
      london_low DECIMAL(10, 5),
      ny_high DECIMAL(10, 5),
      ny_low DECIMAL(10, 5),
      daily_high DECIMAL(10, 5),
      daily_low DECIMAL(10, 5),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(pair, date)
    )
  `);
  console.log("  ✓ session_levels");

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTINUOUS AGGREGATES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\nCreating continuous aggregates...\n");

  // M5 from M1
  try {
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS candles_m5
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('5 minutes', time) AS time,
        pair,
        'M5'::VARCHAR(5) AS timeframe,
        first(open, time) AS open,
        max(high) AS high,
        min(low) AS low,
        last(close, time) AS close,
        sum(volume) AS volume
      FROM candles
      WHERE timeframe = 'M1'
      GROUP BY time_bucket('5 minutes', time), pair
      WITH NO DATA
    `);
    console.log("  ✓ candles_m5 (continuous aggregate)");
  } catch (err: any) {
    if (err.message.includes("already exists")) {
      console.log("  ✓ candles_m5 already exists");
    } else {
      console.log("  ⚠️ candles_m5:", err.message);
    }
  }

  // M15 from M1
  try {
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS candles_m15
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('15 minutes', time) AS time,
        pair,
        'M15'::VARCHAR(5) AS timeframe,
        first(open, time) AS open,
        max(high) AS high,
        min(low) AS low,
        last(close, time) AS close,
        sum(volume) AS volume
      FROM candles
      WHERE timeframe = 'M1'
      GROUP BY time_bucket('15 minutes', time), pair
      WITH NO DATA
    `);
    console.log("  ✓ candles_m15 (continuous aggregate)");
  } catch (err: any) {
    if (err.message.includes("already exists")) {
      console.log("  ✓ candles_m15 already exists");
    } else {
      console.log("  ⚠️ candles_m15:", err.message);
    }
  }

  // H1 from M1
  try {
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS candles_h1
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 hour', time) AS time,
        pair,
        'H1'::VARCHAR(5) AS timeframe,
        first(open, time) AS open,
        max(high) AS high,
        min(low) AS low,
        last(close, time) AS close,
        sum(volume) AS volume
      FROM candles
      WHERE timeframe = 'M1'
      GROUP BY time_bucket('1 hour', time), pair
      WITH NO DATA
    `);
    console.log("  ✓ candles_h1 (continuous aggregate)");
  } catch (err: any) {
    if (err.message.includes("already exists")) {
      console.log("  ✓ candles_h1 already exists");
    } else {
      console.log("  ⚠️ candles_h1:", err.message);
    }
  }

  // H4 from H1
  try {
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS candles_h4
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('4 hours', time) AS time,
        pair,
        'H4'::VARCHAR(5) AS timeframe,
        first(open, time) AS open,
        max(high) AS high,
        min(low) AS low,
        last(close, time) AS close,
        sum(volume) AS volume
      FROM candles_h1
      GROUP BY time_bucket('4 hours', time), pair
      WITH NO DATA
    `);
    console.log("  ✓ candles_h4 (continuous aggregate from h1)");
  } catch (err: any) {
    if (err.message.includes("already exists")) {
      console.log("  ✓ candles_h4 already exists");
    } else {
      console.log("  ⚠️ candles_h4:", err.message);
    }
  }

  // D1 from H1
  try {
    await client.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS candles_d1
      WITH (timescaledb.continuous) AS
      SELECT
        time_bucket('1 day', time) AS time,
        pair,
        'D'::VARCHAR(5) AS timeframe,
        first(open, time) AS open,
        max(high) AS high,
        min(low) AS low,
        last(close, time) AS close,
        sum(volume) AS volume
      FROM candles_h1
      GROUP BY time_bucket('1 day', time), pair
      WITH NO DATA
    `);
    console.log("  ✓ candles_d1 (continuous aggregate from h1)");
  } catch (err: any) {
    if (err.message.includes("already exists")) {
      console.log("  ✓ candles_d1 already exists");
    } else {
      console.log("  ⚠️ candles_d1:", err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REFRESH POLICIES
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\nAdding refresh policies...\n");

  const policies = [
    { view: "candles_m5", start: "1 hour", end: "5 minutes", interval: "5 minutes" },
    { view: "candles_m15", start: "2 hours", end: "15 minutes", interval: "15 minutes" },
    { view: "candles_h1", start: "6 hours", end: "1 hour", interval: "1 hour" },
    { view: "candles_h4", start: "1 day", end: "4 hours", interval: "4 hours" },
    { view: "candles_d1", start: "3 days", end: "1 day", interval: "1 day" },
  ];

  for (const p of policies) {
    try {
      await client.query(`
        SELECT add_continuous_aggregate_policy('${p.view}',
          start_offset => INTERVAL '${p.start}',
          end_offset => INTERVAL '${p.end}',
          schedule_interval => INTERVAL '${p.interval}',
          if_not_exists => TRUE
        )
      `);
      console.log(`  ✓ ${p.view} refresh policy`);
    } catch (err: any) {
      console.log(`  ⚠️ ${p.view} policy: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\nCreating functions...\n");

  await client.query(`
    CREATE OR REPLACE FUNCTION get_candles(
      p_pair VARCHAR,
      p_timeframe VARCHAR,
      p_start TIMESTAMPTZ,
      p_end TIMESTAMPTZ DEFAULT NOW()
    )
    RETURNS TABLE (
      "time" TIMESTAMPTZ,
      "open" DECIMAL,
      "high" DECIMAL,
      "low" DECIMAL,
      "close" DECIMAL,
      "volume" INTEGER
    ) AS $$
    BEGIN
      RETURN QUERY
      SELECT c.time, c.open, c.high, c.low, c.close, c.volume::INTEGER
      FROM candles c
      WHERE c.pair = p_pair
      AND c.timeframe = p_timeframe
      AND c.time BETWEEN p_start AND p_end
      ORDER BY c.time ASC;
    END;
    $$ LANGUAGE plpgsql
  `);
  console.log("  ✓ get_candles function");

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFY
  // ═══════════════════════════════════════════════════════════════════════════

  console.log("\n📋 Verifying setup...\n");

  const tables = await client.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);
  console.log(`Tables: ${tables.rows.map((r) => r.tablename).join(", ")}`);

  const views = await client.query(`
    SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'
  `);
  console.log(`Continuous Aggregates: ${views.rows.map((r) => r.matviewname).join(", ")}`);

  await client.end();

  console.log("\n✅ Timescale Cloud setup complete!");
}

main().catch(console.error);
