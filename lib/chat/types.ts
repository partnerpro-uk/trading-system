/**
 * Chat Types
 *
 * TypeScript interfaces for the Claude AI chat system.
 */

import type { Drawing } from "@/lib/drawings/types";

// ─── Models ──────────────────────────────────────────────────────────────────

export type ChatModel = "haiku" | "sonnet";

export const MODEL_IDS: Record<ChatModel, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-5-20250929",
};

// ─── Messages ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  drawingActions?: DrawingAction[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model?: ChatModel;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: ToolResult;
  status: "pending" | "running" | "complete" | "error";
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface DrawingAction {
  toolCallId: string;
  action: "create" | "remove" | "scroll" | "update";
  drawingType?: string;
  drawingId?: string;
  description: string;
}

// ─── Context ─────────────────────────────────────────────────────────────────

export interface ChatContext {
  pair: string;
  timeframe: string;
  currentPrice: number | null;
  drawings: Drawing[];
  convexToken?: string | null;
}

// ─── SSE Events ──────────────────────────────────────────────────────────────

export type SSEEventType =
  | "text"
  | "tool_use"
  | "tool_result"
  | "client_tool"
  | "done"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

export interface SSETextEvent {
  type: "text";
  data: { delta: string };
}

export interface SSEToolUseEvent {
  type: "tool_use";
  data: { id: string; name: string; input: Record<string, unknown> };
}

export interface SSEToolResultEvent {
  type: "tool_result";
  data: { toolCallId: string; result: ToolResult };
}

export interface SSEClientToolEvent {
  type: "client_tool";
  data: { id: string; name: string; input: Record<string, unknown> };
}

export interface SSEDoneEvent {
  type: "done";
  data: {
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    };
  };
}

export interface SSEErrorEvent {
  type: "error";
  data: { message: string };
}

// ─── API Request/Response ────────────────────────────────────────────────────

export interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  pair: string;
  timeframe: string;
  currentPrice: number | null;
  drawings: Drawing[];
  model?: ChatModel;
  conversationId?: string;
  convexToken?: string;
}

// ─── Drawing Metadata (shared across all drawing tools) ─────────────────────

interface DrawingMetadata {
  notes?: string;
  tags?: string[];
  importance?: "low" | "medium" | "high";
  visibility?: "all" | string[];
}

// ─── Drawing Tool Inputs ─────────────────────────────────────────────────────

export interface DrawHorizontalLineInput extends DrawingMetadata {
  price: number;
  label?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  labelPosition?: "above" | "below" | "middle";
}

export interface DrawHorizontalRayInput extends DrawingMetadata {
  anchor: { timestamp: number; price: number };
  label?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  labelPosition?: "above" | "below" | "middle";
}

export interface DrawFibonacciInput extends DrawingMetadata {
  anchor1: { timestamp: number; price: number };
  anchor2: { timestamp: number; price: number };
  label?: string;
  levels?: number[];
  extendLeft?: boolean;
  extendRight?: boolean;
  lineColor?: string;
}

export interface DrawTrendlineInput extends DrawingMetadata {
  anchor1: { timestamp: number; price: number };
  anchor2: { timestamp: number; price: number };
  label?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  type?: "trendline" | "ray" | "arrow" | "extendedLine";
}

export interface DrawRectangleInput extends DrawingMetadata {
  anchor1: { timestamp: number; price: number };
  anchor2: { timestamp: number; price: number };
  label?: string;
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface DrawCircleInput extends DrawingMetadata {
  center: { timestamp: number; price: number };
  edge: { timestamp: number; price: number };
  label?: string;
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface DrawPositionInput extends DrawingMetadata {
  entry: { timestamp: number; price: number };
  takeProfit: number;
  stopLoss: number;
  label?: string;
  quantity?: number;
}

export interface DrawMarkerInput extends DrawingMetadata {
  anchor: { timestamp: number; price: number };
  markerType: "markerArrowUp" | "markerArrowDown" | "markerCircle" | "markerSquare";
  label?: string;
  color?: string;
  size?: number;
}

export interface UpdateDrawingInput {
  drawingId: string;
  reason: string;
  price?: number;
  anchor?: { timestamp: number; price: number };
  anchor1?: { timestamp: number; price: number };
  anchor2?: { timestamp: number; price: number };
  entry?: { timestamp: number; price: number };
  takeProfit?: number;
  stopLoss?: number;
  quantity?: number;
  // Position lifecycle
  status?: "signal" | "pending" | "open" | "closed";
  outcome?: "tp" | "sl" | "manual" | "pending";
  exitPrice?: number;
  exitTimestamp?: number;
  label?: string;
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  lineColor?: string;
  notes?: string;
  tags?: string[];
  importance?: "low" | "medium" | "high";
  visibility?: "all" | string[];
}

export interface RemoveDrawingInput {
  drawingId: string;
}

export interface ScrollChartInput {
  timestamp: number;
}

// ─── Client Tool Names ───────────────────────────────────────────────────────

export const CLIENT_TOOL_NAMES = new Set([
  "draw_horizontal_line",
  "draw_horizontal_ray",
  "draw_fibonacci",
  "draw_trendline",
  "draw_rectangle",
  "draw_circle",
  "draw_long_position",
  "draw_short_position",
  "draw_marker",
  "update_drawing",
  "remove_drawing",
  "scroll_chart",
]);

export function isClientTool(name: string): boolean {
  return CLIENT_TOOL_NAMES.has(name);
}
