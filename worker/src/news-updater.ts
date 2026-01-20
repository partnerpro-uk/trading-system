/**
 * News Updater Module
 *
 * Scrapes ForexFactory calendar using Puppeteer and updates TimescaleDB.
 * Runs event-driven (5 min after scheduled releases) with 30-min fallback.
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import { Pool } from "pg";
import {
  buildEventRecord,
  buildDateUrl,
  parseDateString,
  parseTimeString,
  normalizeImpact,
  NewsEventRecord,
  TZ_NEW_YORK,
} from "./lib/ff-parser";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const FOREX_FACTORY_URL = "https://www.forexfactory.com";
const SCRAPE_DELAY_MS = 5 * 60 * 1000; // 5 minutes after event
const FALLBACK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MARKET_HOURS_START = 6; // 6am UK time
const MARKET_HOURS_END = 18; // 6pm UK time

// Browser instance (reused to avoid cold starts)
let browserInstance: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

/**
 * Get or create browser instance.
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.connected) {
    console.log("[News] Launching Puppeteer browser...");
    browserInstance = await puppeteer.launch({
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
    console.log("[News] Browser launched");
  }
  return browserInstance;
}

/**
 * Close browser instance.
 */
async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
    console.log("[News] Browser closed");
  }
}

/**
 * Scrape a single day's calendar page from ForexFactory.
 */
async function scrapeCalendarPage(date: Date): Promise<NewsEventRecord[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });

    // Set timezone to America/New_York to ensure ForexFactory shows Eastern Time
    // This is critical - FF auto-detects browser timezone
    await page.emulateTimezone("America/New_York");

    // Block images and stylesheets for faster loading
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate to calendar page
    const dateUrl = buildDateUrl(date);
    const url = `${FOREX_FACTORY_URL}/${dateUrl}`;
    console.log(`[News] Fetching: ${url} (timezone: America/New_York)`);

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Wait for calendar table to load
    await page.waitForSelector("table.calendar__table", { timeout: 30000 });

    // Scroll to trigger lazy loading (ForexFactory loads actuals dynamically)
    await autoScroll(page);

    // Get page content
    const content = await page.content();
    const events = parseCalendarHtml(content, date);

    console.log(`[News] Parsed ${events.length} events for ${formatInTimeZone(date, "UTC", "yyyy-MM-dd")}`);
    return events;
  } catch (error) {
    console.error(`[News] Error scraping ${formatInTimeZone(date, "UTC", "yyyy-MM-dd")}:`, error);
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Auto-scroll page to trigger lazy loading.
 */
async function autoScroll(page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>) {
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
      }, 300);
    });
  });

  // Extra wait for any final AJAX loads
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

/**
 * Parse calendar HTML using Cheerio.
 */
