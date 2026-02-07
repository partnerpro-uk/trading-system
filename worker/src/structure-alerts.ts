/**
 * Structure Alerts Worker
 *
 * Detects structure changes (new BOS, FVG fill, counter-trend, key level break,
 * MTF divergence) by comparing current structure to a cached snapshot.
 * Pushes alerts to Convex for all active users.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { getActiveBOSEvents, getActiveFVGs, getLatestKeyLevels } from "../../lib/db/structure";
import type { KeyLevelGrid } from "../../lib/structure/types";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;
const WORKER_SECRET = process.env.WORKER_SECRET!;

const PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF",
  "AUD_USD", "USD_CAD", "NZD_USD", "XAU_USD",
];
const TIMEFRAMES = ["H1", "H4", "D"];

// In-memory cache of structure state
interface StructureSnapshot {
  bosCount: number;
  lastBOSDirection: string | null;
  lastBOSTimestamp: number;
  activeFVGCount: number;
  filledFVGIds: Set<string>;
  lastClosePrice: number | null;
}

// Per-pair key level cache (shared across timeframes for the same pair)
interface KeyLevelSnapshot {
  levels: KeyLevelGrid;
  lastCloseAbove: Record<string, boolean>; // e.g. "pdh" → true if close was above
}

const cache: Map<string, StructureSnapshot> = new Map();
const keyLevelCache: Map<string, KeyLevelSnapshot> = new Map();
const lastAlertTime: Map<string, number> = new Map();
const DEDUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

function shouldAlert(key: string): boolean {
  const last = lastAlertTime.get(key);
  if (last && Date.now() - last < DEDUP_INTERVAL) return false;
  lastAlertTime.set(key, Date.now());
  return true;
}

export async function runStructureAlerts(): Promise<void> {
  if (!CONVEX_URL || !WORKER_SECRET) {
    console.log("[StructureAlerts] Missing CONVEX_URL or WORKER_SECRET, skipping");
    return;
  }

  const convex = new ConvexHttpClient(CONVEX_URL);

  try {
    // Get all active users
    const userIds = await convex.query(api.alerts.getActiveUserIds, { workerSecret: WORKER_SECRET });
    if (!userIds || userIds.length === 0) return;

    for (const pair of PAIRS) {
      // Fetch key levels once per pair (shared across timeframes)
      let currentKeyLevels: KeyLevelGrid | null = null;
      try {
        currentKeyLevels = await getLatestKeyLevels(pair);
      } catch (err) {
        console.error(`[StructureAlerts] Failed to fetch key levels for ${pair}:`, err);
      }

      for (const tf of TIMEFRAMES) {
        const key = `${pair}:${tf}`;

        try {
          // Fetch current structure from TimescaleDB
          const [bosEvents, fvgEvents] = await Promise.all([
            getActiveBOSEvents(pair, tf, 20),
            getActiveFVGs(pair, tf),
          ]);

          const currentBOSCount = bosEvents.length;
          const latestBOS = bosEvents[0]; // Sorted desc by timestamp
          const activeFVGs = fvgEvents.filter((f) => f.status === "fresh" || f.status === "partial");
          const filledFVGs = fvgEvents.filter((f) => f.status === "filled");
          const filledIds = new Set(filledFVGs.map((f) => f.id));
          const currentClose = latestBOS?.confirmingClose ?? null;

          const prev = cache.get(key);

          if (prev) {
            // Detect new BOS
            if (currentBOSCount > prev.bosCount && latestBOS) {
              const alertKey = `${key}:bos:${latestBOS.timestamp}`;
              if (shouldAlert(alertKey)) {
                const severity = latestBOS.isCounterTrend ? "warning" : "info";
                const alertType = latestBOS.isCounterTrend ? "counter_trend_bos" : "bos_confirmed";
                const title = latestBOS.isCounterTrend
                  ? `Counter-Trend BOS ${latestBOS.direction}`
                  : `${latestBOS.direction} BOS confirmed`;

                for (const userId of userIds) {
                  await convex.mutation(api.alerts.createSystemAlert, {
                    workerSecret: WORKER_SECRET,
                    userId,
                    type: alertType,
                    title,
                    message: `${pair.replace("_", "/")} ${tf}: ${latestBOS.direction} break of structure at ${latestBOS.brokenLevel.toFixed(5)}. Magnitude: ${latestBOS.magnitudePips.toFixed(1)} pips.`,
                    pair,
                    timeframe: tf,
                    severity,
                  });
                }
              }
            }

            // Detect FVG filled
            for (const fid of filledIds) {
              if (!prev.filledFVGIds.has(fid)) {
                const alertKey = `${key}:fvg_filled:${fid}`;
                if (shouldAlert(alertKey)) {
                  for (const userId of userIds) {
                    await convex.mutation(api.alerts.createSystemAlert, {
                      workerSecret: WORKER_SECRET,
                      userId,
                      type: "fvg_filled",
                      title: "FVG Filled",
                      message: `${pair.replace("_", "/")} ${tf}: Fair value gap has been filled.`,
                      pair,
                      timeframe: tf,
                      severity: "info",
                    });
                  }
                }
              }
            }

            // Detect key level break (only on H4/D for meaningful breaks)
            if (currentClose && currentKeyLevels && prev.lastClosePrice && (tf === "H4" || tf === "D")) {
              const prevKL = keyLevelCache.get(pair);
              if (prevKL) {
                const levelsToCheck: { type: string; price: number | null }[] = [
                  { type: "pdh", price: prevKL.levels.pdh },
                  { type: "pdl", price: prevKL.levels.pdl },
                  { type: "pwh", price: prevKL.levels.pwh },
                  { type: "pwl", price: prevKL.levels.pwl },
                ];

                for (const { type, price } of levelsToCheck) {
                  if (!price) continue;
                  const wasAbove = prevKL.lastCloseAbove[type];
                  const isAbove = currentClose > price;

                  if (wasAbove !== undefined && wasAbove !== isAbove) {
                    const direction = isAbove ? "bullish" : "bearish";
                    const alertKey = `${pair}:key_level_break:${type}:${direction}`;
                    if (shouldAlert(alertKey)) {
                      const precision = pair.includes("JPY") ? 3 : 5;
                      for (const userId of userIds) {
                        await convex.mutation(api.alerts.createSystemAlert, {
                          workerSecret: WORKER_SECRET,
                          userId,
                          type: "key_level_break",
                          title: `${type.toUpperCase()} ${isAbove ? "Broken Above" : "Broken Below"}`,
                          message: `${pair.replace("_", "/")} ${tf}: Price closed ${isAbove ? "above" : "below"} ${type.toUpperCase()} at ${price.toFixed(precision)}.`,
                          pair,
                          timeframe: tf,
                          severity: "warning",
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          // Update cache
          cache.set(key, {
            bosCount: currentBOSCount,
            lastBOSDirection: latestBOS?.direction ?? null,
            lastBOSTimestamp: latestBOS?.timestamp ?? 0,
            activeFVGCount: activeFVGs.length,
            filledFVGIds: filledIds,
            lastClosePrice: currentClose,
          });
        } catch (err) {
          console.error(`[StructureAlerts] Error processing ${key}:`, err);
        }
      }

      // Update key level cache for this pair (after all timeframes processed)
      if (currentKeyLevels) {
        // Build lastCloseAbove map from the D timeframe cache (most relevant for key levels)
        const dCache = cache.get(`${pair}:D`);
        const closePrice = dCache?.lastClosePrice;
        const lastCloseAbove: Record<string, boolean> = {};
        if (closePrice) {
          for (const type of ["pdh", "pdl", "pwh", "pwl"] as const) {
            const price = currentKeyLevels[type];
            if (price) lastCloseAbove[type] = closePrice > price;
          }
        }
        keyLevelCache.set(pair, { levels: currentKeyLevels, lastCloseAbove });
      }

      // Detect MTF divergence (compare H4 vs D direction for this pair)
      const h4Cache = cache.get(`${pair}:H4`);
      const dCache = cache.get(`${pair}:D`);
      if (h4Cache?.lastBOSDirection && dCache?.lastBOSDirection) {
        if (h4Cache.lastBOSDirection !== dCache.lastBOSDirection) {
          const alertKey = `${pair}:mtf_divergence:${h4Cache.lastBOSDirection}:${dCache.lastBOSDirection}`;
          if (shouldAlert(alertKey)) {
            for (const userId of userIds) {
              await convex.mutation(api.alerts.createSystemAlert, {
                workerSecret: WORKER_SECRET,
                userId,
                type: "mtf_divergence",
                title: "MTF Divergence Detected",
                message: `${pair.replace("_", "/")}: H4 is ${h4Cache.lastBOSDirection} but D is ${dCache.lastBOSDirection}. Multi-timeframe directions are diverging.`,
                pair,
                timeframe: "H4",
                severity: "warning",
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[StructureAlerts] Error:", err);
  }
}
