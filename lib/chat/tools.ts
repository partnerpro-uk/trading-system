/**
 * Chat Tool Definitions
 *
 * Anthropic tool schemas for Claude's function calling.
 * Split into data tools (server-side) and drawing tools (client-side).
 *
 * Every drawing tool exposes the FULL set of options the drawing store supports,
 * plus metadata fields (notes, tags, importance) for reasoning/logic.
 */

import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Tool;

// ─── Shared Schema Fragments ────────────────────────────────────────────────

const anchorSchema = {
  type: "object" as const,
  properties: {
    timestamp: { type: "number" as const, description: "Unix timestamp in milliseconds — ties the drawing to a specific candle" },
    price: { type: "number" as const, description: "Price level (Y coordinate)" },
  },
  required: ["timestamp", "price"],
};

/** Metadata fields added to every drawing tool for reasoning/logic */
const metadataProperties = {
  notes: {
    type: "string" as const,
    description: "Your reasoning for this drawing. Explain WHY you placed it here, what it means technically, and what happens if price reaches/breaks this level. This gets stored on the drawing for the trader to read.",
  },
  tags: {
    type: "array" as const,
    items: { type: "string" as const },
    description: "Category tags for this drawing (e.g. ['support', 'weekly', 'key-level', 'fib-confluence', 'london-high'])",
  },
  importance: {
    type: "string" as const,
    enum: ["low", "medium", "high"],
    description: "How significant this level/drawing is. 'high' = major level that could trigger trend changes, 'medium' = notable level, 'low' = minor reference",
  },
  visibility: {
    description: "Which timeframes to show this drawing on. Default 'all' = visible everywhere (use for key levels from higher TF analysis). Pass an array like ['M15', 'H1'] to restrict to specific timeframes only.",
  },
};

const lineStyleEnum = {
  type: "string" as const,
  enum: ["solid", "dashed", "dotted"],
  description: "Line style: solid for confirmed levels, dashed for tentative, dotted for projections",
};

// ─── Drawing Tools (Client-Side) ─────────────────────────────────────────────

const drawHorizontalLine: Tool = {
  name: "draw_horizontal_line",
  description: "Draw a horizontal line at a specific price level spanning the entire chart. Use for support, resistance, or key price levels that are not anchored to a specific candle.",
  input_schema: {
    type: "object" as const,
    properties: {
      price: { type: "number", description: "The price level to draw the line at" },
      label: { type: "string", description: "Label for the line (e.g. 'Support', 'Resistance', 'Key Level')" },
      color: { type: "string", description: "Hex color (e.g. '#22c55e' green/support, '#ef4444' red/resistance, '#3b82f6' blue/neutral)" },
      lineWidth: { type: "number", description: "Line thickness in pixels (1-4, default 1)" },
      lineStyle: lineStyleEnum,
      labelPosition: {
        type: "string",
        enum: ["above", "below", "middle"],
        description: "Where to position the label relative to the line (default: 'middle')",
      },
      ...metadataProperties,
    },
    required: ["price"],
  },
};

const drawHorizontalRay: Tool = {
  name: "draw_horizontal_ray",
  description: "Draw a horizontal ray from a specific candle extending infinitely to the right. Use for key levels anchored to a specific point in time — e.g. session highs/lows, swing points, or levels that matter FROM a specific candle onward.",
  input_schema: {
    type: "object" as const,
    properties: {
      anchor: {
        ...anchorSchema,
        description: "The starting point — ties the ray to a specific candle and price. The ray extends right from here.",
      },
      label: { type: "string", description: "Label for the ray (e.g. 'London High', 'Monday Low', 'Swing High')" },
      color: { type: "string", description: "Hex color (e.g. '#22c55e' green/support, '#ef4444' red/resistance, '#3b82f6' blue/neutral)" },
      lineWidth: { type: "number", description: "Line thickness in pixels (1-4, default 1)" },
      lineStyle: lineStyleEnum,
      labelPosition: {
        type: "string",
        enum: ["above", "below", "middle"],
        description: "Where to position the label relative to the line (default: 'middle')",
      },
      ...metadataProperties,
    },
    required: ["anchor"],
  },
};

