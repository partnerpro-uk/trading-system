/**
 * Database Writer for Historical Backfill
 *
 * Handles batch inserts to ClickHouse (all historical data) and
 * TimescaleDB (last 30 days only).
 */

import { createClient, ClickHouseClient } from "@clickhouse/client";
import { Pool } from "pg";
import { NewsEventRecord } from "../lib/ff-parser";

// How many days back to also insert into TimescaleDB
const TIMESCALE_LOOKBACK_DAYS = 30;

export class DatabaseWriter {
  private clickhouse: ClickHouseClient;
  private timescale: Pool;
  private timescaleCutoff: Date;
  private totalClickHouseInserts: number = 0;
  private totalTimescaleInserts: number = 0;

  constructor() {
    // Initialize ClickHouse client
    if (!process.env.CLICKHOUSE_HOST) {
      throw new Error("CLICKHOUSE_HOST environment variable is not set");
    }

    this.clickhouse = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
      request_timeout: 60000, // 60 second timeout for batch inserts
    });

    // Initialize TimescaleDB pool
    if (!process.env.TIMESCALE_URL) {
      throw new Error("TIMESCALE_URL environment variable is not set");
    }

    const connUrl = process.env.TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");
    this.timescale = new Pool({
      connectionString: connUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });

    // Calculate cutoff date for TimescaleDB inserts
    this.timescaleCutoff = new Date();
    this.timescaleCutoff.setDate(this.timescaleCutoff.getDate() - TIMESCALE_LOOKBACK_DAYS);
  }

  /**
   * Insert a batch of events to ClickHouse.
   */
  async insertToClickHouse(events: NewsEventRecord[]): Promise<number> {
    if (events.length === 0) return 0;

    const rows = events.map((e) => ({
      event_id: e.eventId,
      event_type: e.eventType,
      name: e.name,
      country: e.country,
      currency: e.currency,
      timestamp: e.timestamp.toISOString().replace("T", " ").replace("Z", ""),
      impact: e.impact,
      actual: e.actual || null,
      forecast: e.forecast || null,
      previous: e.previous || null,
      description: null, // Not available from FF
      datetime_utc: e.datetimeUtc,
      datetime_new_york: e.datetimeNewYork,
      datetime_london: e.datetimeLondon,
      source_tz: e.sourceTz,
      trading_session: e.tradingSession,
      window_before_minutes: 15,
      window_after_minutes: e.impact === "high" ? 60 : 15,
      raw_source: "forexfactory",
    }));

    try {
      await this.clickhouse.insert({
        table: "news_events",
        values: rows,
        format: "JSONEachRow",
      });

      this.totalClickHouseInserts += events.length;
      return events.length;
    } catch (error) {
      console.error("[DB] ClickHouse insert error:", error);
      throw error;
    }
  }

  /**
   * Insert a batch of events to TimescaleDB (only recent events).
   */
  async insertToTimescale(events: NewsEventRecord[]): Promise<number> {
    // Filter to only events within the lookback window
    const recentEvents = events.filter((e) => e.timestamp >= this.timescaleCutoff);

    if (recentEvents.length === 0) return 0;

    const BATCH_SIZE = 50;
    let inserted = 0;

    for (let i = 0; i < recentEvents.length; i += BATCH_SIZE) {
      const batch = recentEvents.slice(i, i + BATCH_SIZE);

      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((e, idx) => {
        const offset = idx * 17;
        placeholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17})`
        );
        values.push(
          e.eventId,
          e.eventType,
          e.name,
          e.country,
          e.currency,
          e.timestamp,
          e.impact,
          e.actual,
          e.forecast,
          e.previous,
          e.datetimeUtc,
          e.datetimeNewYork,
          e.datetimeLondon,
          e.sourceTz,
          e.dayOfWeek,
          e.tradingSession,
          e.status
        );
      });

      try {
        await this.timescale.query(
          `INSERT INTO news_events (
            event_id, event_type, name, country, currency, timestamp, impact,
            actual, forecast, previous, datetime_utc, datetime_new_york,
            datetime_london, source_tz, day_of_week, trading_session, status
          )
          VALUES ${placeholders.join(", ")}
          ON CONFLICT (event_id) DO UPDATE SET
            actual = EXCLUDED.actual,
            forecast = EXCLUDED.forecast,
            previous = EXCLUDED.previous,
            status = EXCLUDED.status`,
          values
        );
        inserted += batch.length;
      } catch (error) {
        console.error("[DB] TimescaleDB insert error:", error);
        // Continue with next batch, don't fail entire operation
      }
    }

    this.totalTimescaleInserts += inserted;
    return inserted;
  }

  /**
   * Insert a batch of events to both databases.
   */
  async insertBatch(events: NewsEventRecord[]): Promise<{ clickhouse: number; timescale: number }> {
    const clickhouseCount = await this.insertToClickHouse(events);
    const timescaleCount = await this.insertToTimescale(events);

    return {
      clickhouse: clickhouseCount,
      timescale: timescaleCount,
    };
  }

  /**
   * Get total insert counts.
   */
  getStats(): { clickhouse: number; timescale: number } {
    return {
      clickhouse: this.totalClickHouseInserts,
      timescale: this.totalTimescaleInserts,
    };
  }

  /**
   * Close database connections.
   */
  async close(): Promise<void> {
    await Promise.all([this.clickhouse.close(), this.timescale.end()]);
    console.log("[DB] Database connections closed");
  }

  /**
   * Test database connections.
   */
  async testConnections(): Promise<boolean> {
    try {
      // Test ClickHouse
      const chResult = await this.clickhouse.query({
        query: "SELECT 1",
        format: "JSON",
      });
      await chResult.json();
      console.log("[DB] ClickHouse connection OK");

      // Test TimescaleDB
      await this.timescale.query("SELECT 1");
      console.log("[DB] TimescaleDB connection OK");

      return true;
    } catch (error) {
      console.error("[DB] Connection test failed:", error);
      return false;
    }
  }
}
