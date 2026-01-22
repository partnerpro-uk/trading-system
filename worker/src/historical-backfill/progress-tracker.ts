/**
 * Progress Tracker for Historical Backfill
 *
 * Manages checkpoint state to allow resumable backfill operations.
 * Progress is saved to a JSON file after each day is processed.
 * Supports multiple parallel instances with different progress files.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export interface BackfillProgress {
  lastCompletedDate: string | null; // ISO date string YYYY-MM-DD
  totalEventsScraped: number;
  startedAt: string;
  lastUpdatedAt: string;
  rangeStart: string; // The configured start date for this range
  rangeEnd: string; // The configured end date for this range
  errors: Array<{
    date: string;
    error: string;
    timestamp: string;
  }>;
}

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Current progress file path (set by setProgressFile)
let currentProgressFile = path.join(__dirname, "progress.json");

/**
 * Set the progress file path based on date range.
 * Call this before any other progress functions when running parallel instances.
 */
export function setProgressFile(rangeId: string): void {
  currentProgressFile = path.join(__dirname, `progress-${rangeId}.json`);
  console.log(`[Progress] Using progress file: ${currentProgressFile}`);
}

/**
 * Get the current progress file path.
 */
export function getProgressFile(): string {
  return currentProgressFile;
}

/**
 * Load progress from file, or return initial state.
 */
export function loadProgress(rangeStart?: string, rangeEnd?: string): BackfillProgress {
  try {
    if (fs.existsSync(currentProgressFile)) {
      const data = fs.readFileSync(currentProgressFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("[Progress] Could not load progress file, starting fresh:", error);
  }

  return {
    lastCompletedDate: null,
    totalEventsScraped: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    rangeStart: rangeStart || "2007-01-01",
    rangeEnd: rangeEnd || new Date().toISOString().split("T")[0],
    errors: [],
  };
}

/**
 * Save progress to file.
 */
export function saveProgress(progress: BackfillProgress): void {
  progress.lastUpdatedAt = new Date().toISOString();
  fs.writeFileSync(currentProgressFile, JSON.stringify(progress, null, 2));
}

/**
 * Update progress after completing a day.
 */
export function updateProgress(
  progress: BackfillProgress,
  date: Date,
  eventsCount: number
): void {
  progress.lastCompletedDate = formatDateISO(date);
  progress.totalEventsScraped += eventsCount;
  saveProgress(progress);
}

/**
 * Log an error for a specific date.
 */
export function logError(progress: BackfillProgress, date: Date, error: Error): void {
  progress.errors.push({
    date: formatDateISO(date),
    error: error.message,
    timestamp: new Date().toISOString(),
  });

  // Keep only last 100 errors
  if (progress.errors.length > 100) {
    progress.errors = progress.errors.slice(-100);
  }

  saveProgress(progress);
}

/**
 * Get the start date for backfill (resume from last completed or use configured range start).
 */
export function getStartDate(progress: BackfillProgress): Date {
  if (progress.lastCompletedDate) {
    // Resume from day after last completed
    const lastDate = new Date(progress.lastCompletedDate);
    return addDays(lastDate, 1);
  }

  // Use configured range start
  return new Date(progress.rangeStart);
}

/**
 * Print progress summary.
 */
export function printProgressSummary(progress: BackfillProgress, rangeId?: string): void {
  console.log(`\n=== Backfill Progress ${rangeId ? `[${rangeId}]` : ""} ===`);
  console.log(`Range: ${progress.rangeStart} to ${progress.rangeEnd}`);
  console.log(`Started: ${progress.startedAt}`);
  console.log(`Last updated: ${progress.lastUpdatedAt}`);
  console.log(`Last completed: ${progress.lastCompletedDate || "Not started"}`);
  console.log(`Total events: ${progress.totalEventsScraped.toLocaleString()}`);
  console.log(`Errors logged: ${progress.errors.length}`);
  console.log("========================\n");
}

/**
 * Clear progress (for testing/restart).
 */
export function clearProgress(): void {
  if (fs.existsSync(currentProgressFile)) {
    fs.unlinkSync(currentProgressFile);
    console.log("[Progress] Progress file cleared");
  }
}

/**
 * List all progress files.
 */
export function listProgressFiles(): string[] {
  const files = fs.readdirSync(__dirname);
  return files.filter((f) => f.startsWith("progress") && f.endsWith(".json"));
}

// Helper functions
function formatDateISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