function parseCalendarHtml(html: string, referenceDate: Date): NewsEventRecord[] {
  const $ = cheerio.load(html);
  const events: NewsEventRecord[] = [];

  // Get reference year from the date we're scraping
  const referenceYear = referenceDate.getFullYear();

  // Track current date as we iterate (ForexFactory shows date on first row of each day)
  let currentDate: { month: number; day: number } | null = null;

  // Track current time (ForexFactory only shows time on first event of a group)
  let currentTime: { hour: number; minute: number; isAllDay: boolean; isDataMarker: boolean } | null = null;

  // Select all event rows, excluding day-breaker rows
  const rows = $("tr.calendar__row").not(".calendar__row--day-breaker");

  rows.each((_, row) => {
    try {
      const $row = $(row);

      // Check for date cell (only present on first event of each day)
      const dateCell = $row.find("td.calendar__date").text().trim();
      if (dateCell) {
        const parsed = parseDateString(dateCell, referenceYear);
        if (parsed) {
          currentDate = parsed;
          // Reset time when date changes
          currentTime = null;
        }
      }

      // Skip if we don't have a date yet
      if (!currentDate) {
        return;
      }

      // Extract time - ForexFactory only shows time on first event of a group
      // Subsequent events at the same time have empty time cells
      const timeCell = $row.find("td.calendar__time").text().trim();
      if (timeCell) {
        const parsedTime = parseTimeString(timeCell);
        if (parsedTime) {
          currentTime = parsedTime;
        }
      }

      // Skip if we still don't have a time or if it's a "Data" marker
      if (!currentTime || currentTime.isDataMarker) {
        return;
      }

      // Extract other fields
      const currency = $row.find("td.calendar__currency").text().trim();
      const impactSpan = $row.find("td.calendar__impact span");
      const rawImpact = impactSpan.attr("title") || "";
      const eventName = $row.find("td.calendar__event").text().trim();
      const actual = $row.find("td.calendar__actual").text().trim() || null;
      const forecast = $row.find("td.calendar__forecast").text().trim() || null;
      const previous = $row.find("td.calendar__previous").text().trim() || null;

      // Skip empty rows
      if (!currency || !eventName) {
        return;
      }

      // Build the full datetime
      // ForexFactory times are in Eastern Time (America/New_York)
      // We need to properly convert from EST/EDT to UTC

      // Create ISO string with EST timezone offset
      // In January, EST is UTC-5. In summer (EDT), it's UTC-4
      // We'll calculate the proper offset
      const estDateStr = `${referenceYear}-${String(currentDate.month + 1).padStart(2, "0")}-${String(currentDate.day).padStart(2, "0")}T${String(currentTime.hour).padStart(2, "0")}:${String(currentTime.minute).padStart(2, "0")}:00`;

      // Use date-fns-tz to properly handle EST/EDT conversion
      // fromZonedTime converts a date string in a timezone to UTC
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
    } catch (error) {
      // Skip individual row errors
      console.warn("[News] Error parsing row:", error);
    }
  });

  return events;
}

/**
 * Upsert events to TimescaleDB.
 */
async function upsertEvents(pool: Pool, events: NewsEventRecord[]): Promise<number> {
  if (events.length === 0) return 0;

  let upserted = 0;

  // Process in batches to avoid parameter limits
  const BATCH_SIZE = 50;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);

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
      await pool.query(
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
      upserted += batch.length;
    } catch (error) {
      console.error("[News] Error upserting batch:", error);
    }
  }

  return upserted;
}

/**
 * Query upcoming scheduled events from TimescaleDB.
 */
async function getUpcomingScheduledEvents(
  pool: Pool,
  hoursAhead: number = 24
): Promise<Array<{ eventId: string; timestamp: Date; impact: string }>> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  const result = await pool.query(
    `SELECT event_id, timestamp, impact
     FROM news_events
     WHERE timestamp >= $1
       AND timestamp <= $2
       AND status = 'scheduled'
       AND impact IN ('high', 'medium')
     ORDER BY timestamp ASC`,
    [now, cutoff]
  );

  return result.rows.map((row) => ({
    eventId: row.event_id,
    timestamp: new Date(row.timestamp),
    impact: row.impact,
  }));
}

/**
 * Check if we're in UK market hours (6am - 6pm London time).
 */
function isMarketHours(): boolean {
  const now = new Date();
  const londonHour = parseInt(formatInTimeZone(now, "Europe/London", "H"), 10);
  return londonHour >= MARKET_HOURS_START && londonHour < MARKET_HOURS_END;
}

/**
 * Run a single scrape for today and optionally tomorrow.
 */
async function runScrape(pool: Pool): Promise<void> {
  console.log("[News] Starting scrape...");

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  // Scrape today
  const todayEvents = await scrapeCalendarPage(today);
  const todayUpserted = await upsertEvents(pool, todayEvents);
  console.log(`[News] Upserted ${todayUpserted} events for today`);

  // Also scrape tomorrow to get upcoming events
  const tomorrowEvents = await scrapeCalendarPage(tomorrow);
  const tomorrowUpserted = await upsertEvents(pool, tomorrowEvents);
  console.log(`[News] Upserted ${tomorrowUpserted} events for tomorrow`);
}

