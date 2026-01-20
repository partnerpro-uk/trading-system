/**
 * Database clients for the triple-database architecture
 *
 * - ClickHouse: Historical candle data (all candles)
 * - TimescaleDB: Live streaming data (M1 + continuous aggregates)
 * - Convex: Application state (trades, strategies, user data)
 */

import { createClient, ClickHouseClient } from "@clickhouse/client";
import { Pool } from "pg";

// Singleton ClickHouse client (server-side only)
let clickhouseClient: ClickHouseClient | null = null;

// Singleton Timescale client (server-side only)
let timescalePool: Pool | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!clickhouseClient) {
    if (!process.env.CLICKHOUSE_HOST) {
      throw new Error("CLICKHOUSE_HOST environment variable is not set");
    }

    clickhouseClient = createClient({
      url: process.env.CLICKHOUSE_HOST,
      username: process.env.CLICKHOUSE_USER || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
      request_timeout: 30000, // 30 second timeout for queries
    });
  }

  return clickhouseClient;
}

// Cleanup function for graceful shutdown
export async function closeClickHouseClient(): Promise<void> {
  if (clickhouseClient) {
    await clickhouseClient.close();
    clickhouseClient = null;
  }
}

/**
 * Get Timescale (PostgreSQL) pool for live/recent data
 */
export function getTimescalePool(): Pool {
  if (!timescalePool) {
    if (!process.env.TIMESCALE_URL) {
      throw new Error("TIMESCALE_URL environment variable is not set");
    }

    // Strip sslmode from URL to use our own ssl config (avoids cert issues)
    const connUrl = process.env.TIMESCALE_URL.replace(/[?&]sslmode=[^&]+/, "");

    timescalePool = new Pool({
      connectionString: connUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }

  return timescalePool;
}

// Cleanup function for Timescale
export async function closeTimescalePool(): Promise<void> {
  if (timescalePool) {
    await timescalePool.end();
    timescalePool = null;
  }
}

// Close all database connections
export async function closeAllConnections(): Promise<void> {
  await Promise.all([closeClickHouseClient(), closeTimescalePool()]);
}
