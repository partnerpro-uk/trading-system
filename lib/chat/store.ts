/**
 * Chat Store
 *
 * Zustand store for Claude AI chat state management.
 * Handles message state, streaming, and client-side tool execution.
 */

import { create } from "zustand";
import type {
  ChatMessage,
  ChatModel,
  ChatContext,
  ChatRequest,
  ToolCall,
  ToolResult,
  DrawingAction,
  DrawHorizontalLineInput,
  DrawHorizontalRayInput,
  DrawFibonacciInput,
  DrawTrendlineInput,
  DrawRectangleInput,
  DrawCircleInput,
  DrawPositionInput,
  DrawMarkerInput,
  UpdateDrawingInput,
} from "./types";
import { isClientTool } from "./types";
import { useDrawingStore } from "@/lib/drawings/store";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let messageIdCounter = 0;
function generateId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

interface ChatState {
  // Panel state
  isOpen: boolean;
  panelSize: number;

  // Active conversation
  conversationId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;
  streamingToolCalls: ToolCall[];
  streamingDrawingActions: DrawingAction[];

  // Model
  model: ChatModel;

  // Abort controller for cancelling streams
  abortController: AbortController | null;

  // Actions
  toggle: () => void;
  open: () => void;
  close: () => void;
  setModel: (model: ChatModel) => void;
  sendMessage: (content: string, context: ChatContext) => Promise<void>;
  stopStreaming: () => void;
  clearConversation: () => void;
  newConversation: () => void;
}

// ─── Client Tool Executor ────────────────────────────────────────────────────