const drawFibonacci: Tool = {
  name: "draw_fibonacci",
  description: "Draw a Fibonacci retracement between two price points. Levels are drawn between anchor1 (swing start) and anchor2 (swing end). Use get_candles first to find actual swing highs/lows.",
  input_schema: {
    type: "object" as const,
    properties: {
      anchor1: {
        ...anchorSchema,
        description: "Starting point of the swing (e.g. swing high). Ties the fib to a specific candle.",
      },
      anchor2: {
        ...anchorSchema,
        description: "Ending point of the swing (e.g. swing low). Ties the fib to a specific candle.",
      },
      label: { type: "string", description: "Label for the fibonacci drawing" },
      levels: {
        type: "array",
        items: { type: "number" },
        description: "Custom retracement levels as decimals (default: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]). Add 1.272, 1.618 for extensions.",
      },
      extendLeft: { type: "boolean", description: "Extend fib levels to the left of anchor1 (default: false)" },
      extendRight: { type: "boolean", description: "Extend fib levels to the right of anchor2 (default: true). Set false to contain the drawing." },
      lineColor: { type: "string", description: "Hex color for the fib lines (default: '#9333ea' purple)" },
      ...metadataProperties,
    },
    required: ["anchor1", "anchor2"],
  },
};

const drawTrendline: Tool = {
  name: "draw_trendline",
  description: "Draw a line connecting two points on the chart. Supports multiple types: trendline (finite segment), ray (extends from anchor2 onward), arrow (with arrowhead), or extendedLine (extends both directions infinitely).",
  input_schema: {
    type: "object" as const,
    properties: {
      anchor1: {
        ...anchorSchema,
        description: "First point — ties the line to a specific candle.",
      },
      anchor2: {
        ...anchorSchema,
        description: "Second point — ties the line to a specific candle.",
      },
      label: { type: "string", description: "Label for the trendline" },
      color: { type: "string", description: "Hex color for the trendline" },
      lineWidth: { type: "number", description: "Line thickness in pixels (1-4, default 1)" },
      lineStyle: lineStyleEnum,
      type: {
        type: "string",
        enum: ["trendline", "ray", "arrow", "extendedLine"],
        description: "Line variant: 'trendline' (finite segment), 'ray' (extends from anchor2), 'arrow' (with arrowhead), 'extendedLine' (extends both ways). Default: 'trendline'",
      },
      ...metadataProperties,
    },
    required: ["anchor1", "anchor2"],
  },
};

const drawRectangle: Tool = {
  name: "draw_rectangle",
  description: "Draw a rectangular zone on the chart. Use for supply/demand zones, order blocks, consolidation ranges, or any area of interest between two candles and two prices.",
  input_schema: {
    type: "object" as const,
    properties: {
      anchor1: {
        ...anchorSchema,
        description: "First corner (top-left or bottom-left). Ties the zone to a specific candle.",
      },
      anchor2: {
        ...anchorSchema,
        description: "Opposite corner (bottom-right or top-right). Ties the zone to a specific candle.",
      },
      label: { type: "string", description: "Label for the zone (e.g. 'Supply Zone', 'Demand Zone', 'Order Block')" },
      fillColor: { type: "string", description: "Fill color with alpha (e.g. 'rgba(34,197,94,0.1)' for green zone, 'rgba(239,68,68,0.1)' for red zone)" },
      borderColor: { type: "string", description: "Border/outline color (e.g. '#22c55e' green, '#ef4444' red)" },
      borderWidth: { type: "number", description: "Border thickness in pixels (0-3, default 1)" },
      ...metadataProperties,
    },
    required: ["anchor1", "anchor2"],
  },
};

const drawCircle: Tool = {
  name: "draw_circle",
  description: "Draw a circle on the chart. Use to highlight patterns (head & shoulders, double tops), consolidation areas, or points of interest. Defined by a center point and an edge point (which sets the radius).",
  input_schema: {
    type: "object" as const,
    properties: {
      center: {
        ...anchorSchema,
        description: "Center point of the circle. Ties the circle to a specific candle.",
      },
      edge: {
        ...anchorSchema,
        description: "Point on the edge of the circle (defines radius). Use a candle a few bars away to set the size.",
      },
      label: { type: "string", description: "Label for the circle (e.g. 'Double Top', 'Consolidation')" },
      fillColor: { type: "string", description: "Fill color with alpha (e.g. 'rgba(59,130,246,0.08)' for subtle blue)" },
      borderColor: { type: "string", description: "Border color (e.g. '#3b82f6' blue)" },
      borderWidth: { type: "number", description: "Border thickness in pixels (0-3, default 1)" },
      ...metadataProperties,
    },
    required: ["center", "edge"],
  },
};

