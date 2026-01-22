#!/usr/bin/env npx tsx
/**
 * Historical ForexFactory Backfill Script
 *
 * Scrapes historical economic events from ForexFactory and stores them in
 * ClickHouse and TimescaleDB.
 *
 * Usage:
 *   npx tsx src/historical-backfill/backfill.ts                           # Full backfill (2007 to now)
 *   npx tsx src/historical-backfill/backfill.ts --from 2007-01-01 --to 2011-12-31  # Date range
 *   npx tsx src/historical-backfill/backfill.ts --reset                   # Clear progress
 *   npx tsx src/historical-backfill/backfill.ts --status                  # Show progress
 *
 * For parallel execution, run multiple instances with different date ranges:
 *   npx tsx src/historical-backfill/backfill.ts --from 2007-01-01 --to 2011-12-31 &
 *   npx tsx src/historical-backfill/backfill.ts --from 2012-01-01 --to 2016-12-31 &
 *   npx tsx src/historical-backfill/backfill.ts --from 2017-01-01 --to 2021-12-31 &
 *   npx tsx src/historical-backfill/backfill.ts --from 2022-01-01 --to 2026-01-18 &
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load env from parent .env.local and local .env.local
config({ path: resolve(process.cwd(), "../.env.local") });
config({ path: resolve(process.cwd(), ".env.local") });

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import {
  loadProgress,
  saveProgress,
  updateProgress,
  logError,
  getStartDate,
  printProgressSummary,
  clearProgress,
  setProgressFile,
  BackfillProgress,
} from "./progress-tracker";
import { RateLimiter } from "./rate-limiter";
import { DatabaseWriter } from "./db-writer";
import {
  buildEventRecord,
  buildWeekUrl,
  buildDateUrl,
  parseDateString,
  parseTimeString,
  NewsEventRecord,
  TZ_NEW_YORK,
} from "../lib/ff-parser";
import { fromZonedTime } from "date-fns-tz";

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Configuration
const FOREX_FACTORY_URL = "https://www.forexfactory.com";
const BATCH_SIZE = 100; // Events per batch insert
const DEFAULT_START_DATE = "2007-01-01";

// Global state
let isShuttingDown = false;
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
let timezoneConfigured = false;
let rangeId = "default";

/**
 * Parse command line arguments.
 */
function parseArgs(): { from: string; to: string; reset: boolean; status: boolean; daily: boolean } {
  const args = process.argv.slice(2);
  let from = DEFAULT_START_DATE;
  let to = getDefaultEndDate();
  let reset = false;
  let status = false;
  let daily = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      from = args[i + 1];
      i++;
    } else if (args[i] === "--to" && args[i + 1]) {
      to = args[i + 1];
      i++;
    } else if (args[i] === "--reset") {
      reset = true;
    } else if (args[i] === "--status") {
      status = true;
    } else if (args[i] === "--daily") {
      daily = true;
    }
  }

  return { from, to, reset, status, daily };
}

/**
 * Get default end date (2 days before today).
 */
function getDefaultEndDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 2);
  return date.toISOString().split("T")[0];
}

/**
 * Generate a range ID from dates (used for progress file naming).
 */
function generateRangeId(from: string, to: string): string {
  const fromYear = from.split("-")[0];
  const toYear = to.split("-")[0];
  return `${fromYear}-${toYear}`;
}

/**
 * Launch browser with stealth mode.
 */
async function launchBrowser() {
  console.log(`[${rangeId}] Launching browser...`);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920x1080",
    ],
  });
  console.log(`[${rangeId}] Browser launched`);
  return browser;
}

/**
 * Configure ForexFactory timezone to Eastern Time.
 */
async function configureTimezone(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>
): Promise<void> {
  if (timezoneConfigured) return;

  console.log(`[${rangeId}] Configuring ForexFactory timezone...`);

  try {
    await page.emulateTimezone("America/New_York");

    await page.goto("https://www.forexfactory.com/timezone.php", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("a, button, span"));
      const matchBtn = buttons.find((b) => b.textContent?.includes("Match Device Time"));
      if (matchBtn) {
        (matchBtn as HTMLElement).click();
        return true;
      }
      return false;
    });

    if (clicked) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log(`[${rangeId}] Timezone set to Eastern Time`);
      timezoneConfigured = true;
    } else {
      console.warn(`[${rangeId}] Could not find 'Match Device Time' button`);
    }
  } catch (error) {
    console.error(`[${rangeId}] Timezone configuration error:`, error);
  }
}

// Global flag for daily mode
let useDailyMode = false;

/**
 * Scrape a single day's calendar page.
 */
