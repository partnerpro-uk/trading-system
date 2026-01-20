/**
 * Test script for ForexFactory News Scraper
 *
 * Run: npx tsx src/test-news-scraper.ts
 *
 * Tests:
 * 1. Cloudflare bypass (page loads successfully)
 * 2. Event parsing (correct structure)
 * 3. Output comparison (optional: compare with Python scraper)
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import {
  buildEventRecord,
  buildDateUrl,
  parseDateString,
  parseTimeString,
  parseNumericValue,
  calculateOutcome,
  getTradingSession,
  NewsEventRecord,
  TZ_NEW_YORK,
} from "./lib/ff-parser";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

puppeteer.use(StealthPlugin());

const FOREX_FACTORY_URL = "https://www.forexfactory.com";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  data?: unknown;
}

const results: TestResult[] = [];

function logResult(result: TestResult) {
  results.push(result);
  const icon = result.passed ? "✓" : "✗";
  console.log(`\n${icon} ${result.name}`);
  console.log(`  ${result.message}`);
  if (result.data && !result.passed) {
    console.log(`  Data:`, result.data);
  }
}

/**
 * Test 1: Parsing utilities
 */
function testParsingUtilities() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 1: Parsing Utilities");
  console.log("═══════════════════════════════════════");

  // Test parseNumericValue
  const numericTests = [
    { input: "1.5%", expected: 1.5 },
    { input: "100K", expected: 100000 },
    { input: "2.5M", expected: 2500000 },
    { input: "-0.3%", expected: -0.3 },
    { input: "1,234", expected: 1234 },
    { input: "", expected: null },
    { input: "n/a", expected: null },
  ];

  let allPassed = true;
  for (const test of numericTests) {
    const result = parseNumericValue(test.input);
    if (result !== test.expected) {
      allPassed = false;
      logResult({
        name: `parseNumericValue("${test.input}")`,
        passed: false,
        message: `Expected ${test.expected}, got ${result}`,
      });
    }
  }

  if (allPassed) {
    logResult({
      name: "parseNumericValue",
      passed: true,
      message: `All ${numericTests.length} test cases passed`,
    });
  }

  // Test parseTimeString
  const timeTests = [
    { input: "2:30pm", expected: { hour: 14, minute: 30 } },
    { input: "10:30am", expected: { hour: 10, minute: 30 } },
    { input: "12:00pm", expected: { hour: 12, minute: 0 } },
    { input: "12:00am", expected: { hour: 0, minute: 0 } },
    { input: "Day", expected: { hour: 23, minute: 59, isAllDay: true } },
  ];

  allPassed = true;
  for (const test of timeTests) {
    const result = parseTimeString(test.input);
    if (!result || result.hour !== test.expected.hour || result.minute !== test.expected.minute) {
      allPassed = false;
      logResult({
        name: `parseTimeString("${test.input}")`,
        passed: false,
        message: `Expected ${JSON.stringify(test.expected)}, got ${JSON.stringify(result)}`,
      });
    }
  }

  if (allPassed) {
    logResult({
      name: "parseTimeString",
      passed: true,
      message: `All ${timeTests.length} test cases passed`,
    });
  }

  // Test calculateOutcome
  const outcomeTests = [
    { actual: "0.3%", forecast: "0.2%", expected: "beat" },
    { actual: "0.1%", forecast: "0.2%", expected: "miss" },
    { actual: "0.2%", forecast: "0.2%", expected: "met" },
    { actual: null, forecast: "0.2%", expected: null },
  ];

  allPassed = true;
  for (const test of outcomeTests) {
    const result = calculateOutcome(test.actual, test.forecast);
    if (result !== test.expected) {
      allPassed = false;
      logResult({
        name: `calculateOutcome("${test.actual}", "${test.forecast}")`,
        passed: false,
        message: `Expected ${test.expected}, got ${result}`,
      });
    }
  }

  if (allPassed) {
    logResult({
      name: "calculateOutcome",
      passed: true,
      message: `All ${outcomeTests.length} test cases passed`,
    });
  }

  // Test getTradingSession
  const sessionTests = [
    { hour: 8, expected: "london" }, // 8am UTC
    { hour: 14, expected: "london_ny_overlap" }, // 2pm UTC
    { hour: 18, expected: "new_york" }, // 6pm UTC
    { hour: 3, expected: "asian" }, // 3am UTC
  ];

  allPassed = true;
  for (const test of sessionTests) {
    const testDate = new Date(Date.UTC(2024, 0, 15, test.hour, 0, 0));
    const result = getTradingSession(testDate);
    if (result !== test.expected) {
      allPassed = false;
      logResult({
        name: `getTradingSession(${test.hour}:00 UTC)`,
        passed: false,
        message: `Expected ${test.expected}, got ${result}`,
      });
    }
  }

  if (allPassed) {
    logResult({
      name: "getTradingSession",
      passed: true,
      message: `All ${sessionTests.length} test cases passed`,
    });
  }
}

