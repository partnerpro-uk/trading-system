/**
 * TRIPLE CHECK: September 14, 2022
 *
 * Known UK times (from user):
 * - 7:00am UK: GBP CPI y/y
 * - 1:30pm UK: USD PPI m/m
 *
 * In September:
 * - UK is on BST (UTC+1)
 * - US is on EDT (UTC-4)
 *
 * So:
 * - 7:00 UK (BST) = 6:00 UTC = 2:00 ET (EDT)
 * - 13:30 UK (BST) = 12:30 UTC = 8:30 ET (EDT)
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

puppeteer.use(StealthPlugin());

// Sep 14, 2022 events - CPI day
// In Sep: UK = BST (UTC+1), US = EDT (UTC-4)
const EXPECTED = [
  { name: "CPI y/y", currency: "GBP", ukTime: "07:00", correctUtc: "06:00" },
  { name: "PPI m/m", currency: "USD", ukTime: "13:30", correctUtc: "12:30" },
];

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("TRIPLE CHECK: September 14, 2022");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("Known facts (from user):");
  console.log("  - GBP CPI y/y at 7:00am UK time");
  console.log("  - USD PPI m/m at 1:30pm UK time");
  console.log("  - Sep 2022: UK is on BST (UTC+1), US is on EDT (UTC-4)");
  console.log("  - 7:00 UK (BST) = 6:00 UTC = 2:00 ET (EDT)");
  console.log("  - 13:30 UK (BST) = 12:30 UTC = 8:30 ET (EDT)\n");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Step 1: Emulate ET
  await page.emulateTimezone("America/New_York");
  console.log("Step 1: Browser timezone set to America/New_York\n");

  // Step 2: Set FF timezone
  console.log("Step 2: Configure ForexFactory timezone...");
  await page.goto("https://www.forexfactory.com/timezone.php", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("a, button, span"));
    const matchBtn = buttons.find((b) =>
      b.textContent?.includes("Match Device Time")
    );
    if (matchBtn) (matchBtn as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 2000));
  console.log("  ✓ FF timezone set to Eastern Time\n");

  // Step 3: Scrape Sep 14, 2022
  console.log("Step 3: Scraping calendar for sep14.2022...");
  await page.goto("https://www.forexfactory.com/calendar?day=sep14.2022", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 1000));
    window.scrollTo(0, 0);
  });

  const content = await page.content();
  const $ = cheerio.load(content);

  const rows = $("tr.calendar__row").not(".calendar__row--day-breaker");
  let currentTimeRaw: string | null = null;

  const results: Array<{
    name: string;
    currency: string;
    rawTime: string;
    utcTime: string;
  }> = [];

  rows.each((_, row) => {
    const $row = $(row);
    const timeCell = $row.find("td.calendar__time").text().trim();
    if (timeCell) currentTimeRaw = timeCell;

    const currency = $row.find("td.calendar__currency").text().trim();
    const eventName = $row.find("td.calendar__event").text().trim();

    if (!currentTimeRaw || !currency || !eventName) return;

    // Check if this is one of our target events
    const isTarget = EXPECTED.some(
      (e) => eventName.includes(e.name) && e.currency === currency
    );
    if (!isTarget) return;

    const timeMatch = currentTimeRaw.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    if (!timeMatch) return;

    let hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);
    const isPM = timeMatch[3].toLowerCase() === "pm";

    if (isPM && hour !== 12) hour += 12;
    else if (!isPM && hour === 12) hour = 0;

    // Sep 14, 2022 - convert from EDT (UTC-4) to UTC
    const etDateTimeStr = `2022-09-14T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00`;
    const utcDate = fromZonedTime(etDateTimeStr, "America/New_York");
    const utcTimeStr = formatInTimeZone(utcDate, "UTC", "HH:mm");

    results.push({
      name: eventName,
      currency,
      rawTime: currentTimeRaw,
      utcTime: utcTimeStr,
    });
  });

  await browser.close();

  console.log("\nStep 4: Verification Results");
  console.log(
    "═══════════════════════════════════════════════════════════════\n"
  );

  for (const r of results) {
    const expected = EXPECTED.find(
      (e) => r.name.includes(e.name) && e.currency === r.currency
    );
    const isCorrect = expected && r.utcTime === expected.correctUtc;
    const status = isCorrect ? "✓ CORRECT" : "✗ WRONG";

    console.log(`${r.name} (${r.currency})`);
    console.log(`  Raw from FF:     "${r.rawTime}" (should be ET)`);
    console.log(`  → Converted UTC: ${r.utcTime}`);
    console.log(
      `  Expected UTC:    ${expected?.correctUtc || "?"} (= ${expected?.ukTime || "?"} UK)`
    );
    console.log(`  Status:          ${status}\n`);
  }

  const allCorrect = results.every((r) => {
    const e = EXPECTED.find(
      (x) => r.name.includes(x.name) && x.currency === r.currency
    );
    return e && r.utcTime === e.correctUtc;
  });

  if (allCorrect && results.length >= 2) {
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("✓ TRIPLE CHECK PASSED! Timezone logic is correct.");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
  } else if (results.length < 2) {
    console.log("✗ Could not find enough target events to verify");
  } else {
    console.log("✗ TRIPLE CHECK FAILED - timestamps don't match");
  }
}

main().catch(console.error);