const drawLongPosition: Tool = {
  name: "draw_long_position",
  description: "Draw a long (buy) trade idea on the chart with entry, take profit, and stop loss levels. Shows risk/reward visually as colored zones.",
  input_schema: {
    type: "object" as const,
    properties: {
      entry: {
        ...anchorSchema,
        description: "Entry point — ties the trade idea to a specific candle.",
      },
      takeProfit: { type: "number", description: "Take profit price level (above entry for long)" },
      stopLoss: { type: "number", description: "Stop loss price level (below entry for long)" },
      label: { type: "string", description: "Label for the trade idea" },
      quantity: { type: "number", description: "Position size / lot size for the trade" },
      ...metadataProperties,
    },
    required: ["entry", "takeProfit", "stopLoss"],
  },
};

const drawShortPosition: Tool = {
  name: "draw_short_position",
  description: "Draw a short (sell) trade idea on the chart with entry, take profit, and stop loss levels. Shows risk/reward visually as colored zones.",
  input_schema: {
    type: "object" as const,
    properties: {
      entry: {
        ...anchorSchema,
        description: "Entry point — ties the trade idea to a specific candle.",
      },
      takeProfit: { type: "number", description: "Take profit price level (below entry for short)" },
      stopLoss: { type: "number", description: "Stop loss price level (above entry for short)" },
      label: { type: "string", description: "Label for the trade idea" },
      quantity: { type: "number", description: "Position size / lot size for the trade" },
      ...metadataProperties,
    },
    required: ["entry", "takeProfit", "stopLoss"],
  },
};

const drawMarker: Tool = {
  name: "draw_marker",
  description: "Place a marker on a specific candle. Use to highlight important candles, signal entries/exits, or annotate patterns.",
  input_schema: {
    type: "object" as const,
    properties: {
      anchor: {
        ...anchorSchema,
        description: "The candle to place the marker on.",
      },
      markerType: {
        type: "string",
        enum: ["markerArrowUp", "markerArrowDown", "markerCircle", "markerSquare"],
        description: "Type of marker: arrowUp (bullish signal), arrowDown (bearish signal), circle (point of interest), square (important candle)",
      },
      label: { type: "string", description: "Text label for the marker" },
      color: { type: "string", description: "Hex color for the marker (e.g. '#22c55e' green, '#ef4444' red)" },
      size: { type: "number", description: "Size multiplier (default 1, range 0.5-3)" },
      ...metadataProperties,
    },
    required: ["anchor", "markerType"],
  },
};

const updateDrawing: Tool = {
  name: "update_drawing",
  description: "Update an existing drawing on the chart. Use to adjust price levels, move anchors, restyle, or update notes/reasoning. Prefer this over remove+recreate to keep the drawing's modification history intact. ALWAYS provide a reason explaining WHY you're making the change.",
  input_schema: {
    type: "object" as const,
    properties: {
      drawingId: { type: "string", description: "The ID of the drawing to update (from the chart drawings context)" },
      reason: { type: "string", description: "WHY you are making this change. This gets logged as an audit trail the trader can review. Be specific: 'Price tested through support so shifting down 20 pips' not just 'adjusting level'." },
      // Price/position fields (use whichever applies to the drawing type)
      price: { type: "number", description: "New price level (for horizontal lines)" },
      anchor: { ...anchorSchema, description: "New anchor point (for horizontal rays)" },
      anchor1: { ...anchorSchema, description: "New first anchor (for trendlines, fibs, rectangles, circles)" },
      anchor2: { ...anchorSchema, description: "New second anchor (for trendlines, fibs, rectangles, circles)" },
      entry: { ...anchorSchema, description: "New entry point (for position drawings)" },
      takeProfit: { type: "number", description: "New take profit level (for positions)" },
      stopLoss: { type: "number", description: "New stop loss level (for positions)" },
      quantity: { type: "number", description: "Position size / lot size (for positions)" },
      // Position lifecycle
      status: {
        type: "string",
        enum: ["signal", "pending", "open", "closed"],
        description: "Position lifecycle status: 'signal' (idea only), 'pending' (waiting for fill), 'open' (active trade), 'closed' (completed)",
      },
      outcome: {
        type: "string",
        enum: ["tp", "sl", "manual", "pending"],
        description: "How the trade ended: 'tp' (hit take profit), 'sl' (hit stop loss), 'manual' (closed manually), 'pending' (still open)",
      },
      exitPrice: { type: "number", description: "Price at which the trade was closed" },
      exitTimestamp: { type: "number", description: "Unix timestamp (ms) when the trade was closed" },
      // Styling
      label: { type: "string", description: "New label text" },
      color: { type: "string", description: "New line/marker color (hex)" },
      lineWidth: { type: "number", description: "New line thickness (1-4)" },
      lineStyle: lineStyleEnum,
      fillColor: { type: "string", description: "New fill color (for rectangles, circles)" },
      borderColor: { type: "string", description: "New border color (for rectangles, circles)" },
      borderWidth: { type: "number", description: "New border thickness" },
      lineColor: { type: "string", description: "New line color (for fibonacci)" },
      // Metadata
      ...metadataProperties,
    },
    required: ["drawingId", "reason"],
  },
};