/**
 * Test 2: Cloudflare bypass and page loading
 */
async function testCloudflareBypass() {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 2: Cloudflare Bypass");
  console.log("═══════════════════════════════════════");

  let browser;
  try {
    console.log("\nLaunching browser...");
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Build URL for today
    const today = new Date();
    const dateUrl = buildDateUrl(today);
    const url = `${FOREX_FACTORY_URL}/${dateUrl}`;

    console.log(`Navigating to: ${url}`);

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });

    // Check for Cloudflare challenge page
    const content = await page.content();
    const isBlocked =
      content.includes("Checking your browser") ||
      content.includes("cf-browser-verification") ||
      content.includes("Just a moment");

    if (isBlocked) {
      logResult({
        name: "Cloudflare Bypass",
        passed: false,
        message: "Page blocked by Cloudflare challenge",
      });
      return null;
    }

    // Check for calendar table
    const hasCalendar = content.includes("calendar__table");

    if (!hasCalendar) {
      logResult({
        name: "Cloudflare Bypass",
        passed: false,
        message: "Calendar table not found in page",
        data: content.substring(0, 500),
      });
      return null;
    }

    logResult({
      name: "Cloudflare Bypass",
      passed: true,
      message: "Successfully loaded ForexFactory calendar page",
    });

    // Return page content for parsing test
    return { content, page, browser };
  } catch (error) {
    logResult({
      name: "Cloudflare Bypass",
      passed: false,
      message: `Error: ${error}`,
    });

    if (browser) {
      await browser.close();
    }
    return null;
  }
}

/**
 * Test 3: HTML Parsing
 */
