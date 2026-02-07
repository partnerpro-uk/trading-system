/**
 * News Alerts Worker
 *
 * Fires alerts for upcoming high-impact economic events:
 * - "warning" when event is within 15 minutes
 * - "info" when event just occurred (within last 60s)
 *
 * Deduplicates using a Set of already-alerted event IDs.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { getUpcomingEvents } from "../../lib/db/news";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const WORKER_SECRET = process.env.WORKER_SECRET!;

// Track which events we've already alerted for
const alertedWarnings = new Set<string>(); // 15-min warnings
const alertedOccurred = new Set<string>(); // just-occurred alerts

export async function runNewsAlerts(): Promise<void> {
  if (!CONVEX_URL || !WORKER_SECRET) {
    console.log("[NewsAlerts] Missing CONVEX_URL or WORKER_SECRET, skipping");
    return;
  }

  const convex = new ConvexHttpClient(CONVEX_URL);

  try {
    const userIds = await convex.query(api.alerts.getActiveUserIds, { workerSecret: WORKER_SECRET });
    if (!userIds || userIds.length === 0) return;

    // Get events within the next 30 minutes
    const events = await getUpcomingEvents(undefined, 0.5, "High");
    const now = Date.now();

    for (const event of events) {
      const minutesUntil = (event.timestamp - now) / (1000 * 60);

      // 15-min warning
      if (minutesUntil > 0 && minutesUntil <= 15 && !alertedWarnings.has(event.eventId)) {
        alertedWarnings.add(event.eventId);

        for (const userId of userIds) {
          await convex.mutation(api.alerts.createSystemAlert, {
            workerSecret: WORKER_SECRET,
            userId,
            type: "news_upcoming",
            title: `${event.currency} Event in ${Math.round(minutesUntil)}m`,
            message: `${event.name} (${event.impact} impact) at ${new Date(event.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} UTC`,
            pair: undefined, // News alerts are currency-level, not pair-level
            severity: "warning",
            metadata: JSON.stringify({ eventId: event.eventId, currency: event.currency }),
          });
        }
      }

      // Just occurred (within last 60s)
      if (minutesUntil <= 0 && minutesUntil > -1 && !alertedOccurred.has(event.eventId)) {
        alertedOccurred.add(event.eventId);

        for (const userId of userIds) {
          await convex.mutation(api.alerts.createSystemAlert, {
            workerSecret: WORKER_SECRET,
            userId,
            type: "news_occurred",
            title: `${event.currency} Event Released`,
            message: `${event.name} (${event.impact} impact) — Check for price reaction`,
            pair: undefined,
            severity: "info",
            metadata: JSON.stringify({ eventId: event.eventId, currency: event.currency }),
          });
        }
      }
    }

    // Clean up old entries (older than 1 hour) to prevent memory leak
    // Since we don't store timestamps, just cap set size
    if (alertedWarnings.size > 200) alertedWarnings.clear();
    if (alertedOccurred.size > 200) alertedOccurred.clear();
  } catch (err) {
    console.error("[NewsAlerts] Error:", err);
  }
}
