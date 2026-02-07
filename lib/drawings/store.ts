/**
 * Drawing Store
 *
 * Zustand store for managing chart drawings.
 * Handles CRUD operations and persistence.
 */

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  Drawing,
  DrawingType,
  DrawingAnchor,
  DrawingModification,
  FibonacciDrawing,
  TrendlineDrawing,
  HorizontalLineDrawing,
  HorizontalRayDrawing,
  VerticalLineDrawing,
  RectangleDrawing,
  CircleDrawing,
  LongPositionDrawing,
  ShortPositionDrawing,
  MarkerDrawing,
  MarkerShape,
  DrawingCreator,
  DEFAULT_FIB_LEVELS,
  DEFAULT_DRAWING_COLORS,
} from "./types";

/**
 * Generate unique ID for drawings
 */
function generateId(): string {
  return `drawing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Drawing store interface
 */
interface DrawingStore {
  // State
  drawings: Record<string, Drawing[]>;  // Keyed by "pair:timeframe"
  activeDrawingTool: DrawingType | null;
  selectedDrawingId: string | null;

  // Undo state
  undoStack: Record<string, Drawing[][]>;  // History of states per chart (max 50)

  // CRUD Operations
  addDrawing: (pair: string, timeframe: string, drawing: Omit<Drawing, "id" | "createdAt">) => string;
  updateDrawing: (pair: string, timeframe: string, id: string, updates: Partial<Drawing>, reason?: string) => void;
  removeDrawing: (pair: string, timeframe: string, id: string) => void;
  clearDrawings: (pair: string, timeframe: string) => void;

  // Undo operations
  pushToUndoStack: (pair: string, timeframe: string) => void;
  undo: (pair: string, timeframe: string) => void;
  canUndo: (pair: string, timeframe: string) => boolean;

  // Selection
  setActiveDrawingTool: (tool: DrawingType | null) => void;
  selectDrawing: (id: string | null) => void;

  // Queries
  getDrawings: (pair: string, timeframe: string) => Drawing[];
  getDrawingById: (pair: string, timeframe: string, id: string) => Drawing | undefined;
  getDrawingsByStrategy: (strategyId: string) => Drawing[];
  getDrawingsByTrade: (tradeId: string) => Drawing[];
  getDrawingsAt: (pair: string, timeframe: string, timestamp: number) => Drawing[];

  // Quick create helpers
  createFibonacci: (
    pair: string,
    timeframe: string,
    anchor1: DrawingAnchor,
    anchor2: DrawingAnchor,
    options?: Partial<FibonacciDrawing>
  ) => string;
  createTrendline: (
    pair: string,
    timeframe: string,
    anchor1: DrawingAnchor,
    anchor2: DrawingAnchor,
    options?: Partial<TrendlineDrawing>
  ) => string;
  createHorizontalLine: (
    pair: string,
    timeframe: string,
    price: number,
    options?: Partial<HorizontalLineDrawing>
  ) => string;
  createHorizontalRay: (
    pair: string,
    timeframe: string,
    anchor: DrawingAnchor,
    options?: Partial<HorizontalRayDrawing>
  ) => string;
  createRectangle: (
    pair: string,
    timeframe: string,
    anchor1: DrawingAnchor,
    anchor2: DrawingAnchor,
    options?: Partial<RectangleDrawing>
  ) => string;
  createCircle: (
    pair: string,
    timeframe: string,
    anchor1: DrawingAnchor,
    anchor2: DrawingAnchor,
    options?: Partial<CircleDrawing>
  ) => string;
  createLongPosition: (
    pair: string,
    timeframe: string,
    entry: DrawingAnchor,
    takeProfit: number,
    stopLoss: number,
    options?: Partial<LongPositionDrawing>
  ) => string;
  createShortPosition: (
    pair: string,
    timeframe: string,
    entry: DrawingAnchor,
    takeProfit: number,
    stopLoss: number,
    options?: Partial<ShortPositionDrawing>
  ) => string;
  createMarker: (
    pair: string,
    timeframe: string,
    anchor: DrawingAnchor,
    markerType: "markerArrowUp" | "markerArrowDown" | "markerCircle" | "markerSquare",
    options?: Partial<MarkerDrawing>
  ) => string;

  // Persistence
  saveToServer: (pair: string, timeframe: string) => Promise<void>;
  loadFromServer: (pair: string, timeframe: string) => Promise<void>;
}

/**
 * Get storage key for pair/timeframe
 */
function getKey(pair: string, timeframe: string): string {
  return `${pair}:${timeframe}`;
}

/**
 * Find the storage key that contains a drawing by ID (cross-timeframe search)
 */
function findDrawingKey(
  drawings: Record<string, Drawing[]>,
  pair: string,
  id: string
): string | null {
  for (const key in drawings) {
    if (!key.startsWith(pair + ":")) continue;
    if (drawings[key].some((d) => d.id === id)) return key;
  }
  return null;
}

/**
 * Create the drawing store
 */
export const useDrawingStore = create<DrawingStore>()(
  persist(
    (set, get) => ({
      drawings: {},
      activeDrawingTool: null,
      selectedDrawingId: null,
      undoStack: {},

      // Push current state to undo stack (call before making changes)
      pushToUndoStack: (pair, timeframe) => {
        const key = getKey(pair, timeframe);
        const currentDrawings = get().drawings[key] || [];
        // Deep clone the drawings array
        const snapshot = JSON.parse(JSON.stringify(currentDrawings)) as Drawing[];

        set((state) => {
          const currentStack = state.undoStack[key] || [];
          // Keep max 50 undo states per chart
          const newStack = [...currentStack, snapshot].slice(-50);
          return {
            undoStack: {
              ...state.undoStack,
              [key]: newStack,
            },
          };
        });
      },

      // Undo last change
      undo: (pair, timeframe) => {
        const key = getKey(pair, timeframe);
        const stack = get().undoStack[key] || [];

        if (stack.length === 0) return;

        // Pop the last state from the stack
        const previousState = stack[stack.length - 1];
        const newStack = stack.slice(0, -1);

        set((state) => ({
          drawings: {
            ...state.drawings,
            [key]: previousState,
          },
          undoStack: {
            ...state.undoStack,
            [key]: newStack,
          },
          selectedDrawingId: null,
        }));
      },

      // Check if undo is available
      canUndo: (pair, timeframe) => {
        const key = getKey(pair, timeframe);
        const stack = get().undoStack[key] || [];
        return stack.length > 0;
      },

      // Add drawing
      addDrawing: (pair, timeframe, drawing) => {
        // Push to undo stack before making changes
        get().pushToUndoStack(pair, timeframe);

        const id = generateId();
        const key = getKey(pair, timeframe);
        const now = Date.now();

        const newDrawing: Drawing = {
          ...drawing,
          id,
          sourceTimeframe: timeframe,
          visibility: drawing.visibility ?? "all",
          createdAt: now,
          updatedAt: now,
        } as Drawing;

        set((state) => ({
          drawings: {
            ...state.drawings,
            [key]: [...(state.drawings[key] || []), newDrawing],
          },
        }));

        return id;
      },

      // Update drawing (with cross-timeframe fallback and optional audit log)
      updateDrawing: (pair, timeframe, id, updates, reason?) => {
        const key = getKey(pair, timeframe);
        const found = (get().drawings[key] || []).some((d) => d.id === id);
        const targetKey = found ? key : findDrawingKey(get().drawings, pair, id);
        if (!targetKey) return;

        // Push undo stack for Claude-initiated updates (reason = audit trail)
        if (reason) {
          const targetTf = targetKey.split(":")[1];
          get().pushToUndoStack(pair, targetTf);
        }

        set((state) => {
          const currentDrawings = state.drawings[targetKey] || [];
          const updatedDrawings = currentDrawings.map((d): Drawing => {
            if (d.id !== id) return d;

            // Build modification log entry when reason is provided (Claude updates)
            let modifications = d.modifications;
            if (reason) {
              const changes: Record<string, { from: unknown; to: unknown }> = {};
              for (const [field, newValue] of Object.entries(updates)) {
                if (field === "modifications") continue;
                const oldValue = (d as unknown as Record<string, unknown>)[field];
                if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
                  changes[field] = { from: oldValue, to: newValue };
                }
              }
              const entry: DrawingModification = { timestamp: Date.now(), reason, changes };
              modifications = [...(d.modifications || []), entry].slice(-50);
            }

            return { ...d, ...updates, modifications, updatedAt: Date.now() } as Drawing;
          });

          return {
            drawings: {
              ...state.drawings,
              [targetKey]: updatedDrawings,
            },
          };
        });
      },

      // Remove drawing (with cross-timeframe fallback)
      removeDrawing: (pair, timeframe, id) => {
        const key = getKey(pair, timeframe);
        const found = (get().drawings[key] || []).some((d) => d.id === id);
        const targetKey = found ? key : findDrawingKey(get().drawings, pair, id);
        if (!targetKey) return;

        // Push undo for the target key's timeframe
        const targetTf = targetKey.split(":")[1];
        get().pushToUndoStack(pair, targetTf);

        set((state) => ({
          drawings: {
            ...state.drawings,
            [targetKey]: (state.drawings[targetKey] || []).filter((d) => d.id !== id),
          },
          selectedDrawingId: state.selectedDrawingId === id ? null : state.selectedDrawingId,
        }));
      },

      // Clear all drawings for pair/timeframe
      clearDrawings: (pair, timeframe) => {
        // Push to undo stack before making changes
        get().pushToUndoStack(pair, timeframe);

        const key = getKey(pair, timeframe);

        set((state) => ({
          drawings: {
            ...state.drawings,
            [key]: [],
          },
          selectedDrawingId: null,
        }));
      },

      // Set active drawing tool
      setActiveDrawingTool: (tool) => {
        set({ activeDrawingTool: tool });
      },

      // Select drawing
      selectDrawing: (id) => {
        set({ selectedDrawingId: id });
      },

      // Get visible drawings for pair/timeframe (cross-timeframe query)
      getDrawings: (pair, timeframe) => {
        const allDrawings = get().drawings;
        const result: Drawing[] = [];
        const prefix = pair + ":";

        for (const key in allDrawings) {
          if (!key.startsWith(prefix)) continue;
          const keyTf = key.slice(prefix.length);

          for (const d of allDrawings[key]) {
            const vis = d.visibility ?? "all";
            if (
              keyTf === timeframe ||
              vis === "all" ||
              (Array.isArray(vis) && vis.includes(timeframe))
            ) {
              result.push(d);
            }
          }
        }

        return result;
      },

      // Get drawing by ID (searches across timeframes for this pair)
      getDrawingById: (pair, timeframe, id) => {
        const key = getKey(pair, timeframe);
        const found = (get().drawings[key] || []).find((d) => d.id === id);
        if (found) return found;

        // Fallback: search other timeframes
        const allDrawings = get().drawings;
        for (const k in allDrawings) {
          if (!k.startsWith(pair + ":") || k === key) continue;
          const d = allDrawings[k].find((d) => d.id === id);
          if (d) return d;
        }
        return undefined;
      },

      // Get drawings by strategy
      getDrawingsByStrategy: (strategyId) => {
        const allDrawings: Drawing[] = [];
        const drawings = get().drawings;

        for (const key in drawings) {
          allDrawings.push(...drawings[key].filter((d) => d.strategyId === strategyId));
        }

        return allDrawings;
      },

      // Get drawings by trade
      getDrawingsByTrade: (tradeId) => {
        const allDrawings: Drawing[] = [];
        const drawings = get().drawings;

        for (const key in drawings) {
          allDrawings.push(...drawings[key].filter((d) => d.tradeId === tradeId));
        }

        return allDrawings;
      },

      // Get drawings at specific timestamp
      getDrawingsAt: (pair, timeframe, timestamp) => {
        const drawings = get().getDrawings(pair, timeframe);

        return drawings.filter((d) => {
          // Check if drawing intersects with timestamp
          if ("timestamp" in d && d.type === "verticalLine") {
            return d.timestamp === timestamp;
          }

          if ("anchor1" in d && "anchor2" in d) {
            const a = d as { anchor1: DrawingAnchor; anchor2: DrawingAnchor };
            const minTime = Math.min(a.anchor1.timestamp, a.anchor2.timestamp);
            const maxTime = Math.max(a.anchor1.timestamp, a.anchor2.timestamp);
            return timestamp >= minTime && timestamp <= maxTime;
          }

          return false;
        });
      },

      // Create Fibonacci
      createFibonacci: (pair, timeframe, anchor1, anchor2, options = {}) => {
        const drawing: Omit<FibonacciDrawing, "id" | "createdAt"> = {
          type: "fibonacci",
          anchor1,
          anchor2,
          levels: options.levels || DEFAULT_FIB_LEVELS,
          extendLeft: options.extendLeft ?? false,
          extendRight: options.extendRight ?? false,
          showLabels: options.showLabels ?? true,
          showPrices: options.showPrices ?? true,
          lineColor: options.lineColor || DEFAULT_DRAWING_COLORS.fibonacci.line,
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Trendline
      createTrendline: (pair, timeframe, anchor1, anchor2, options = {}) => {
        const drawing: Omit<TrendlineDrawing, "id" | "createdAt"> = {
          type: options.type || "trendline",
          anchor1,
          anchor2,
          color: options.color || DEFAULT_DRAWING_COLORS.trendline,
          lineWidth: options.lineWidth || 2,
          lineStyle: options.lineStyle || "solid",
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Horizontal Line
      createHorizontalLine: (pair, timeframe, price, options = {}) => {
        const drawing: Omit<HorizontalLineDrawing, "id" | "createdAt"> = {
          type: "horizontalLine",
          price,
          color: options.color || DEFAULT_DRAWING_COLORS.horizontalLine,
          lineWidth: options.lineWidth || 1,
          lineStyle: options.lineStyle || "dashed",
          showLabel: options.showLabel ?? true,
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Horizontal Ray
      createHorizontalRay: (pair, timeframe, anchor, options = {}) => {
        const drawing: Omit<HorizontalRayDrawing, "id" | "createdAt"> = {
          type: "horizontalRay",
          anchor,
          color: options.color || DEFAULT_DRAWING_COLORS.horizontalLine,
          lineWidth: options.lineWidth || 1,
          lineStyle: options.lineStyle || "solid",
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Rectangle
      createRectangle: (pair, timeframe, anchor1, anchor2, options = {}) => {
        const drawing: Omit<RectangleDrawing, "id" | "createdAt"> = {
          type: "rectangle",
          anchor1,
          anchor2,
          fillColor: options.fillColor || DEFAULT_DRAWING_COLORS.rectangle.fill,
          borderColor: options.borderColor || DEFAULT_DRAWING_COLORS.rectangle.border,
          borderWidth: options.borderWidth || 1,
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Circle
      createCircle: (pair, timeframe, anchor1, anchor2, options = {}) => {
        const drawing: Omit<CircleDrawing, "id" | "createdAt"> = {
          type: "circle",
          anchor1,
          anchor2,
          fillColor: options.fillColor || DEFAULT_DRAWING_COLORS.circle.fill,
          borderColor: options.borderColor || DEFAULT_DRAWING_COLORS.circle.border,
          borderWidth: options.borderWidth || 1,
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Long Position
      createLongPosition: (pair, timeframe, entry, takeProfit, stopLoss, options = {}) => {
        const riskRewardRatio = Math.abs(takeProfit - entry.price) / Math.abs(entry.price - stopLoss);

        // Determine default status based on creator:
        // - User-created positions: "open" (already in a trade)
        // - Strategy/Claude-generated: "signal" (needs trader confirmation before syncing to journal)
        const defaultStatus = (options.createdBy === "strategy" || options.createdBy === "claude") ? "signal" : "open";

        const drawing: Omit<LongPositionDrawing, "id" | "createdAt"> = {
          type: "longPosition",
          entry,
          takeProfit,
          stopLoss,
          riskRewardRatio,
          isActive: options.isActive ?? true,
          tpColor: options.tpColor || "#26A69A",
          slColor: options.slColor || "#EF5350",
          createdBy: options.createdBy || "user",
          status: options.status || defaultStatus,
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Short Position
      createShortPosition: (pair, timeframe, entry, takeProfit, stopLoss, options = {}) => {
        const riskRewardRatio = Math.abs(takeProfit - entry.price) / Math.abs(entry.price - stopLoss);

        // Determine default status based on creator:
        // - User-created positions: "open" (already in a trade)
        // - Strategy/Claude-generated: "signal" (needs trader confirmation before syncing to journal)
        const defaultStatus = (options.createdBy === "strategy" || options.createdBy === "claude") ? "signal" : "open";

        const drawing: Omit<ShortPositionDrawing, "id" | "createdAt"> = {
          type: "shortPosition",
          entry,
          takeProfit,
          stopLoss,
          riskRewardRatio,
          isActive: options.isActive ?? true,
          tpColor: options.tpColor || "#26A69A",
          slColor: options.slColor || "#EF5350",
          createdBy: options.createdBy || "user",
          status: options.status || defaultStatus,
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Create Marker (arrow, circle, square on candle)
      createMarker: (pair, timeframe, anchor, markerType, options = {}) => {
        // Map drawing type to marker shape
        const shapeMap: Record<string, MarkerShape> = {
          markerArrowUp: "arrowUp",
          markerArrowDown: "arrowDown",
          markerCircle: "circle",
          markerSquare: "square",
        };

        // Default colors per marker type
        const colorMap: Record<string, string> = {
          markerArrowUp: DEFAULT_DRAWING_COLORS.marker.arrowUp,
          markerArrowDown: DEFAULT_DRAWING_COLORS.marker.arrowDown,
          markerCircle: DEFAULT_DRAWING_COLORS.marker.circle,
          markerSquare: DEFAULT_DRAWING_COLORS.marker.square,
        };

        // Default position per marker type
        const positionMap: Record<string, "aboveBar" | "belowBar" | "inBar"> = {
          markerArrowUp: "belowBar",
          markerArrowDown: "aboveBar",
          markerCircle: "inBar",
          markerSquare: "inBar",
        };

        const drawing: Omit<MarkerDrawing, "id" | "createdAt"> = {
          type: markerType,
          anchor,
          shape: shapeMap[markerType],
          color: options.color || colorMap[markerType],
          position: options.position || positionMap[markerType],
          size: options.size || 1,
          createdBy: options.createdBy || "user",
          ...options,
        };

        return get().addDrawing(pair, timeframe, drawing);
      },

      // Save to server (Convex)
      saveToServer: async (pair, timeframe) => {
        const drawings = get().getDrawings(pair, timeframe);

        try {
          await fetch("/api/drawings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pair, timeframe, drawings }),
          });
        } catch (error) {
          console.error("Failed to save drawings:", error);
        }
      },

      // Load from server (Convex)
      loadFromServer: async (pair, timeframe) => {
        try {
          const response = await fetch(`/api/drawings?pair=${pair}&timeframe=${timeframe}`);
          if (response.ok) {
            const data = await response.json();
            const key = getKey(pair, timeframe);

            set((state) => ({
              drawings: {
                ...state.drawings,
                [key]: data.drawings || [],
              },
            }));
          }
        } catch (error) {
          console.error("Failed to load drawings:", error);
        }
      },
    }),
    {
      name: "trading-drawings",
      version: 1, // Bump this to trigger migration
      partialize: (state) => ({
        drawings: state.drawings,
      }),
      // Migrate old data to fix strategyId mismatches
      migrate: (persistedState, version) => {
        const state = persistedState as { drawings: Record<string, Drawing[]> };

        // Migration from version 0 to 1: Fix strategyId mismatches
        if (version === 0 && state.drawings) {
          // Known strategyId mappings (old visuals.json ID -> folder name)
          const strategyIdMappings: Record<string, string> = {
            "fcr-strategy": "first-candle-strategy",
            // Add more mappings as needed
          };

          for (const chartKey of Object.keys(state.drawings)) {
            state.drawings[chartKey] = state.drawings[chartKey].map((drawing) => {
              // Only migrate strategy-created drawings
              if (drawing.createdBy === "strategy" && drawing.strategyId) {
                const newStrategyId = strategyIdMappings[drawing.strategyId];
                if (newStrategyId) {
                  return { ...drawing, strategyId: newStrategyId };
                }
              }
              return drawing;
            });
          }
        }

        return state;
      },
      // Skip hydration on server to prevent SSR issues
      skipHydration: true,
    }
  )
);

// Stable empty array reference to avoid infinite re-renders
const EMPTY_DRAWINGS: Drawing[] = [];

// Hydrate the store on client side (call this once in a client component)
export const hydrateDrawingStore = () => {
  if (typeof window !== "undefined") {
    useDrawingStore.persist.rehydrate();
  }
};

/**
 * Hook to get drawings for current chart.
 * Uses a stable selector (raw state access) + useMemo to avoid
 * the "getSnapshot must be cached" infinite loop in React 19.
 */
export function useChartDrawings(pair: string, timeframe: string) {
  // Subscribe to the raw drawings object — stable reference unless drawings change
  const allDrawings = useDrawingStore((state) => state.drawings);

  // Derive the filtered list in useMemo (same logic as store.getDrawings)
  const drawings = useMemo(() => {
    const result: Drawing[] = [];
    const prefix = pair + ":";

    for (const key in allDrawings) {
      if (!key.startsWith(prefix)) continue;
      const keyTf = key.slice(prefix.length);

      for (const d of allDrawings[key]) {
        const vis = d.visibility ?? "all";
        if (
          keyTf === timeframe ||
          vis === "all" ||
          (Array.isArray(vis) && vis.includes(timeframe))
        ) {
          result.push(d);
        }
      }
    }

    return result.length > 0 ? result : EMPTY_DRAWINGS;
  }, [allDrawings, pair, timeframe]);
  const activeDrawingTool = useDrawingStore((state) => state.activeDrawingTool);
  const selectedDrawingId = useDrawingStore((state) => state.selectedDrawingId);

  const {
    addDrawing,
    updateDrawing,
    removeDrawing,
    clearDrawings,
    setActiveDrawingTool,
    selectDrawing,
    createFibonacci,
    createTrendline,
    createHorizontalLine,
    createHorizontalRay,
    createRectangle,
    createCircle,
    createLongPosition,
    createShortPosition,
    createMarker,
    pushToUndoStack,
    undo,
    canUndo,
  } = useDrawingStore.getState();

  return {
    drawings,
    activeDrawingTool,
    selectedDrawingId,
    addDrawing: (drawing: Omit<Drawing, "id" | "createdAt">) => addDrawing(pair, timeframe, drawing),
    updateDrawing: (id: string, updates: Partial<Drawing>) => updateDrawing(pair, timeframe, id, updates),
    removeDrawing: (id: string) => removeDrawing(pair, timeframe, id),
    clearDrawings: () => clearDrawings(pair, timeframe),
    setActiveDrawingTool,
    selectDrawing,
    createFibonacci: (anchor1: DrawingAnchor, anchor2: DrawingAnchor, options?: Partial<FibonacciDrawing>) =>
      createFibonacci(pair, timeframe, anchor1, anchor2, options),
    createTrendline: (anchor1: DrawingAnchor, anchor2: DrawingAnchor, options?: Partial<TrendlineDrawing>) =>
      createTrendline(pair, timeframe, anchor1, anchor2, options),
    createHorizontalLine: (price: number, options?: Partial<HorizontalLineDrawing>) =>
      createHorizontalLine(pair, timeframe, price, options),
    createHorizontalRay: (anchor: DrawingAnchor, options?: Partial<HorizontalRayDrawing>) =>
      createHorizontalRay(pair, timeframe, anchor, options),
    createRectangle: (anchor1: DrawingAnchor, anchor2: DrawingAnchor, options?: Partial<RectangleDrawing>) =>
      createRectangle(pair, timeframe, anchor1, anchor2, options),
    createCircle: (anchor1: DrawingAnchor, anchor2: DrawingAnchor, options?: Partial<CircleDrawing>) =>
      createCircle(pair, timeframe, anchor1, anchor2, options),
    createLongPosition: (
      entry: DrawingAnchor,
      takeProfit: number,
      stopLoss: number,
      options?: Partial<LongPositionDrawing>
    ) => createLongPosition(pair, timeframe, entry, takeProfit, stopLoss, options),
    createShortPosition: (
      entry: DrawingAnchor,
      takeProfit: number,
      stopLoss: number,
      options?: Partial<ShortPositionDrawing>
    ) => createShortPosition(pair, timeframe, entry, takeProfit, stopLoss, options),
    createMarker: (
      anchor: DrawingAnchor,
      markerType: "markerArrowUp" | "markerArrowDown" | "markerCircle" | "markerSquare",
      options?: Partial<MarkerDrawing>
    ) => createMarker(pair, timeframe, anchor, markerType, options),
    // Undo
    pushToUndoStack: () => pushToUndoStack(pair, timeframe),
    undo: () => undo(pair, timeframe),
    canUndo: () => canUndo(pair, timeframe),
  };
}
