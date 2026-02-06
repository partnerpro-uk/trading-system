# Claude Chat Integration — Architecture

> Last Updated: 2026-02-06 (v1.0)

## Overview

An embedded AI analyst that can draw on charts, query market data, manage trade positions, and maintain an audit trail of its reasoning. Uses SSE streaming with a hybrid tool execution model — data tools run server-side, drawing tools run client-side.

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                     Chat Panel (UI)                        │
│  ChatPanel → ChatMessages → ChatMessage                    │
│  ChatInput → sendMessage()                                 │
│  ToolCallCard + DrawingActionCard (tool feedback)           │
└─────────────────────┬─────────────────────────────────────┘
                      │ POST /api/chat
                      ▼
┌───────────────────────────────────────────────────────────┐
│                  API Route (Server)                         │
│                                                             │
│  1. Build system prompt (buildSystemPrompt)                 │
│  2. Build dynamic context (buildDynamicContext)              │
│  3. Call Anthropic API with streaming                        │
│  4. SSE stream events to client                             │
│                                                             │
│  Server-side tools:        Client-side tools:               │
│  • get_candles             • draw_horizontal_line           │
│  • get_current_price       • draw_horizontal_ray            │
│  • get_news_events         • draw_fibonacci                 │
│  • get_event_statistics    • draw_trendline                 │
│  • get_headlines           • draw_rectangle                 │
│  • get_cot_positioning     • draw_circle                    │
│  • get_cot_history         • draw_long_position             │
│  • get_trade_history       • draw_short_position            │
│  • get_trade_stats         • draw_marker                    │
│                            • update_drawing                 │
│                            • remove_drawing                 │
│                            • scroll_chart                   │
└───────────────────────────────────────────────────────────┘
```

## SSE Event Flow

```
Client                          Server                      Anthropic
  │                               │                            │
  │── POST /api/chat ────────────►│                            │
  │                               │── messages + tools ───────►│
  │                               │                            │
  │◄─── SSE: text { delta } ─────│◄─── text delta ───────────│
  │◄─── SSE: text { delta } ─────│◄─── text delta ───────────│
  │                               │                            │
  │                               │◄─── tool_use (server) ────│
  │◄─ SSE: tool_use { id, name }─│                            │
  │                               │── execute data tool ──►    │
  │◄─ SSE: tool_result { data } ─│                            │
  │                               │── tool result ────────────►│
  │                               │                            │
  │                               │◄─── tool_use (client) ────│
  │◄─ SSE: client_tool { input }─│                            │
  │                               │                            │
  │── executeClientTool() ──►     │                            │
  │   (drawing store mutation)    │                            │
  │                               │                            │
  │── POST /api/chat/tool-result ►│                            │
  │                               │── tool result ────────────►│
  │                               │                            │
  │◄─── SSE: done { usage } ─────│◄─── message_stop ─────────│
  │                               │                            │