const removeDrawing: Tool = {
  name: "remove_drawing",
  description: "Remove a specific drawing from the chart by its ID.",
  input_schema: {
    type: "object" as const,
    properties: {
      drawingId: { type: "string", description: "The ID of the drawing to remove" },
    },
    required: ["drawingId"],
  },
};

const scrollChart: Tool = {
  name: "scroll_chart",
  description: "Scroll the chart to show a specific date/time. Use when referencing historical price action.",
  input_schema: {
    type: "object" as const,
    properties: {
      timestamp: { type: "number", description: "Unix timestamp in milliseconds to scroll to" },
    },
    required: ["timestamp"],
  },
};

// ─── Data Tools (Server-Side) ────────────────────────────────────────────────

const getCandles: Tool = {
  name: "get_candles",
  description: "Fetch OHLC candle data for a pair and timeframe. Returns open, high, low, close, volume for each candle. Use to analyze price action, find swing highs/lows, or identify patterns.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to the current chart pair." },
      timeframe: { type: "string", description: "Timeframe (e.g. 'M15', 'H1', 'H4', 'D'). Defaults to current chart timeframe." },
      limit: { type: "number", description: "Number of candles to fetch (default 100, max 500)" },
    },
    required: [],
  },
};

const getCurrentPrice: Tool = {
  name: "get_current_price",
  description: "Get the current live bid/ask price for a currency pair.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
    },
    required: [],
  },
};

const getNewsEvents: Tool = {
  name: "get_news_events",
  description: "Fetch upcoming and recent economic calendar events that may impact the pair. Returns event name, time, impact level, and forecast/actual values.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      hoursAhead: { type: "number", description: "How many hours ahead to look for upcoming events (default 48)" },
      impactFilter: { type: "string", enum: ["high", "medium", "low"], description: "Minimum impact level to include" },
    },
    required: [],
  },
};

const getEventStatistics: Tool = {
  name: "get_event_statistics",
  description: "Get historical price reaction statistics for economic events. Shows average pip movement, typical direction, and reaction patterns based on past occurrences.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      hoursBack: { type: "number", description: "How many hours back to look for recent events with stats (default 168 = 1 week)" },
    },
    required: [],
  },
};

const getHeadlines: Tool = {
  name: "get_headlines",
  description: "Fetch recent news headlines related to a currency pair. Returns headlines with source, importance score, and publish time.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      hours: { type: "number", description: "How many hours back to search (default 48)" },
      query: { type: "string", description: "Optional search query to filter headlines" },
    },
    required: [],
  },
};

const getCOTPositioning: Tool = {
  name: "get_cot_positioning",
  description: "Get the latest CFTC Commitments of Traders positioning data for a currency pair. Shows hedge fund (leveraged money), asset manager, and dealer net positions with sentiment classification and percentile ranking.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair. Pass 'all' for all pairs." },
    },
    required: [],
  },
};

const getCOTHistory: Tool = {
  name: "get_cot_history",
  description: "Get historical weekly COT positioning data for trend analysis. Shows how institutional positioning has changed over time.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      weeks: { type: "number", description: "Number of weeks of history (default 26, max 156)" },
    },
    required: [],
  },
};

const getTradeHistory: Tool = {
  name: "get_trade_history",
  description: "Get the user's trade journal history. Each trade includes Plan vs Reality data: planned entry vs actual fill price, entry slippage, close reason (tp_hit, sl_hit, manual_profit, manual_loss, breakeven, emotional, news, thesis_broken, timeout, other), and close notes. Use this to analyze execution quality, behavioral patterns, and trade outcomes.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Omit for all pairs." },
      status: { type: "string", enum: ["open", "closed", "cancelled"], description: "Filter by trade status. Omit for all statuses." },
      limit: { type: "number", description: "Maximum number of trades to return (default 20, max 50)" },
    },
    required: [],
  },
};