async function testHtmlParsing(html: string, page: any, browser: any) {
  console.log("\n═══════════════════════════════════════");
  console.log("TEST 3: HTML Parsing");
  console.log("═══════════════════════════════════════");

  try {
    // Auto-scroll to trigger lazy loading
    console.log("\nScrolling to load all content...");
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

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get fresh content after scroll
    const content = await page.content();
    const $ = cheerio.load(content);

    // Find all event rows
    const rows = $("tr.calendar__row").not(".calendar__row--day-breaker");
    console.log(`\nFound ${rows.length} event rows`);

    if (rows.length === 0) {
      logResult({
        name: "HTML Parsing",
        passed: false,
        message: "No event rows found in calendar",
      });
      return;
    }

    // Parse events
    const events: NewsEventRecord[] = [];
    const today = new Date();
    const referenceYear = today.getFullYear();
    let currentDate: { month: number; day: number } | null = null;
    let currentTime: { hour: number; minute: number; isAllDay: boolean; isDataMarker: boolean } | null = null;

    rows.each((_, row) => {
      try {
        const $row = $(row);

        // Check for date
        const dateCell = $row.find("td.calendar__date").text().trim();
        if (dateCell) {
          const parsed = parseDateString(dateCell, referenceYear);
          if (parsed) {
            currentDate = parsed;
            currentTime = null; // Reset time when date changes
          }
        }

        if (!currentDate) return;

        // Extract time - ForexFactory only shows time on first event of a group
        const timeCell = $row.find("td.calendar__time").text().trim();
        if (timeCell) {
          const parsedTime = parseTimeString(timeCell);
          if (parsedTime) currentTime = parsedTime;
        }

        if (!currentTime || currentTime.isDataMarker) return;

        const currency = $row.find("td.calendar__currency").text().trim();
        const impactSpan = $row.find("td.calendar__impact span");
        const rawImpact = impactSpan.attr("title") || "";
        const eventName = $row.find("td.calendar__event").text().trim();
        const actual = $row.find("td.calendar__actual").text().trim() || null;
        const forecast = $row.find("td.calendar__forecast").text().trim() || null;
        const previous = $row.find("td.calendar__previous").text().trim() || null;

        if (!currency || !eventName) return;

        // Build datetime - ForexFactory times are in Eastern Time (EST/EDT)
        const estDateStr = `${referenceYear}-${String(currentDate.month + 1).padStart(2, "0")}-${String(currentDate.day).padStart(2, "0")}T${String(currentTime.hour).padStart(2, "0")}:${String(currentTime.minute).padStart(2, "0")}:00`;

        // Convert from EST/EDT to UTC
        const utcTimestamp = fromZonedTime(estDateStr, TZ_NEW_YORK);

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
      } catch (e) {
        // Skip problematic rows
      }
    });

    console.log(`\nParsed ${events.length} valid events`);

    if (events.length === 0) {
      logResult({
        name: "HTML Parsing",
        passed: false,
        message: "No valid events parsed from rows",
      });
      return;
    }

    // Show sample events
    console.log("\n--- Sample Events ---");
    const samples = events.slice(0, 5);
    for (const event of samples) {
      console.log(`\n${event.eventId}`);
      console.log(`  Name: ${event.name}`);
      console.log(`  Currency: ${event.currency}`);
      console.log(`  Impact: ${event.impact}`);
      console.log(`  Time (UTC): ${event.datetimeUtc}`);
      console.log(`  Time (NY): ${event.datetimeNewYork}`);
      console.log(`  Time (London): ${event.datetimeLondon}`);
      console.log(`  Actual: ${event.actual || "—"}`);
      console.log(`  Forecast: ${event.forecast || "—"}`);
      console.log(`  Previous: ${event.previous || "—"}`);
      console.log(`  Status: ${event.status}`);
      if (event.outcome) {
        console.log(`  Outcome: ${event.outcome}`);
      }
    }

    // Validate event structure
    const sampleEvent = events[0];
    const requiredFields = [
      "eventId",
      "eventType",
      "name",
      "currency",
      "country",
      "timestamp",
      "impact",
      "datetimeUtc",
      "datetimeNewYork",
      "datetimeLondon",
      "status",
    ];

    const missingFields = requiredFields.filter(
      (f) => sampleEvent[f as keyof NewsEventRecord] === undefined
    );

    if (missingFields.length > 0) {
      logResult({
        name: "HTML Parsing",
        passed: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
      return;
    }

    // Check for high-impact events
    const highImpact = events.filter((e) => e.impact === "high");
    const mediumImpact = events.filter((e) => e.impact === "medium");
    const released = events.filter((e) => e.status === "released");
    const scheduled = events.filter((e) => e.status === "scheduled");

    console.log("\n--- Statistics ---");
    console.log(`Total events: ${events.length}`);
    console.log(`High impact: ${highImpact.length}`);
    console.log(`Medium impact: ${mediumImpact.length}`);
    console.log(`Released (has actual): ${released.length}`);
    console.log(`Scheduled (no actual): ${scheduled.length}`);

    logResult({
      name: "HTML Parsing",
      passed: true,
      message: `Successfully parsed ${events.length} events (${highImpact.length} high impact, ${released.length} released)`,
    });

    return events;
  } finally {
    await browser.close();
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║   ForexFactory Scraper Test Suite     ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`\nDate: ${new Date().toISOString()}`);

  // Test 1: Parsing utilities
  testParsingUtilities();

  // Test 2: Cloudflare bypass
  const bypassResult = await testCloudflareBypass();

  // Test 3: HTML parsing (only if bypass succeeded)
  if (bypassResult) {
    await testHtmlParsing(bypassResult.content, bypassResult.page, bypassResult.browser);
  }

  // Summary
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║            Test Summary               ║");
  console.log("╚═══════════════════════════════════════╝");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\nTotal: ${results.length} tests`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: ${result.message}`);
    }
  }

  console.log("\n" + (failed === 0 ? "✓ All tests passed!" : "✗ Some tests failed"));

  process.exit(failed === 0 ? 0 : 1);
}

// Run tests
runTests().catch((error) => {
  console.error("Test suite error:", error);
  process.exit(1);
});
