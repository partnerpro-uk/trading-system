# Drawing System — Architecture

> Last Updated: 2026-02-06 (v1.0)

## Overview

A client-side drawing system built on Zustand with localStorage persistence. Supports 11 drawing types, cross-timeframe visibility, undo history, and an audit trail for Claude-initiated modifications. Drawings are the shared language between the trader, Claude AI, and automated strategies.

## Key Files

| File | Purpose |
|------|---------|
| `lib/drawings/types.ts` | Type hierarchy: BaseDrawing + 11 discriminated variants |
| `lib/drawings/store.ts` | Zustand store: CRUD, undo, persistence, cross-TF logic |
| `lib/drawings/describe.ts` | Natural language descriptions for Claude context |
| `src/hooks/usePositionSync.ts` | Position drawing → Convex trade journal sync |

## Type Hierarchy

All drawings extend `BaseDrawing`:

```typescript
interface BaseDrawing {
  id: string;
  type: DrawingType;
  createdBy: "user" | "strategy" | "claude";
  createdAt: number;
  updatedAt: number;

  // Metadata (Claude populates these)
  label?: string;
  labelColor?: string;
  notes?: string;
  tags?: string[];
  importance?: "low" | "medium" | "high";

  // Cross-timeframe
  sourceTimeframe: string;
  visibility: "all" | string[];

  // Audit trail (Claude modifications only)
  modifications?: DrawingModification[];

  // Price context
  priceLevel?: {
    significance: "minor" | "moderate" | "major";
    lastTested?: number;
    testCount?: number;
  };

  // Locking
  locked?: boolean;  // Also locked when createdBy === "strategy"
}
```

### Drawing Types (11)

| Type | Anchors | Key Fields |
|------|---------|------------|
| `horizontalLine` | price only | color, lineWidth, lineStyle, labelPosition |
| `horizontalRay` | 1 anchor | Extends right from specific candle |
| `verticalLine` | timestamp only | Anchored to specific candle |
| `fibonacci` | 2 anchors | levels[], extendLeft, extendRight, lineColor |
| `trendline` | 2 anchors | type: trendline/ray/arrow/extendedLine |
| `rectangle` | 2 anchors | fillColor, borderColor (zones/order blocks) |
| `circle` | center + edge | fillColor, borderColor |
| `parallelChannel` | 3 anchors | Channel with parallel lines |
| `longPosition` | entry anchor | takeProfit, stopLoss, riskRewardRatio, status |
| `shortPosition` | entry anchor | takeProfit, stopLoss, riskRewardRatio, status |
| `marker` | 1 anchor | markerType: arrowUp/arrowDown/circle/square |

### Position Drawings (Long/Short)

Position drawings have additional lifecycle fields:

```typescript
{
  entry: { timestamp, price };
  takeProfit: number;
  stopLoss: number;
  riskRewardRatio: number;       // Computed at creation
  quantity?: number;

  // Lifecycle
  status: "signal" | "pending" | "open" | "closed";
  outcome?: "tp" | "sl" | "manual" | "pending";
  exitPrice?: number;
  exitTimestamp?: number;
  closedReason?: string;

  // Trade journal sync
  convexTradeId?: string;
  syncedToConvex?: boolean;
  strategyId?: string;
}
```

**Default status by creator:**
- `createdBy: "user"` → status: `"open"` (immediate sync to journal)
- `createdBy: "claude"` → status: `"signal"` (visual indicator, requires trader confirmation)
- `createdBy: "strategy"` → status: `"signal"` (same as Claude)

## Store Architecture

### State Shape

```typescript
{
  drawings: Record<string, Drawing[]>;      // "EUR_USD:H1" → Drawing[]
  activeDrawingTool: DrawingType | null;
  selectedDrawingId: string | null;
  undoStack: Record<string, Drawing[][]>;   // Max 50 snapshots per chart
}
```

### Key Operations