/**
 * Schedule scrapes based on upcoming events.
 */
function scheduleEventScrapes(
  pool: Pool,
  events: Array<{ eventId: string; timestamp: Date; impact: string }>
): void {
  const now = Date.now();

  for (const event of events) {
    const scrapeTime = event.timestamp.getTime() + SCRAPE_DELAY_MS;
    const delay = scrapeTime - now;

    // Only schedule if in the future
    if (delay > 0) {
      console.log(
        `[News] Scheduling scrape for ${event.eventId} at ${new Date(scrapeTime).toISOString()}`
      );

      setTimeout(async () => {
        console.log(`[News] Event-triggered scrape for ${event.eventId}`);
        try {
          await runScrape(pool);
        } catch (error) {
          console.error("[News] Event scrape error:", error);
        }
      }, delay);
    }
  }
}

/**
 * Start the news updater.
 * Called from main worker index.ts.
 */
export async function startNewsUpdater(pool: Pool): Promise<void> {
  console.log("\n=== Starting News Updater ===\n");

  // Initial scrape
  try {
    await runScrape(pool);
  } catch (error) {
    console.error("[News] Initial scrape failed:", error);
  }

  // Schedule event-driven scrapes
  try {
    const upcoming = await getUpcomingScheduledEvents(pool, 24);
    console.log(`[News] Found ${upcoming.length} upcoming high/medium impact events`);
    scheduleEventScrapes(pool, upcoming);
  } catch (error) {
    console.error("[News] Failed to schedule event scrapes:", error);
  }

  // Fallback interval scraping during market hours
  setInterval(async () => {
    if (isMarketHours()) {
      console.log("[News] Fallback interval scrape (market hours)");
      try {
        await runScrape(pool);

        // Re-schedule event-driven scrapes
        const upcoming = await getUpcomingScheduledEvents(pool, 24);
        scheduleEventScrapes(pool, upcoming);
      } catch (error) {
        console.error("[News] Interval scrape error:", error);
      }
    } else {
      console.log("[News] Skipping scrape (outside market hours)");
    }
  }, FALLBACK_INTERVAL_MS);

  // Schedule next day's events at midnight UK time
  scheduleNextDayRefresh(pool);

  console.log("[News] News updater started");
  console.log(`[News] Fallback interval: ${FALLBACK_INTERVAL_MS / 60000} minutes`);
  console.log(`[News] Market hours: ${MARKET_HOURS_START}:00 - ${MARKET_HOURS_END}:00 UK time`);
}

/**
 * Schedule a refresh at midnight UK time to get next day's events.
 */
function scheduleNextDayRefresh(pool: Pool): void {
  const now = new Date();
  const londonMidnight = new Date(
    formatInTimeZone(now, "Europe/London", "yyyy-MM-dd") + "T00:00:00"
  );
  // Add 1 day and 1 minute to get just after midnight tomorrow
  const nextMidnight = new Date(londonMidnight.getTime() + 24 * 60 * 60 * 1000 + 60 * 1000);

  const delay = nextMidnight.getTime() - now.getTime();

  console.log(`[News] Next day refresh scheduled in ${Math.round(delay / 60000)} minutes`);

  setTimeout(async () => {
    console.log("[News] Midnight refresh - fetching next day events");
    try {
      await runScrape(pool);
      const upcoming = await getUpcomingScheduledEvents(pool, 24);
      scheduleEventScrapes(pool, upcoming);
    } catch (error) {
      console.error("[News] Midnight refresh error:", error);
    }

    // Schedule next midnight refresh
    scheduleNextDayRefresh(pool);
  }, delay);
}

/**
 * Cleanup function - close browser on shutdown.
 */
export async function stopNewsUpdater(): Promise<void> {
  await closeBrowser();
  console.log("[News] News updater stopped");
}