```

## Key Files

| File | Purpose |
|------|---------|
| `lib/chat/store.ts` | Zustand store: messages, streaming, tool execution |
| `lib/chat/tools.ts` | 22 Anthropic tool definitions (12 drawing + 9 data + scroll) |
| `lib/chat/types.ts` | TypeScript types for messages, tools, SSE events |
| `lib/chat/context.ts` | System prompt + dynamic context builder |
| `src/app/api/chat/route.ts` | SSE streaming API route |
| `src/app/api/chat/data-tools.ts` | Server-side tool executor |
| `src/app/api/chat/tool-result/route.ts` | Client tool result callback |
| `src/components/chat/ChatPanel.tsx` | Main chat panel container |
| `src/components/chat/ChatMessages.tsx` | Message list renderer |
| `src/components/chat/ChatMessage.tsx` | Individual message component |
| `src/components/chat/ChatInput.tsx` | Input with model selector |
| `src/components/chat/ToolCallCard.tsx` | Tool call status display |
| `src/components/chat/DrawingActionCard.tsx` | Drawing action feedback |

## Models

| Model | ID | Use Case |
|-------|----|----------|
| Sonnet | `claude-sonnet-4-5-20250929` | Default — full analysis, multi-tool |
| Haiku | `claude-haiku-4-5-20251001` | Fast/cheap — quick questions |

User-selectable via model toggle in ChatInput.

## Context System

### System Prompt (`buildSystemPrompt`)

Static instructions that tell Claude:
- Its role (trading analyst in a forex chart app)
- Drawing capabilities (11 types + update/remove)
- Drawing guidelines (colors, styles, notes, tags, importance)
- Modification best practices (update over remove+recreate, audit trail)
- Position lifecycle management (signal → pending → open → closed)
- Chart awareness (don't duplicate existing drawings)
- General guidelines (concise, actionable, reference specific prices)

### Dynamic Context (`buildDynamicContext`)

Real-time state fetched in parallel on every message:

| Data | Source | Failure Mode |
|------|--------|-------------|
| Current price | Client state | Omitted |
| Chart drawings | Client state (describeAllDrawings) | Omitted |
| Key levels | Client state (extractKeyLevels) | Omitted |
| Upcoming events (24h) | TimescaleDB | Graceful (empty) |
| COT positioning | TimescaleDB | Graceful (null) |
| Recent headlines | TimescaleDB | Graceful (empty) |
| Recent candle range | TimescaleDB | Graceful (empty) |

All fetches use `.catch(() => [])` so failures never block the response.

### Prompt Caching

System prompt uses `cache_control: { type: "ephemeral" }` to reduce token costs on repeated messages in the same conversation.

## Tool Categories

### Drawing Tools (Client-Side, 12 tools)

Execute immediately on the client via Zustand store mutations. Each tool supports shared metadata:

```typescript
// Every drawing tool accepts:
{
  notes?: string;       // Claude's reasoning (WHY this level matters)
  tags?: string[];      // Categories: support, resistance, fib, london-high, etc.
  importance?: "low" | "medium" | "high";
  visibility?: "all" | string[];  // Timeframe visibility
}
```

| Tool | Creates | Key Params |
|------|---------|------------|
| `draw_horizontal_line` | HorizontalLine | price, label, color, lineStyle |
| `draw_horizontal_ray` | HorizontalRay | anchor (timestamp+price), label |
| `draw_fibonacci` | Fibonacci | anchor1, anchor2, levels[] |
| `draw_trendline` | Trendline | anchor1, anchor2, type (ray/arrow/extended) |
| `draw_rectangle` | Rectangle | anchor1, anchor2, fillColor |
| `draw_circle` | Circle | center, edge |
| `draw_long_position` | LongPosition | entry, takeProfit, stopLoss |
| `draw_short_position` | ShortPosition | entry, takeProfit, stopLoss |
| `draw_marker` | Marker | anchor, markerType, size |
| `update_drawing` | — | drawingId, reason, ...fields |
| `remove_drawing` | — | drawingId |
| `scroll_chart` | — | timestamp |

### Data Tools (Server-Side, 9 tools)

Execute on the server with database access:

| Tool | Source | Returns |
|------|--------|---------|
| `get_candles` | TimescaleDB/ClickHouse | OHLCV data (max 500) |
| `get_current_price` | Worker SSE | Bid, ask, spread |
| `get_news_events` | TimescaleDB | Economic calendar events |
| `get_event_statistics` | ClickHouse | Historical reaction stats |
| `get_headlines` | TimescaleDB | Recent news headlines |
| `get_cot_positioning` | TimescaleDB | Latest CFTC data |
| `get_cot_history` | ClickHouse | COT trend (26 weeks) |
| `get_trade_history` | Convex | User's past trades |
| `get_trade_stats` | Convex | Win rate, P&L, streaks |

## Reasoning Audit Trail

When Claude modifies a drawing via `update_drawing`, a `DrawingModification` entry is appended:

```typescript
interface DrawingModification {
  timestamp: number;
  reason: string;        // WHY Claude made this change
  changes: Record<string, { from: unknown; to: unknown }>;  // field diffs
}
```

- **Required `reason`**: Every update must explain WHY (e.g., "Price tested through support twice, shifting level down to new swing low at 1.0920")
- **Automatic diffing**: Compares old vs new values for each changed field
- **Capped at 50**: Oldest entries dropped to prevent localStorage bloat
- **Claude-only**: Human edits don't create modification entries (Claude's `reason` param triggers logging)

## Chat Store State

```typescript
{
  isOpen: boolean;              // Panel visibility
  panelSize: number;            // Panel width (default 25%)
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingToolCalls: ToolCall[];
  streamingDrawingActions: DrawingAction[];
  model: ChatModel;             // "haiku" | "sonnet"
  abortController: AbortController | null;
}
```

## UI Layout

Chat panel is a collapsible left panel in the chart page `PanelGroup`:
- Toggle: MessageSquare icon button or `Cmd+L`
- Default width: 25% of viewport
- Resizable via PanelResizeHandle

## Convex Persistence

Conversations and messages are persisted to Convex for cross-session continuity:

| Table | Fields |
|-------|--------|
| `conversations` | pair, timeframe, title, messageCount, totalTokensUsed |
| `chatMessages` | conversationId, role, content, toolCalls, drawingActions, tokenUsage, model |

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-06 | Initial documentation covering chat system, tools, context, audit trail |