| Method | Description |
|--------|-------------|
| `addDrawing(pair, tf, drawing)` | Create with generated ID + timestamps |
| `updateDrawing(pair, tf, id, updates, reason?)` | Update with optional audit trail |
| `removeDrawing(pair, tf, id)` | Delete (cross-TF safe) |
| `getDrawings(pair, tf)` | Get visible drawings (respects visibility) |
| `getDrawingById(pair, tf, id)` | Search across timeframes |
| `undo(pair, tf)` | Revert to last snapshot |

### Quick Create Helpers

Each drawing type has a factory method:

```typescript
createFibonacci(pair, tf, anchor1, anchor2, options?)
createTrendline(pair, tf, anchor1, anchor2, options?)
createHorizontalLine(pair, tf, price, options?)
createHorizontalRay(pair, tf, anchor, options?)
createRectangle(pair, tf, anchor1, anchor2, options?)
createCircle(pair, tf, center, edge, options?)
createLongPosition(pair, tf, entry, takeProfit, stopLoss, options?)
createShortPosition(pair, tf, entry, takeProfit, stopLoss, options?)
createMarker(pair, tf, anchor, markerType, options?)
```

All accept an `options` object with metadata (notes, tags, importance, visibility, createdBy, etc.).

## Cross-Timeframe Visibility

Drawings are stored under their `sourceTimeframe` key but can appear on other timeframes:

```
Storage: drawings["EUR_USD:D"] = [{ visibility: "all", ... }]

Display: getDrawings("EUR_USD", "M15")
  → Returns D drawings with visibility "all" or ["M15", ...]
  → Plus M15-native drawings
```

**Update/remove** operations use `findDrawingKey()` to search across all timeframes for the pair when the drawing isn't found in the expected key.

## Modification Audit Trail

When `updateDrawing()` is called with a `reason` parameter (Claude updates only):

1. **Push undo snapshot** — enables reverting Claude changes
2. **Compute field diffs** — compares old vs new values for each changed field
3. **Append DrawingModification** — `{ timestamp, reason, changes }` to the drawing's `modifications` array
4. **Cap at 50 entries** — oldest dropped first (~10KB max per drawing)

```typescript
interface DrawingModification {
  timestamp: number;
  reason: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}
```

Human edits (no `reason`) skip the audit trail and don't push to undo stack.

## Description System (`describe.ts`)

Generates natural language for Claude's dynamic context:

### `describeAllDrawings(drawings, currentPrice, thresholdPips)`

Groups drawings by proximity to current price:
- **Nearby levels** (within threshold pips)
- **Resistance above**
- **Support below**

Sorted by distance. Example output:
```
Nearby levels (within 20 pips):
  blue solid horizontal line at 1.0850 (label: "Support") [importance: high]

Resistance above:
  red dashed trendline from 1.0900 to 1.0950 (ascending) [importance: medium]

Support below:
  green solid horizontal ray from 1.0820 [importance: high]
```

### `extractKeyLevels(drawings, currentPrice)`

Returns structured array for Claude:
```typescript
{ price: number; description: string; label?: string; type: string }[]
```

Types: `horizontal`, `fibonacci`, `zone_top`, `zone_bottom`, `position_entry`, `position_tp`, `position_sl`

## Persistence

| Layer | Method | Scope |
|-------|--------|-------|
| Local | Zustand `persist` (localStorage) | Immediate, offline-capable |
| Server | `saveToServer()` / `loadFromServer()` | POST/GET `/api/drawings` → Convex |

## React Integration

`useChartDrawings(pair, timeframe)` hook wraps the store:

```typescript
const {
  drawings,               // Visible drawings for this chart
  addDrawing,             // Pre-filled with pair/timeframe
  updateDrawing,
  removeDrawing,
  undo, canUndo,
  selectedDrawingId,
  setSelectedDrawingId,
  activeDrawingTool,
  setActiveDrawingTool,
} = useChartDrawings("EUR_USD", "H1");
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-06 | Initial documentation covering type system, store, cross-TF, audit trail |