async function scrapeDayPage(date: Date): Promise<NewsEventRecord[]> {
  if (!browser) throw new Error("Browser not initialized");

  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.emulateTimezone("America/New_York");

    // Configure timezone on first request
    await configureTimezone(page);

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate to calendar page (day or week view)
    const calendarUrl = useDailyMode ? buildDateUrl(date) : buildWeekUrl(date);
    const url = `${FOREX_FACTORY_URL}/${calendarUrl}`;

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Wait for calendar table
    try {
      await page.waitForSelector("table.calendar__table", { timeout: 15000 });
    } catch {
      // No events for this day (weekends, holidays)
      return [];
    }

    // Scroll to trigger lazy loading
    await autoScroll(page);

    // Parse content
    const content = await page.content();
    return parseCalendarHtml(content, date);
  } finally {
    await page.close();
  }
}

/**
 * Auto-scroll to trigger lazy loading.
 */
async function autoScroll(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>
) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const scrollHeight = document.body.scrollHeight;
      const step = scrollHeight / 4;
      let scrolled = 0;

      const timer = setInterval(() => {
        scrolled += step;
        window.scrollTo(0, scrolled);

        if (scrolled >= scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 200);
    });
  });

  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Parse calendar HTML using Cheerio.
 */
function parseCalendarHtml(html: string, referenceDate: Date): NewsEventRecord[] {
  const $ = cheerio.load(html);
  const events: NewsEventRecord[] = [];
  const referenceYear = referenceDate.getFullYear();

  let currentDate: { month: number; day: number } | null = null;
  let currentTime: { hour: number; minute: number; isAllDay: boolean; isDataMarker: boolean } | null =
    null;

  const rows = $("tr.calendar__row").not(".calendar__row--day-breaker");

  rows.each((_, row) => {
    try {
      const $row = $(row);

      // Check for date cell
      const dateCell = $row.find("td.calendar__date").text().trim();
      if (dateCell) {
        const parsed = parseDateString(dateCell, referenceYear);
        if (parsed) {
          currentDate = parsed;
          currentTime = null;
        }
      }

      if (!currentDate) return;

      // Extract time
      const timeCell = $row.find("td.calendar__time").text().trim();
      if (timeCell) {
        const parsedTime = parseTimeString(timeCell);
        if (parsedTime) {
          currentTime = parsedTime;
        }
      }

      if (!currentTime || currentTime.isDataMarker) return;

      // Extract other fields
      const currency = $row.find("td.calendar__currency").text().trim();
      const impactSpan = $row.find("td.calendar__impact span");
      const rawImpact = impactSpan.attr("title") || "";
      const eventName = $row.find("td.calendar__event").text().trim();
      const actual = $row.find("td.calendar__actual").text().trim() || null;
      const forecast = $row.find("td.calendar__forecast").text().trim() || null;
      const previous = $row.find("td.calendar__previous").text().trim() || null;

      if (!currency || !eventName) return;

      // Build datetime
      const estDateStr = `${referenceYear}-${String(currentDate.month + 1).padStart(2, "0")}-${String(currentDate.day).padStart(2, "0")}T${String(currentTime.hour).padStart(2, "0")}:${String(currentTime.minute).padStart(2, "0")}:00`;
      const utcTimestamp = fromZonedTime(estDateStr, TZ_NEW_YORK);

      // Build record
      const record = buildEventRecord(
        utcTimestamp,
        currency,
        rawImpact,
        eventName,
        actual,
        forecast,
        previous
      );

      events.push(record);
    } catch {
      // Skip row errors
    }
  });

  return events;
}

/**
 * Main backfill loop.
 */
