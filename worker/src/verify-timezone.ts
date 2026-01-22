/**
 * TIMEZONE VERIFICATION TEST (WITH FIX)
 *
 * Known facts for Jan 20, 2026:
 * - UK employment data releases at 7:00 AM UK time = 7:00 UTC = 02:00 ET
 *
 * Run: npx tsx src/verify-timezone.ts
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

puppeteer.use(StealthPlugin());

const TZ_NEW_YORK = "America/New_York";
const TZ_UTC = "UTC";
const TZ_LONDON = "Europe/London";

// Known correct times for Jan 20, 2026 (verified externally)
const EXPECTED_EVENTS = [
  { name: "Claimant Count Change", currency: "GBP", correctUtcTime: "07:00" },
  { name: "Average Earnings Index", currency: "GBP", correctUtcTime: "07:00" },
  { name: "Unemployment Rate", currency: "GBP", correctUtcTime: "07:00" },
  { name: "German PPI m/m", currency: "EUR", correctUtcTime: "07:00" },
];

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║      TIMEZONE VERIFICATION TEST (WITH FF TIMEZONE FIX)       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Step 1: Emulate Eastern Time
  console.log("Step 1: Emulate browser timezone as Eastern Time");
  await page.emulateTimezone("America/New_York");
  console.log("  ✓ Browser timezone set to America/New_York\n");

  // Step 2: Set ForexFactory's timezone to match
  console.log("Step 2: Configure ForexFactory timezone setting");
  await page.goto("https://www.forexfactory.com/timezone.php", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // Check current timezone
  const beforeTz = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/\(GMT[^)]+\)[^\n]+/);
    return match ? match[0] : "unknown";
  });
  console.log(`  Before: ${beforeTz}`);

  // Click Match Device Time
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("a, button, span"));
    const matchBtn = buttons.find(b => b.textContent?.includes("Match Device Time"));
    if (matchBtn) {
      (matchBtn as HTMLElement).click();
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  // Verify change
  await page.goto("https://www.forexfactory.com/timezone.php", { waitUntil: "networkidle2" });
  const afterTz = await page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/Time Zone:\s*\n?\s*(\([^)]+\)[^\n]+)/);
    return match ? match[1] : "unknown";
  });
  console.log(`  After:  ${afterTz}`);
  console.log(`  ✓ ForexFactory timezone configured\n`);

  // Step 3: Scrape calendar
  console.log("Step 3: Scrape calendar and verify times");
  await page.goto("https://www.forexfactory.com/calendar?day=jan20.2026", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // Scroll to load all content
  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1000));
    window.scrollTo(0, 0);
  });

  const content = await page.content();
  const $ = cheerio.load(content);

  const rows = $("tr.calendar__row").not(".calendar__row--day-breaker");

  let currentDate: { month: number; day: number } | null = null;
  let currentTimeRaw: string | null = null;

  const extractedEvents: Array<{
    name: string;
    currency: string;
    rawTime: string;
    parsedEtTime: string;
    convertedUtcTime: string;
    convertedLondonTime: string;
  }> = [];

  rows.each((_, row) => {
    const $row = $(row);

    const dateCell = $row.find("td.calendar__date").text().trim();
    if (dateCell) {
      const match = dateCell.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*([A-Za-z]{3})\s*(\d{1,2})/i);
      if (match) {
        const monthNames: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        };
        currentDate = { month: monthNames[match[1].toLowerCase()], day: parseInt(match[2]) };
        currentTimeRaw = null;
      }
    }

    const timeCell = $row.find("td.calendar__time").text().trim();
    if (timeCell && timeCell !== "") {
      currentTimeRaw = timeCell;
    }

    const currency = $row.find("td.calendar__currency").text().trim();
    const eventName = $row.find("td.calendar__event").text().trim();

    if ((currency === "GBP" || currency === "EUR") && currentDate && currentTimeRaw) {
      const isTargetEvent = EXPECTED_EVENTS.some(
        e => eventName.includes(e.name.split(" ")[0]) && e.currency === currency
      );

      if (isTargetEvent) {
        const timeMatch = currentTimeRaw.match(/^(\d{1,2}):?(\d{2})?(am|pm)$/i);

        if (timeMatch) {
          let hour = parseInt(timeMatch[1], 10);
          const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
          const isPM = timeMatch[3].toLowerCase() === "pm";

          if (isPM && hour !== 12) hour += 12;
          else if (!isPM && hour === 12) hour = 0;

          const etTimeStr = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
          const year = 2026;
          const etDateTimeStr = `${year}-${String(currentDate.month + 1).padStart(2, "0")}-${String(currentDate.day).padStart(2, "0")}T${etTimeStr}:00`;

          const utcDate = fromZonedTime(etDateTimeStr, TZ_NEW_YORK);
          const utcTimeStr = formatInTimeZone(utcDate, TZ_UTC, "HH:mm");
          const londonTimeStr = formatInTimeZone(utcDate, TZ_LONDON, "HH:mm");

          extractedEvents.push({
            name: eventName,
            currency,
            rawTime: currentTimeRaw,
            parsedEtTime: etTimeStr,
            convertedUtcTime: utcTimeStr,
            convertedLondonTime: londonTimeStr,
          });
        }
      }
    }
  });

  await browser.close();

  console.log("\nStep 4: Verification Results");
  console.log("═══════════════════════════════════════════════════════════════\n");

  let allCorrect = true;
  for (const event of extractedEvents) {
    const expected = EXPECTED_EVENTS.find(
      e => event.name.includes(e.name.split(" ")[0]) && e.currency === event.currency
    );

    const isCorrect = expected && event.convertedUtcTime === expected.correctUtcTime;
    if (!isCorrect) allCorrect = false;
    const status = isCorrect ? "✓ CORRECT" : "✗ WRONG";

    console.log(`${event.name} (${event.currency})`);
    console.log(`  Raw from FF:     "${event.rawTime}"`);
    console.log(`  Parsed as ET:    ${event.parsedEtTime}`);
    console.log(`  → Converted UTC: ${event.convertedUtcTime}`);
    console.log(`  → UK time:       ${event.convertedLondonTime}`);
    console.log(`  Expected UTC:    ${expected?.correctUtcTime || "?"}`);
    console.log(`  Status:          ${status}`);
    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════\n");

  if (allCorrect && extractedEvents.length > 0) {
    console.log("✓ ALL EVENTS HAVE CORRECT TIMESTAMPS!");
    console.log("\n🎉 The timezone fix is working. Safe to proceed with data rebuild.\n");
    console.log("Summary:");
    console.log("  - ForexFactory shows: 2:00am ET for UK employment data");
    console.log("  - We convert to UTC:  2:00 ET + 5h = 07:00 UTC");
    console.log("  - Actual release:     07:00 UTC (7:00 AM UK time)");
    console.log("  - Match: ✓");
  } else if (extractedEvents.length === 0) {
    console.log("✗ NO TARGET EVENTS FOUND - check page structure");
  } else {
    console.log("✗ SOME EVENTS HAVE WRONG TIMESTAMPS - fix needed");
  }
}

main().catch(console.error);
