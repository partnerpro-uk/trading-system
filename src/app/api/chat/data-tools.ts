/**
 * Server-Side Data Tool Executor
 *
 * Executes data-fetching tools on the server side by calling
 * existing database query functions directly.
 */

import { getLatestCandles, getLatestPrices } from "@/lib/db/candles";
import { getUpcomingEvents, getEventsWithReactions } from "@/lib/db/news";
import { getHeadlinesForPair, searchHeadlines } from "@/lib/db/headlines";
import {
  getLatestCOTForPair,
  getLatestCOTPositions,
  getCOTHistory,
  generateCOTSummary,
} from "@/lib/db/cot";
import { getActiveFVGs } from "@/lib/db/structure";
import { getMacroRange } from "@/lib/db/clickhouse-structure";
import { detectSession } from "@/lib/trading/sessions";
import {
  computeStructure,
  detectSwings,
  labelSwings,
  detectBOS,
  deriveCurrentStructure,
  computeMTFScore,
  REQUIRED_DEPTH,
} from "@/lib/structure";
import type { Candle, StructureResponse, CurrentStructure } from "@/lib/structure";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

// ─── Structure Cache (in-memory, short-lived) ──────────────────────────────

const structureCache = new Map<string, { data: StructureResponse; expiresAt: number }>();

async function getStructureForTool(
  pair: string,
  timeframe: string,
  enrich: boolean = false
): Promise<StructureResponse> {
  const key = `${pair}:${timeframe}:${enrich}`;
  const cached = structureCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const depth = REQUIRED_DEPTH[timeframe] || 500;
  const [candles, dailyCandles, weeklyCandles, monthlyCandles, h4Candles, macroRange] =
    await Promise.all([
      getLatestCandles(pair, timeframe, depth),
      getLatestCandles(pair, "D", 200),
      getLatestCandles(pair, "W", 104),
      getLatestCandles(pair, "M", 60),
      timeframe !== "H4" ? getLatestCandles(pair, "H4", 500) : Promise.resolve(null),
      getMacroRange(pair).catch(() => null),
    ]);

  const d1Swings = dailyCandles?.length
    ? labelSwings(detectSwings(dailyCandles as Candle[], "D"), dailyCandles as Candle[])
    : [];
  const w1Swings = weeklyCandles?.length
    ? labelSwings(detectSwings(weeklyCandles as Candle[], "W"), weeklyCandles as Candle[])
    : [];
  const h4Swings = h4Candles?.length
    ? labelSwings(detectSwings(h4Candles as Candle[], "H4"), h4Candles as Candle[])
    : undefined;

  // Build HTF structures for enrichment
  let htfStructures: Record<string, CurrentStructure> | undefined;
  if (enrich) {
    htfStructures = {};
    if (monthlyCandles && monthlyCandles.length > 20) {
      const mSwings = labelSwings(detectSwings(monthlyCandles as Candle[], "M"), monthlyCandles as Candle[]);
      htfStructures["M"] = deriveCurrentStructure(mSwings, detectBOS(monthlyCandles as Candle[], mSwings, pair));
    }
    if (weeklyCandles && weeklyCandles.length > 20) {
      htfStructures["W"] = deriveCurrentStructure(w1Swings, detectBOS(weeklyCandles as Candle[], w1Swings, pair));
    }
    if (dailyCandles && dailyCandles.length > 20) {
      htfStructures["D"] = deriveCurrentStructure(d1Swings, detectBOS(dailyCandles as Candle[], d1Swings, pair));
    }
    if (h4Swings && h4Candles && h4Candles.length > 20) {
      htfStructures["H4"] = deriveCurrentStructure(h4Swings, detectBOS(h4Candles as Candle[], h4Swings, pair));
    }
  }

  const result = computeStructure(
    pair, timeframe, candles as Candle[],
    (dailyCandles || []) as Candle[],
    (weeklyCandles || []) as Candle[],
    (monthlyCandles || []) as Candle[],
    { h4Swings, d1Swings, w1Swings, macroRange, htfStructures, enableEnrichment: enrich }
  );

  structureCache.set(key, { data: result, expiresAt: Date.now() + 120_000 }); // 2min TTL
  return result;
}

// ─── Convex Client (lazy, per-request) ──────────────────────────────────────

