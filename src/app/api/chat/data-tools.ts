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
import { detectSession } from "@/lib/trading/sessions";

// ─── Data Tool Executor ──────────────────────────────────────────────────────

export async function executeDataTool(
  name: string,
  input: Record<string, unknown>,
  defaultPair: string,
  defaultTimeframe: string
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
      // Trade history is in Convex — for now return a placeholder
      return {
        message: "Trade history will be connected via Convex in the persistence phase.",
        pair: (input.pair as string) || defaultPair,
      };
    }

    case "get_trade_stats": {
      // Trade stats are in Convex — for now return a placeholder
      return {
        message: "Trade statistics will be connected via Convex in the persistence phase.",
        pair: (input.pair as string) || defaultPair,
      };
    }

    default:
      throw new Error(`Unknown data tool: ${name}`);
  }
}
