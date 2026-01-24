// Data Fetching Utilities for Analysis
// Adapted to use existing ClickHouse/TimescaleDB candle API

import type { AnalysisCandle } from "./types";

// Timeframe mapping: various formats → Universal format
export const TIMEFRAME_MAP: Record<string, string> = {
  "1min": "M1",
  "5min": "M5",
  "15min": "M15",
  "30min": "M30",
  "1h": "H1",
  "4h": "H4",
  "1day": "D",
  "1week": "W",
  "1month": "M",
  // Already normalized formats
  M1: "M1",
  M5: "M5",
  M15: "M15",
  M30: "M30",
  H1: "H1",
  H4: "H4",
  D: "D",
  W: "W",
  M: "M",
};

export const mapTimeframe = (tf: string): string => TIMEFRAME_MAP[tf] || tf;

/**
 * Normalize pair format (EURUSD -> EUR_USD)
 */
export const normalizePair = (s: string): string =>
  s.replace(/^([A-Z]{3})([A-Z]{3,})$/, "$1_$2");

/**
 * Fetch candles from ClickHouse via API
 * This replaces the Twelve Data API call
 */
export async function fetchAnalysisCandles(
  pair: string,
  timeframe: string,
  targetCount: number = 3000
): Promise<AnalysisCandle[]> {
  const normalizedPair = normalizePair(pair);
  const normalizedTf = mapTimeframe(timeframe);

  const allCandles: AnalysisCandle[] = [];
  let beforeTimestamp: number | undefined;
  const batchSize = 500;

  while (allCandles.length < targetCount) {
    const params = new URLSearchParams({
      pair: normalizedPair,
      timeframe: normalizedTf,
      limit: batchSize.toString(),
    });

    if (beforeTimestamp) {
      params.set("before", beforeTimestamp.toString());
    }

    const response = await fetch(`/api/candles?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch candles: ${response.status}`);
    }

    const data = await response.json();
    const candles = data.candles as AnalysisCandle[];

    if (!candles || candles.length === 0) {
      break; // No more history available
    }

    // API returns ascending order (oldest first)
    // Prepend older candles to the front
    allCandles.unshift(...candles);

    // Get the oldest timestamp for the next batch
    beforeTimestamp = candles[0].timestamp;

    // If we got fewer candles than requested, we've reached the end
    if (candles.length < batchSize) {
      break;
    }
  }

  // Deduplicate by timestamp (in case of overlap)
  const seen = new Set<number>();
  const deduped = allCandles.filter((c) => {
    if (seen.has(c.timestamp)) return false;
    seen.add(c.timestamp);
    return true;
  });

  // Sort ascending (oldest first)
  deduped.sort((a, b) => a.timestamp - b.timestamp);

  return deduped;
}

/**
 * Parse CSV text into candle data (kept as fallback)
 */
export function parseCsvCandles(
  text: string,
  pair: string = "UNKNOWN",
  timeframe: string = "UNKNOWN"
): AnalysisCandle[] {
  const raw = text.replace(/\r/g, "").trim();
  if (!raw) return [];
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const delim =
    lines[0].includes(",") && !lines[0].includes("\t")
      ? ","
      : lines[0].includes("\t")
      ? "\t"
      : ",";

  const header = lines[0].split(delim).map((s) => s.trim().toLowerCase());
  const idxTime =
    header.findIndex((h) =>
      ["time", "datetime", "date", "timestamp"].includes(h)
    ) ?? -1;
  const idxOpen = header.findIndex((h) => h === "open");
  const idxHigh = header.findIndex((h) => h === "high");
  const idxLow = header.findIndex((h) => h === "low");
  const idxClose = header.findIndex((h) => h === "close");
  const idxVolume = header.findIndex((h) => ["volume", "vol"].includes(h));
  const hasHeaders =
    idxOpen !== -1 && idxHigh !== -1 && idxLow !== -1 && idxClose !== -1;

  const normalizedPair = normalizePair(pair);
  const normalizedTf = mapTimeframe(timeframe);
  const out: AnalysisCandle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim);
    const get = (j: number) => (j >= 0 && j < cols.length ? cols[j].trim() : "");
    const timeStr = hasHeaders ? get(idxTime) : get(0);
    const open = Number(hasHeaders ? get(idxOpen) : get(1));
    const high = Number(hasHeaders ? get(idxHigh) : get(2));
    const low = Number(hasHeaders ? get(idxLow) : get(3));
    const close = Number(hasHeaders ? get(idxClose) : get(4));
    const volume = idxVolume !== -1 ? Number(get(idxVolume)) || 0 : 0;

    if (![open, high, low, close].every(Number.isFinite)) continue;

    // Parse timestamp: handle Unix seconds, Unix ms, or ISO string
    const timeNum = Number(timeStr);
    let timestamp = 0;
    if (!isNaN(timeNum) && timeNum > 0) {
      timestamp = timeNum < 1e12 ? timeNum * 1000 : timeNum; // seconds vs ms
    } else {
      timestamp = new Date(timeStr).getTime() || 0;
    }

    out.push({
      time: timeStr || new Date(timestamp).toISOString(),
      timestamp,
      pair: normalizedPair,
      timeframe: normalizedTf,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return out;
}

/**
 * Validate candle data meets minimum requirements for analysis
 */
export function validateCandlesForAnalysis(
  candles: AnalysisCandle[],
  minCandles: number = 80
): { valid: boolean; error?: string } {
  if (!candles || candles.length === 0) {
    return { valid: false, error: "No candle data available" };
  }
  if (candles.length < minCandles) {
    return {
      valid: false,
      error: `Need at least ${minCandles} candles for analysis, got ${candles.length}`,
    };
  }
  return { valid: true };
}