function executeClientTool(
  name: string,
  input: Record<string, unknown>,
  context: ChatContext
): { success: boolean; drawingId?: string; description: string; error?: string } {
  const store = useDrawingStore.getState();
  const { pair, timeframe } = context;

  try {
    switch (name) {
      case "draw_horizontal_line": {
        const { price, label, color, lineWidth, lineStyle, labelPosition, notes, tags, importance, visibility } = input as unknown as DrawHorizontalLineInput;
        const id = store.createHorizontalLine(pair, timeframe, price, {
          createdBy: "claude",
          label, color, lineWidth, lineStyle, labelPosition, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew horizontal line at ${price}${label ? ` (${label})` : ""}` };
      }
      case "draw_horizontal_ray": {
        const { anchor, label, color, lineWidth, lineStyle, labelPosition, notes, tags, importance, visibility } = input as unknown as DrawHorizontalRayInput;
        const id = store.createHorizontalRay(pair, timeframe, anchor, {
          createdBy: "claude",
          label, color, lineWidth, lineStyle, labelPosition, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew horizontal ray at ${anchor.price}${label ? ` (${label})` : ""}` };
      }
      case "draw_fibonacci": {
        const { anchor1, anchor2, label, levels, extendLeft, extendRight, lineColor, notes, tags, importance, visibility } = input as unknown as DrawFibonacciInput;
        const id = store.createFibonacci(pair, timeframe, anchor1, anchor2, {
          createdBy: "claude",
          label, levels, extendLeft, extendRight, lineColor, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew fibonacci retracement${label ? ` (${label})` : ""}` };
      }
      case "draw_trendline": {
        const { anchor1, anchor2, label, color, lineWidth, lineStyle, type, notes, tags, importance, visibility } = input as unknown as DrawTrendlineInput;
        const id = store.createTrendline(pair, timeframe, anchor1, anchor2, {
          createdBy: "claude",
          label, color, lineWidth, lineStyle,
          ...(type ? { type } : {}),
          notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew ${type || "trendline"}${label ? ` (${label})` : ""}` };
      }
      case "draw_rectangle": {
        const { anchor1, anchor2, label, fillColor, borderColor, borderWidth, notes, tags, importance, visibility } = input as unknown as DrawRectangleInput;
        const id = store.createRectangle(pair, timeframe, anchor1, anchor2, {
          createdBy: "claude",
          label, fillColor, borderColor, borderWidth, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew zone/rectangle${label ? ` (${label})` : ""}` };
      }
      case "draw_circle": {
        const { center, edge, label, fillColor, borderColor, borderWidth, notes, tags, importance, visibility } = input as unknown as DrawCircleInput;
        const id = store.createCircle(pair, timeframe, center, edge, {
          createdBy: "claude",
          label, fillColor, borderColor, borderWidth, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew circle${label ? ` (${label})` : ""}` };
      }
      case "draw_long_position": {
        const { entry, takeProfit, stopLoss, label, quantity, notes, tags, importance, visibility } = input as unknown as DrawPositionInput;
        const id = store.createLongPosition(pair, timeframe, entry, takeProfit, stopLoss, {
          createdBy: "claude",
          label, quantity, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew long trade idea: entry ${entry.price}, TP ${takeProfit}, SL ${stopLoss}` };
      }
      case "draw_short_position": {
        const { entry, takeProfit, stopLoss, label, quantity, notes, tags, importance, visibility } = input as unknown as DrawPositionInput;
        const id = store.createShortPosition(pair, timeframe, entry, takeProfit, stopLoss, {
          createdBy: "claude",
          label, quantity, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Drew short trade idea: entry ${entry.price}, TP ${takeProfit}, SL ${stopLoss}` };
      }
      case "draw_marker": {
        const { anchor, markerType, label, color, size, notes, tags, importance, visibility } = input as unknown as DrawMarkerInput;
        const id = store.createMarker(pair, timeframe, anchor, markerType, {
          createdBy: "claude",
          label, color, size, notes, tags, importance, visibility,
        });
        return { success: true, drawingId: id, description: `Placed marker${label ? ` (${label})` : ""}` };
      }
      case "update_drawing": {
        const { drawingId, reason, ...updates } = input as unknown as UpdateDrawingInput;
        const existing = store.getDrawingById(pair, timeframe, drawingId);
        if (!existing) {
          return { success: false, error: `Drawing ${drawingId} not found`, description: `Failed: drawing ${drawingId} not found` };
        }
        store.updateDrawing(pair, timeframe, drawingId, updates, reason);
        const fields = Object.keys(updates).join(", ");
        return { success: true, drawingId, description: `Updated ${existing.type}${fields ? ` (${fields})` : ""}: ${reason}` };
      }
      case "remove_drawing": {
        const { drawingId } = input as { drawingId: string };
        store.removeDrawing(pair, timeframe, drawingId);
        return { success: true, description: `Removed drawing ${drawingId}` };
      }
      case "scroll_chart": {
        // Scroll is handled by the UI component via a callback
        const { timestamp } = input as { timestamp: number };
        return { success: true, description: `Scrolled chart to ${new Date(timestamp).toLocaleDateString()}` };
      }
      default:
        return { success: false, error: `Unknown client tool: ${name}`, description: `Failed: unknown tool ${name}` };
    }
  } catch (error) {
    return { success: false, error: String(error), description: `Failed to execute ${name}: ${error}` };
  }
}

// ─── SSE Stream Parser ──────────────────────────────────────────────────────

async function parseSSEStream(
  response: Response,
  callbacks: {
    onText: (delta: string) => void;
    onToolUse: (toolCall: ToolCall) => void;
    onToolResult: (toolCallId: string, result: ToolResult) => void;
    onClientTool: (id: string, name: string, input: Record<string, unknown>) => void;
    onDone: (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) => void;
    onError: (message: string) => void;
  }
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          if (jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr);
            switch (event.type) {
              case "text":
                callbacks.onText(event.data.delta);
                break;
              case "tool_use":
                callbacks.onToolUse({
                  id: event.data.id,
                  name: event.data.name,
                  input: event.data.input,
                  status: "pending",
                });
                break;
              case "tool_result":
                callbacks.onToolResult(event.data.toolCallId, event.data.result);
                break;
              case "client_tool":
                callbacks.onClientTool(event.data.id, event.data.name, event.data.input);
                break;
              case "done":
                callbacks.onDone(event.data.usage);
                break;
              case "error":
                callbacks.onError(event.data.message);
                break;
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useChatStore = create<ChatState>()((set, get) => ({
  // Initial state
  isOpen: false,
  panelSize: 25,
  conversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: "",
  streamingToolCalls: [],
  streamingDrawingActions: [],
  model: "sonnet",
  abortController: null,

  // Panel actions
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  // Model
  setModel: (model) => set({ model }),

  // Stop streaming
  stopStreaming: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
    set({ isStreaming: false, abortController: null });
  },

  // Clear conversation
  clearConversation: () => set({
    conversationId: null,
    messages: [],
    streamingContent: "",
    streamingToolCalls: [],
    streamingDrawingActions: [],
  }),

  // New conversation
  newConversation: () => {
    get().clearConversation();
  },

  // Send message
  sendMessage: async (content: string, context: ChatContext) => {
    const { messages, model, isStreaming } = get();
    if (isStreaming) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    const updatedMessages = [...messages, userMessage];
    const abortController = new AbortController();

    set({
      messages: updatedMessages,
      isStreaming: true,
      streamingContent: "",
      streamingToolCalls: [],
      streamingDrawingActions: [],
      abortController,
    });

    try {
      // Build request
      const request: ChatRequest = {
        messages: updatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        pair: context.pair,
        timeframe: context.timeframe,
        currentPrice: context.currentPrice,
        drawings: context.drawings,
        model,
        convexToken: context.convexToken ?? undefined,
      };

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      let finalContent = "";
      const toolCalls: ToolCall[] = [];
      const drawingActions: DrawingAction[] = [];

      await parseSSEStream(response, {
        onText: (delta) => {
          finalContent += delta;
          set({ streamingContent: finalContent });
        },
        onToolUse: (toolCall) => {
          toolCalls.push(toolCall);
          set({ streamingToolCalls: [...toolCalls] });
        },
        onToolResult: (toolCallId, result) => {
          const tc = toolCalls.find((t) => t.id === toolCallId);
          if (tc) {
            tc.result = result;
            tc.status = result.success ? "complete" : "error";
            set({ streamingToolCalls: [...toolCalls] });
          }
        },
        onClientTool: (id, name, input) => {
          // Execute client-side tool immediately
          const tc: ToolCall = { id, name, input, status: "running" };
          toolCalls.push(tc);
          set({ streamingToolCalls: [...toolCalls] });

          const result = executeClientTool(name, input, context);
          tc.result = { success: result.success, data: { drawingId: result.drawingId }, error: result.error };
          tc.status = result.success ? "complete" : "error";

          drawingActions.push({
            toolCallId: id,
            action: name === "remove_drawing" ? "remove" : name === "scroll_chart" ? "scroll" : name === "update_drawing" ? "update" : "create",
            drawingType: name.replace("draw_", ""),
            drawingId: result.drawingId,
            description: result.description,
          });

          set({
            streamingToolCalls: [...toolCalls],
            streamingDrawingActions: [...drawingActions],
          });

          // Send result back to server for Claude to process
          fetch("/api/chat/tool-result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toolUseId: id, result: { success: result.success, drawingId: result.drawingId, error: result.error } }),
          }).catch(() => {
            // Non-critical, Claude will continue anyway
          });
        },
        onDone: (usage) => {
          // Finalize assistant message
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: "assistant",
            content: finalContent,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            drawingActions: drawingActions.length > 0 ? drawingActions : undefined,
            tokenUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
            model,
            timestamp: Date.now(),
          };

          set((s) => ({
            messages: [...s.messages, assistantMessage],
            isStreaming: false,
            streamingContent: "",
            streamingToolCalls: [],
            streamingDrawingActions: [],
            abortController: null,
          }));
        },
        onError: (message) => {
          // On error, still save partial content as message if any
          if (finalContent) {
            const assistantMessage: ChatMessage = {
              id: generateId(),
              role: "assistant",
              content: finalContent + `\n\n*Error: ${message}*`,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              timestamp: Date.now(),
            };
            set((s) => ({
              messages: [...s.messages, assistantMessage],
              isStreaming: false,
              streamingContent: "",
              streamingToolCalls: [],
              streamingDrawingActions: [],
              abortController: null,
            }));
          } else {
            set({
              isStreaming: false,
              streamingContent: "",
              streamingToolCalls: [],
              streamingDrawingActions: [],
              abortController: null,
            });
          }
        },
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // User cancelled — save partial content
        const currentContent = get().streamingContent;
        if (currentContent) {
          const assistantMessage: ChatMessage = {
            id: generateId(),
            role: "assistant",
            content: currentContent + "\n\n*Stopped*",
            timestamp: Date.now(),
          };
          set((s) => ({
            messages: [...s.messages, assistantMessage],
            isStreaming: false,
            streamingContent: "",
            streamingToolCalls: [],
            streamingDrawingActions: [],
            abortController: null,
          }));
        } else {
          set({
            isStreaming: false,
            streamingContent: "",
            streamingToolCalls: [],
            streamingDrawingActions: [],
            abortController: null,
          });
        }
      } else {
        // Network or other error
        const errorMessage: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: `*Error: ${(error as Error).message || "Failed to send message"}*`,
          timestamp: Date.now(),
        };
        set((s) => ({
          messages: [...s.messages, errorMessage],
          isStreaming: false,
          streamingContent: "",
          streamingToolCalls: [],
          streamingDrawingActions: [],
          abortController: null,
        }));
      }
    }
  },
}));