async function runBackfill(fromDate: string, toDate: string): Promise<void> {
  // Load progress
  const progress = loadProgress(fromDate, toDate);
  printProgressSummary(progress, rangeId);

  // Initialize components
  const rateLimiter = new RateLimiter({ minDelayMs: 3000, maxDelayMs: 120000 });
  const dbWriter = new DatabaseWriter();

  // Test database connections
  console.log(`[${rangeId}] Testing database connections...`);
  if (!(await dbWriter.testConnections())) {
    throw new Error("Database connection test failed");
  }

  // Launch browser
  await launchBrowser();

  // Calculate date range
  const startDate = getStartDate(progress);
  const endDate = new Date(toDate);

  // Check if already complete
  if (startDate > endDate) {
    console.log(`[${rangeId}] Range already complete!`);
    await cleanup(dbWriter);
    return;
  }

  console.log(`[${rangeId}] Scraping from ${formatDate(startDate)} to ${formatDate(endDate)}`);
  console.log(`[${rangeId}] Mode: ${useDailyMode ? "DAY-BY-DAY" : "WEEK VIEW"}`);
  if (useDailyMode) {
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    console.log(`[${rangeId}] Estimated days: ${totalDays} (~${Math.ceil(totalDays * 5 / 7)} weekdays)`);
  } else {
    console.log(
      `[${rangeId}] Estimated weeks: ${Math.ceil((endDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000))}`
    );
  }
  console.log("");

  let currentDate = new Date(startDate);
  let eventBatch: NewsEventRecord[] = [];
  let weeksProcessed = 0;
  let lastLogTime = Date.now();

  // Setup graceful shutdown
  setupShutdownHandlers(progress, eventBatch, dbWriter);

  // Main loop
  while (currentDate <= endDate && !isShuttingDown) {
    // Skip weekends in daily mode (no events on Sat/Sun)
    if (useDailyMode) {
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }
    }

    try {
      await rateLimiter.wait();

      // Scrape the day/week
      const events = await scrapeDayPage(currentDate);
      rateLimiter.onSuccess();

      eventBatch.push(...events);

      // Batch insert when we have enough
      if (eventBatch.length >= BATCH_SIZE) {
        const { clickhouse, timescale } = await dbWriter.insertBatch(eventBatch);
        if (timescale > 0) {
          console.log(
            `[${rangeId}] Inserted ${clickhouse} to ClickHouse, ${timescale} to TimescaleDB`
          );
        }
        eventBatch = [];
      }

      // Update progress
      updateProgress(progress, currentDate, events.length);
      weeksProcessed++;

      // Log progress every 30 seconds
      if (Date.now() - lastLogTime > 30000) {
        const modeLabel = useDailyMode ? "Days" : "Weeks";
        console.log(
          `[${rangeId}] Progress: ${formatDate(currentDate)} | ` +
            `${events.length} events | ` +
            `Total: ${progress.totalEventsScraped.toLocaleString()} | ` +
            `${modeLabel}: ${weeksProcessed}`
        );
        lastLogTime = Date.now();
      }

      // Move to next day or week
      currentDate.setDate(currentDate.getDate() + (useDailyMode ? 1 : 7));
    } catch (error) {
      logError(progress, currentDate, error as Error);
      console.error(`[${rangeId}] Error on ${formatDate(currentDate)}:`, error);

      // Still move to next period on error
      if (!rateLimiter.onError()) {
        console.error(`[${rangeId}] Max retries exceeded, stopping`);
        break;
      }

      currentDate.setDate(currentDate.getDate() + (useDailyMode ? 1 : 7));
    }
  }

  // Flush remaining batch
  if (eventBatch.length > 0 && !isShuttingDown) {
    console.log(`[${rangeId}] Flushing final batch of ${eventBatch.length} events`);
    await dbWriter.insertBatch(eventBatch);
  }

  // Cleanup
  await cleanup(dbWriter);

  // Final summary
  console.log(`\n=== Backfill Complete [${rangeId}] ===`);
  printProgressSummary(progress, rangeId);
  const stats = dbWriter.getStats();
  console.log(`Total inserted to ClickHouse: ${stats.clickhouse.toLocaleString()}`);
  console.log(`Total inserted to TimescaleDB: ${stats.timescale.toLocaleString()}`);
}

/**
 * Setup graceful shutdown handlers.
 */
function setupShutdownHandlers(
  progress: BackfillProgress,
  eventBatch: NewsEventRecord[],
  dbWriter: DatabaseWriter
): void {
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[${rangeId}] Graceful shutdown initiated...`);

    // Flush remaining batch
    if (eventBatch.length > 0) {
      console.log(`[${rangeId}] Flushing ${eventBatch.length} pending events...`);
      try {
        await dbWriter.insertBatch(eventBatch);
      } catch {
        console.error(`[${rangeId}] Failed to flush batch on shutdown`);
      }
    }

    // Save progress
    saveProgress(progress);
    console.log(`[${rangeId}] Progress saved`);

    await cleanup(dbWriter);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Cleanup resources.
 */
async function cleanup(dbWriter: DatabaseWriter): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    console.log(`[${rangeId}] Browser closed`);
  }

  await dbWriter.close();
}

/**
 * Format date for display.
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const { from, to, reset, status, daily } = parseArgs();
  rangeId = generateRangeId(from, to);
  useDailyMode = daily;

  // Set progress file for this range (add -daily suffix if in daily mode)
  setProgressFile(daily ? `${rangeId}-daily` : rangeId);

  if (reset) {
    clearProgress();
    console.log(`Progress cleared for range ${rangeId}. Run again without --reset to start fresh.`);
    return;
  }

  if (status) {
    const progress = loadProgress(from, to);
    printProgressSummary(progress, rangeId);
    return;
  }

  console.log("===========================================");
  console.log(`  ForexFactory Historical Backfill [${rangeId}]`);
  console.log(`  Range: ${from} to ${to}`);
  console.log(`  Mode: ${daily ? "DAY-BY-DAY (catch missed events)" : "WEEK VIEW"}`);
  console.log("===========================================\n");

  try {
    await runBackfill(from, to);
  } catch (error) {
    console.error(`[${rangeId}] Fatal error:`, error);
    process.exit(1);
  }
}

main();