function getConvexClient(token?: string): ConvexHttpClient | null {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url || !token) return null;
  const client = new ConvexHttpClient(url);
  client.setAuth(token);
  return client;
}

// ─── Data Tool Executor ──────────────────────────────────────────────────────

export async function executeDataTool(
  name: string,
  input: Record<string, unknown>,
  defaultPair: string,
  defaultTimeframe: string,
  convexToken?: string
): Promise<unknown> {
  switch (name) {
    case "get_candles": {
      const pair = (input.pair as string) || defaultPair;
      const timeframe = (input.timeframe as string) || defaultTimeframe;
      const limit = Math.min((input.limit as number) || 100, 500);
      const candles = await getLatestCandles(pair, timeframe, limit);
      const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return {
        pair,
        timeframe,
        count: candles.length,
        candles: candles.map((c, i) => {
          const d = new Date(c.timestamp);
          return {
            bar: i,
            time: c.time,
            timestamp: c.timestamp,
            day: DAYS[d.getUTCDay()],
            session: detectSession(c.timestamp),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          };
        }),
      };
    }

    case "get_current_price": {
      const pair = (input.pair as string) || defaultPair;
      const prices = await getLatestPrices([pair]);
      const price = prices[pair];
      if (!price) {
        return { pair, error: "No price data available" };
      }
      return {
        pair,
        price: price.price,
        change: price.change,
        changePercent: price.changePercent,
        timestamp: price.timestamp,
      };
    }

    case "get_news_events": {
      const pair = (input.pair as string) || defaultPair;
      const hoursAhead = (input.hoursAhead as number) || 48;
      const impactFilter = input.impactFilter as string | undefined;
      const currency = pair.split("_")[0];

      const events = await getUpcomingEvents(currency, hoursAhead, impactFilter);
      return {
        pair,
        count: events.length,
        events: events.slice(0, 20).map((e) => ({
          name: e.name,
          currency: e.currency,
          time: e.timestamp,
          impact: e.impact,
          forecast: e.forecast,
          previous: e.previous,
          actual: e.actual,
        })),
      };
    }

    case "get_event_statistics": {
      const pair = (input.pair as string) || defaultPair;
      const hoursBack = (input.hoursBack as number) || 168;

      const now = Date.now();
      const startTime = now - hoursBack * 60 * 60 * 1000;

      const events = await getEventsWithReactions(pair, startTime, now, undefined, true);
      return {
        pair,
        count: events.length,
        events: events.slice(0, 10).map((e) => ({
          name: e.name,
          currency: e.currency,
          time: e.timestamp,
          impact: e.impact,
          forecast: e.forecast,
          previous: e.previous,
          actual: e.actual,
          reaction: e.reaction
            ? {
                spikePips: e.reaction.spikeMagnitudePips,
                spikeDirection: e.reaction.spikeDirection,
                reversalPips: e.reaction.reversalMagnitudePips,
                pattern: e.reaction.patternType,
              }
            : null,
          stats: e.stats
            ? {
                avgSpikePips: e.stats.avgSpikePips,
                occurrences: e.stats.totalOccurrences,
                reversalRate: e.stats.reversalRate,
              }
            : null,
        })),
      };
    }

    case "get_headlines": {
      const pair = (input.pair as string) || defaultPair;
      const hours = (input.hours as number) || 48;
      const query = input.query as string | undefined;

      const headlines = query
        ? await searchHeadlines(query, { hours, limit: 20 })
        : await getHeadlinesForPair(pair, hours);

      return {
        pair,
        count: headlines.length,
        headlines: headlines.slice(0, 20).map((h) => ({
          headline: h.headline,
          source: h.source,
          publishedAt: h.publishedAt,
          url: h.url,
          importance: h.importanceScore,
          currencies: h.currencies,
        })),
      };
    }

    case "get_cot_positioning": {
      const pair = (input.pair as string) || defaultPair;

      if (pair === "all") {
        const positions = await getLatestCOTPositions();
        return {
          count: positions.length,
          positions: positions.map((p) => ({
            pair: p.pair,
            reportDate: p.report_date,
            levMoneyNet: p.lev_money_net_positions,
            weeklyChange: p.weekly_change_lev_money,
            assetMgrNet: p.asset_mgr_net_positions,
            dealerNet: p.dealer_net_positions,
            sentiment: p.sentiment,
            percentile: p.lev_money_percentile,
          })),
        };
      }

      const position = await getLatestCOTForPair(pair);
      if (!position) {
        return { pair, available: false, message: `No COT data available for ${pair}` };
      }

      return {
        pair,
        available: true,
        reportDate: position.report_date,
        levMoneyNet: position.lev_money_net_positions,
        weeklyChange: position.weekly_change_lev_money,
        assetMgrNet: position.asset_mgr_net_positions,
        dealerNet: position.dealer_net_positions,
        openInterest: position.open_interest,
        sentiment: position.sentiment,
        percentile: position.lev_money_percentile,
        summary: generateCOTSummary(position, position.sentiment),
      };
    }

    case "get_cot_history": {
      const pair = (input.pair as string) || defaultPair;
      const weeks = Math.min((input.weeks as number) || 26, 156);

      const history = await getCOTHistory(pair, weeks);
      return {
        pair,
        weeks,
        count: history.length,
        history: history.map((h) => ({
          reportDate: h.report_date,
          levMoneyNet: h.lev_money_net_positions,
          assetMgrNet: h.asset_mgr_net_positions,
          dealerNet: h.dealer_net_positions,
          weeklyChange: h.weekly_change_lev_money,
        })),
      };
    }

    case "get_trade_history": {
      const client = getConvexClient(convexToken);
      if (!client) {
        return { error: "Not authenticated — cannot access trade history. Ask the user to sign in." };
      }

      const pair = (input.pair as string) || undefined;
      const limit = Math.min((input.limit as number) || 20, 50);
      const status = input.status as string | undefined;

      try {
        const trades = await client.query(api.trades.getTrades, {
          status: status as "pending" | "open" | "closed" | "cancelled" | undefined,
          limit,
        });

        // Filter by pair if specified
        const filtered = pair ? trades.filter((t: Record<string, unknown>) => t.pair === pair) : trades;

        return {
          count: filtered.length,
          trades: filtered.map((t: Record<string, unknown>) => ({
            id: t._id,
            pair: t.pair,
            timeframe: t.timeframe,
            direction: t.direction,
            status: t.status,
            // Planned
            plannedEntry: t.entryPrice,
            entryTime: t.entryTime,
            plannedTP: t.takeProfit,
            plannedSL: t.stopLoss,
            // Actual (Plan vs Reality)
            actualEntry: t.actualEntryPrice,
            entrySlippagePips: t.entrySlippagePips,
            entryReason: t.entryReason,
            // Exit
            exitPrice: t.exitPrice,
            exitTime: t.exitTime,
            exitSlippagePips: t.exitSlippagePips,
            closeReason: t.closeReason,
            closeReasonNote: t.closeReasonNote,
            // Outcome
            outcome: t.outcome,
            pnlPips: t.pnlPips,
            maxDrawdownPips: t.maxDrawdownPips,
            barsHeld: t.barsHeld,
            // Context
            session: t.session,
            strategy: t.strategyId,
            notes: t.notes,
            createdBy: t.createdBy,
            createdAt: t.createdAt,
          })),
        };
      } catch (e) {
        return { error: `Failed to fetch trades: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case "get_trade_stats": {
      const client = getConvexClient(convexToken);
      if (!client) {
        return { error: "Not authenticated — cannot access trade stats. Ask the user to sign in." };
      }

      const pair = (input.pair as string) || undefined;
      const strategyId = (input.strategyId as string) || undefined;

      try {
        const stats = await client.query(api.trades.getTradeStats, {
          pair,
          strategyId,
        });
        return stats;
      } catch (e) {
        return { error: `Failed to fetch trade stats: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // ─── Structure Tools ────────────────────────────────────────────────────

    case "get_structure": {
      const pair = (input.pair as string) || defaultPair;
      const timeframe = (input.timeframe as string) || defaultTimeframe;
      const result = await getStructureForTool(pair, timeframe, true);

      return {
        pair,
        timeframe,
        computedAt: result.computedAt,
        currentStructure: result.currentStructure,
        mtfScore: result.mtfScore,
        swingCount: result.swings.length,
        recentSwings: result.swings.slice(-8).map((s) => ({
          type: s.type,
          label: s.label,
          price: s.price,
          timestamp: s.timestamp,
        })),
        bosEvents: result.bosEvents.slice(-10).map((b) => ({
          direction: b.direction,
          status: b.status,
          brokenLevel: b.brokenLevel,
          magnitudePips: b.magnitudePips,
          isDisplacement: b.isDisplacement,
          isCounterTrend: b.isCounterTrend,
          timestamp: b.timestamp,
          significance: b.enrichment?.significance,
        })),
        activeFVGs: result.fvgEvents
          .filter((f) => f.status === "fresh" || f.status === "partial")
          .slice(-10)
          .map((f) => ({
            direction: f.direction,
            status: f.status,
            tier: f.tier,
            topPrice: f.topPrice,
            bottomPrice: f.bottomPrice,
            midline: f.midline,
            fillPercent: Math.round(f.fillPercent),
          })),
        keyLevelCount: result.keyLevelEntries.length,
        premiumDiscount: result.premiumDiscount
          ? {
              h4Zone: result.premiumDiscount.h4Zone,
              h4Depth: Math.round(result.premiumDiscount.h4DepthPercent),
              d1Zone: result.premiumDiscount.d1Zone,
              d1Depth: Math.round(result.premiumDiscount.d1DepthPercent),
              alignmentCount: result.premiumDiscount.alignmentCount,
              isDeepPremium: result.premiumDiscount.isDeepPremium,
              isDeepDiscount: result.premiumDiscount.isDeepDiscount,
            }
          : null,
      };
    }

    case "get_active_fvgs": {
      const pair = (input.pair as string) || defaultPair;
      const timeframe = input.timeframe as string | undefined;
      const minTier = (input.minTier as number) || 3;

      if (timeframe) {
        // Single timeframe — use DB query for active FVGs
        const fvgs = await getActiveFVGs(pair, timeframe, 50);
        const filtered = fvgs.filter((f) => f.tier <= minTier);
        return {
          pair,
          timeframe,
          count: filtered.length,
          fvgs: filtered.map((f) => ({
            direction: f.direction,
            status: f.status,
            tier: f.tier,
            topPrice: f.topPrice,
            bottomPrice: f.bottomPrice,
            midline: f.midline,
            gapSizePips: f.gapSizePips,
            fillPercent: Math.round(f.fillPercent),
            isDisplacement: f.isDisplacement,
            createdAt: f.createdAt,
            retestCount: f.retestCount,
            midlineRespected: f.midlineRespected,
          })),
        };
      }

      // Multi-timeframe — fetch H1/H4/D
      const [h1Fvgs, h4Fvgs, dFvgs] = await Promise.all([
        getActiveFVGs(pair, "H1", 30),
        getActiveFVGs(pair, "H4", 30),
        getActiveFVGs(pair, "D", 20),
      ]);

      const allFvgs = [...h1Fvgs, ...h4Fvgs, ...dFvgs]
        .filter((f) => f.tier <= minTier)
        .sort((a, b) => b.createdAt - a.createdAt);

      return {
        pair,
        timeframes: ["H1", "H4", "D"],
        count: allFvgs.length,
        fvgs: allFvgs.slice(0, 30).map((f) => ({
          timeframe: f.timeframe,
          direction: f.direction,
          status: f.status,
          tier: f.tier,
          topPrice: f.topPrice,
          bottomPrice: f.bottomPrice,
          midline: f.midline,
          gapSizePips: f.gapSizePips,
          fillPercent: Math.round(f.fillPercent),
          isDisplacement: f.isDisplacement,
          createdAt: f.createdAt,
        })),
      };
    }

    case "get_bos_history": {
      const pair = (input.pair as string) || defaultPair;
      const timeframe = (input.timeframe as string) || defaultTimeframe;
      const limit = Math.min((input.limit as number) || 20, 50);
      const minSignificance = (input.minSignificance as number) || 0;
      const direction = input.direction as string | undefined;

      const result = await getStructureForTool(pair, timeframe, true);

      let events = result.bosEvents;
      if (direction) events = events.filter((b) => b.direction === direction);
      if (minSignificance > 0) {
        events = events.filter((b) => (b.enrichment?.significance ?? 0) >= minSignificance);
      }

      return {
        pair,
        timeframe,
        count: events.length,
        events: events.slice(-limit).reverse().map((b) => ({
          direction: b.direction,
          status: b.status,
          brokenLevel: b.brokenLevel,
          confirmingClose: b.confirmingClose,
          magnitudePips: b.magnitudePips,
          isDisplacement: b.isDisplacement,
          isCounterTrend: b.isCounterTrend,
          timestamp: b.timestamp,
          enrichment: b.enrichment
            ? {
                significance: b.enrichment.significance,
                isHighConviction: b.enrichment.isHighConviction,
                keyLevelsBroken: b.enrichment.keyLevelsBroken,
                cotAlignment: b.enrichment.cotAlignment,
                cotDirection: b.enrichment.cotDirection,
                mtfAlignment: b.enrichment.mtfAlignment,
                sessionContext: b.enrichment.sessionContext,
                newsProximity: b.enrichment.newsProximity,
              }
            : null,
        })),
      };
    }

    case "get_mtf_score": {
      const pair = (input.pair as string) || defaultPair;

      // Fetch candles for D/W/M + H4 + H1
      const [dCandles, wCandles, mCandles, h4Candles, h1Candles] = await Promise.all([
        getLatestCandles(pair, "D", 200),
        getLatestCandles(pair, "W", 104),
        getLatestCandles(pair, "M", 60),
        getLatestCandles(pair, "H4", 500),
        getLatestCandles(pair, "H1", 500),
      ]);

      const structures: Record<string, CurrentStructure> = {};

      const computeCS = (candles: Candle[] | null, tf: string): void => {
        if (!candles || candles.length < 20) return;
        const swings = labelSwings(detectSwings(candles, tf), candles);
        const bos = detectBOS(candles, swings, pair);
        structures[tf] = deriveCurrentStructure(swings, bos);
      };

      computeCS(mCandles as Candle[] | null, "M");
      computeCS(wCandles as Candle[] | null, "W");
      computeCS(dCandles as Candle[] | null, "D");
      computeCS(h4Candles as Candle[] | null, "H4");
      computeCS(h1Candles as Candle[] | null, "H1");

      const score = computeMTFScore(structures);

      return {
        pair,
        composite: score.composite,
        interpretation: score.interpretation,
        rawScore: score.rawScore,
        maxScore: score.maxScore,
        entries: score.entries.map((e) => ({
          timeframe: e.timeframe,
          weight: e.weight,
          direction: e.direction,
          reasoning: e.reasoning,
        })),
      };
    }

    case "get_premium_discount": {
      const pair = (input.pair as string) || defaultPair;
      const result = await getStructureForTool(pair, "H4");

      if (!result.premiumDiscount) {
        return { pair, available: false, message: "Insufficient swing data for premium/discount analysis" };
      }

      const pd = result.premiumDiscount;
      return {
        pair,
        available: true,
        tiers: {
          h4: { zone: pd.h4Zone, equilibrium: pd.h4Equilibrium, range: pd.h4SwingRange, depth: Math.round(pd.h4DepthPercent) },
          d1: { zone: pd.d1Zone, equilibrium: pd.d1Equilibrium, range: pd.d1SwingRange, depth: Math.round(pd.d1DepthPercent) },
          w1: { zone: pd.w1Zone, equilibrium: pd.w1Equilibrium, range: pd.w1SwingRange, depth: Math.round(pd.w1DepthPercent) },
          yearly: { zone: pd.yearlyZone, equilibrium: pd.yearlyEquilibrium, range: pd.yearlyRange },
          macro: { zone: pd.macroZone, equilibrium: pd.macroEquilibrium, range: pd.macroRange },
        },
        alignmentCount: pd.alignmentCount,
        isDeepPremium: pd.isDeepPremium,
        isDeepDiscount: pd.isDeepDiscount,
      };
    }

    case "get_key_levels": {
      const pair = (input.pair as string) || defaultPair;
      const result = await getStructureForTool(pair, "H4");

      // Get current price for distance calculation
      const prices = await getLatestPrices([pair]);
      const currentPrice = prices[pair]?.price;

      return {
        pair,
        currentPrice,
        levels: result.keyLevelEntries.map((l) => ({
          label: l.label,
          price: l.price,
          significance: l.significance,
          distance: currentPrice ? Math.round(Math.abs(l.price - currentPrice) * (pair.includes("JPY") ? 100 : 10000) * 10) / 10 : null,
          side: currentPrice ? (l.price > currentPrice ? "above" : "below") : null,
        })),
      };
    }

    default:
      throw new Error(`Unknown data tool: ${name}`);
  }
}