const getTradeStats: Tool = {
  name: "get_trade_stats",
  description: "Get aggregate trading statistics including execution quality metrics. Returns win rate, avg P&L, expectancy, PLUS: avg entry/exit slippage, early exit rate and avg P&L of early exits, late entry win rate, and close reason breakdown. Use this to identify execution patterns and behavioral edges/leaks.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair to filter stats for. Omit for overall stats." },
      strategyId: { type: "string", description: "Strategy ID to filter by. Omit for all strategies." },
    },
    required: [],
  },
};

// ─── Structure Tools (Server-Side) ───────────────────────────────────────────

const getStructure: Tool = {
  name: "get_structure",
  description: "Get the full market structure analysis for a pair/timeframe. Returns swing points, BOS events, FVGs, key levels, current trend, MTF score, and premium/discount zones.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      timeframe: { type: "string", description: "Timeframe (e.g. 'H4', 'D', 'M15'). Defaults to current chart timeframe." },
    },
    required: [],
  },
};

const getActiveFvgs: Tool = {
  name: "get_active_fvgs",
  description: "Get all active (fresh/partial) Fair Value Gaps for a pair. Returns FVG zones with fill %, tier, direction, midline, displacement info, and confluence data.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      timeframe: { type: "string", description: "Filter by timeframe. If omitted, returns FVGs across H1/H4/D." },
      minTier: { type: "number", enum: [1, 2, 3], description: "Minimum volume tier (1=highest volume, 3=all). Default 3." },
    },
    required: [],
  },
};

const getBosHistory: Tool = {
  name: "get_bos_history",
  description: "Get recent Break of Structure events with enrichment data (significance score, key levels broken, COT alignment, session context). Use to understand structural shifts.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
      timeframe: { type: "string", description: "Timeframe (e.g. 'H4'). Defaults to current chart timeframe." },
      limit: { type: "number", description: "Max events to return (default 20, max 50)" },
      minSignificance: { type: "number", description: "Filter by minimum significance score 0-100 (default 0)" },
      direction: { type: "string", enum: ["bullish", "bearish"], description: "Filter by direction" },
    },
    required: [],
  },
};

const getMtfScore: Tool = {
  name: "get_mtf_score",
  description: "Get the multi-timeframe composite direction score for a pair. Returns -100 (strong bearish) to +100 (strong bullish) with per-timeframe breakdown and reasoning.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
    },
    required: [],
  },
};

const getPremiumDiscount: Tool = {
  name: "get_premium_discount",
  description: "Get premium/discount zone analysis for a pair. Returns dealing ranges across H4/D1/W1/yearly/macro tiers, equilibrium levels, depth percentages, and alignment count.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
    },
    required: [],
  },
};

const getKeyLevels: Tool = {
  name: "get_key_levels",
  description: "Get key price levels (PDH/PDL, PWH/PWL, PMH/PML, YH/YL) with distance from current price. Useful for identifying nearby support/resistance.",
  input_schema: {
    type: "object" as const,
    properties: {
      pair: { type: "string", description: "Currency pair (e.g. 'EUR_USD'). Defaults to current chart pair." },
    },
    required: [],
  },
};

// ─── Exports ─────────────────────────────────────────────────────────────────

export const DRAWING_TOOLS: Tool[] = [
  drawHorizontalLine,
  drawHorizontalRay,
  drawFibonacci,
  drawTrendline,
  drawRectangle,
  drawCircle,
  drawLongPosition,
  drawShortPosition,
  drawMarker,
  updateDrawing,
  removeDrawing,
  scrollChart,
];

export const DATA_TOOLS: Tool[] = [
  getCandles,
  getCurrentPrice,
  getNewsEvents,
  getEventStatistics,
  getHeadlines,
  getCOTPositioning,
  getCOTHistory,
  getTradeHistory,
  getTradeStats,
  getStructure,
  getActiveFvgs,
  getBosHistory,
  getMtfScore,
  getPremiumDiscount,
  getKeyLevels,
];

export const ALL_TOOLS: Tool[] = [...DRAWING_TOOLS, ...DATA_TOOLS];
