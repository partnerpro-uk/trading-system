/**
 * useDrawings Hook
 *
 * React hook for managing chart drawings.
 * Provides drawing tools, state management, and persistence.
 */

import { useEffect, useCallback } from "react";
import { useChartDrawings, useDrawingStore } from "@/lib/drawings/store";
import {
  DrawingType,
  DrawingAnchor,
  Drawing,
  isPositionDrawing,
  isHorizontalLineDrawing,
  isHorizontalRayDrawing,
  isTrendlineDrawing,
  isRectangleDrawing,
  isCircleDrawing,
  isFibonacciDrawing,
} from "@/lib/drawings/types";
import { getQuickColor, useUserPreferences } from "@/lib/drawings/userPreferences";

interface UseDrawingsOptions {
  pair: string;
  timeframe: string;
}

export function useDrawings({ pair, timeframe }: UseDrawingsOptions) {
  // Get store functions and state
  const {
    drawings,
    activeDrawingTool,
    selectedDrawingId,
    setActiveDrawingTool,
    selectDrawing,
    updateDrawing,
    removeDrawing,
    clearDrawings,
    createFibonacci,
    createTrendline,
    createHorizontalLine,
    createHorizontalRay,
    createRectangle,
    createCircle,
    createLongPosition,
    createShortPosition,
    undo,
    canUndo,
  } = useChartDrawings(pair, timeframe);

  // Load drawings from server on mount (optional - uses localStorage by default)
  useEffect(() => {
    // Drawings are persisted via Zustand persist middleware (localStorage)
    // Uncomment to sync with Convex:
    // useDrawingStore.getState().loadFromServer(pair, timeframe);
  }, [pair, timeframe]);

  // Handle tool selection
  const handleToolSelect = useCallback(
    (tool: DrawingType | null) => {
      setActiveDrawingTool(tool);
      selectDrawing(null); // Deselect any selected drawing
    },
    [setActiveDrawingTool, selectDrawing]
  );

  // Handle drawing creation from chart interaction
  const handleCreateDrawing = useCallback(
    (type: DrawingType, anchors: { anchor1: DrawingAnchor; anchor2?: DrawingAnchor }, params?: Record<string, unknown>) => {
      switch (type) {
        case "fibonacci":
          if (anchors.anchor2) {
            createFibonacci(anchors.anchor1, anchors.anchor2);
          }
          break;
        case "trendline":
        case "ray":
        case "arrow":
        case "extendedLine":
          if (anchors.anchor2) {
            createTrendline(anchors.anchor1, anchors.anchor2, { type });
          }
          break;
        case "horizontalLine":
          createHorizontalLine(anchors.anchor1.price);
          break;
        case "horizontalRay":
          createHorizontalRay(anchors.anchor1);
          break;
        case "rectangle":
          if (anchors.anchor2) {
            createRectangle(anchors.anchor1, anchors.anchor2);
          }
          break;
        case "circle":
          if (anchors.anchor2) {
            createCircle(anchors.anchor1, anchors.anchor2);
          }
          break;
        case "longPosition":
          if (params && typeof params.takeProfit === "number" && typeof params.stopLoss === "number") {
            createLongPosition(
              anchors.anchor1,
              params.takeProfit,
              params.stopLoss,
              { endTimestamp: typeof params.endTimestamp === "number" ? params.endTimestamp : undefined }
            );
          }
          break;
        case "shortPosition":
          if (params && typeof params.takeProfit === "number" && typeof params.stopLoss === "number") {
            createShortPosition(
              anchors.anchor1,
              params.takeProfit,
              params.stopLoss,
              { endTimestamp: typeof params.endTimestamp === "number" ? params.endTimestamp : undefined }
            );
          }
          break;
      }

      // Reset tool after creation (return to select mode)
      setActiveDrawingTool(null);
    },
    [
      createFibonacci,
      createTrendline,
      createHorizontalLine,
      createHorizontalRay,
      createRectangle,
      createCircle,
      createLongPosition,
      createShortPosition,
      setActiveDrawingTool,
    ]
  );

  // Handle drawing deletion
  const handleDeleteDrawing = useCallback(
    (id: string) => {
      removeDrawing(id);
      if (selectedDrawingId === id) {
        selectDrawing(null);
      }
    },
    [removeDrawing, selectedDrawingId, selectDrawing]
  );

  // Handle clear all
  const handleClearAll = useCallback(() => {
    clearDrawings();
    selectDrawing(null);
  }, [clearDrawings, selectDrawing]);

  // Save to server (call this when you want to persist to Convex)
  const saveToServer = useCallback(() => {
    return useDrawingStore.getState().saveToServer(pair, timeframe);
  }, [pair, timeframe]);

  return {
    // State
    drawings,
    activeDrawingTool,
    selectedDrawingId,
    drawingCount: drawings.length,

    // Actions
    setActiveDrawingTool: handleToolSelect,
    selectDrawing,
    createDrawing: handleCreateDrawing,
    updateDrawing,
    deleteDrawing: handleDeleteDrawing,
    clearAll: handleClearAll,
    saveToServer,

    // Undo
    undo,
    canUndo,

    // Quick create helpers
    createFibonacci,
    createTrendline,
    createHorizontalLine,
    createHorizontalRay,
    createRectangle,
    createCircle,
    createLongPosition,
    createShortPosition,
  };
}

/**
 * Hook for keyboard shortcuts for drawing tools
 *
 * Shortcuts:
 * - V/Escape: Deselect tool
 * - T: Trendline
 * - R: Horizontal Ray
 * - H: Horizontal Line
 * - E: Extended Line
 * - F: Fibonacci
 * - S: Rectangle (Square zone)
 * - C: Circle
 * - L: Long Position
 * - O: Short Position
 * - Delete/Backspace: Delete selected
 * - Ctrl+Z: Undo
 * - 1-9: Quick color (when drawing selected)
 * - Arrow Up/Down: Move selected drawing up/down (micro adjustment)
 */
export function useDrawingKeyboardShortcuts(
  setActiveDrawingTool: (tool: DrawingType | null) => void,
  deleteSelected: () => void,
  selectedDrawingId: string | null,
  undo?: () => void,
  // Optional: for advanced shortcuts
  options?: {
    drawings?: Drawing[];
    updateDrawing?: (id: string, updates: Partial<Drawing>) => void;
    pair?: string;  // For pip calculation
  }
) {
  const setLastLineColor = useUserPreferences((s) => s.setLastLineColor);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger if typing in an input or editable element
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement)?.isContentEditable ||
        (event.target as HTMLElement)?.closest('[role="dialog"]') ||
        (event.target as HTMLElement)?.closest('[data-modal]')
      ) {
        return;
      }

      // Handle Ctrl+Z / Cmd+Z for undo
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (undo) {
          event.preventDefault();
          undo();
        }
        return;
      }

      // Don't trigger other shortcuts if modifier keys are held (except for quick colors)
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      // Get selected drawing if available
      const selectedDrawing = selectedDrawingId && options?.drawings
        ? options.drawings.find((d) => d.id === selectedDrawingId)
        : null;

      // Quick color shortcuts (1-9) when a drawing is selected
      if (selectedDrawing && options?.updateDrawing && /^[1-9]$/.test(event.key)) {
        const color = getQuickColor(event.key);
        if (color) {
          event.preventDefault();
          applyColorToDrawing(selectedDrawing, color, options.updateDrawing);
          setLastLineColor(color);
          return;
        }
      }

      // Arrow key micro-adjustments for position drawings
      if (selectedDrawing && options?.updateDrawing && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? 1 : -1;
        // Shift key = larger movement (10 pips), otherwise 1 pip
        const multiplier = event.shiftKey ? 10 : 1;
        moveDrawingVertically(selectedDrawing, direction, multiplier, options.updateDrawing, options.pair);
        return;
      }

      switch (event.key.toLowerCase()) {
        case "v":
        case "escape":
          setActiveDrawingTool(null);
          break;
        case "t":
          setActiveDrawingTool("trendline");
          break;
        case "r":
          setActiveDrawingTool("horizontalRay");
          break;
        case "h":
          setActiveDrawingTool("horizontalLine");
          break;
        case "e":
          setActiveDrawingTool("extendedLine");
          break;
        case "f":
          setActiveDrawingTool("fibonacci");
          break;
        case "s":
          setActiveDrawingTool("rectangle");
          break;
        case "c":
          setActiveDrawingTool("circle");
          break;
        case "l":
          setActiveDrawingTool("longPosition");
          break;
        case "o":
          setActiveDrawingTool("shortPosition");
          break;
        case "delete":
        case "backspace":
          if (selectedDrawingId) {
            deleteSelected();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setActiveDrawingTool, deleteSelected, selectedDrawingId, undo, options, setLastLineColor]);
}

/**
 * Apply color to a drawing based on its type
 */
function applyColorToDrawing(
  drawing: Drawing,
  color: string,
  updateDrawing: (id: string, updates: Partial<Drawing>) => void
) {
  if (isHorizontalLineDrawing(drawing) || isHorizontalRayDrawing(drawing)) {
    updateDrawing(drawing.id, { color });
  } else if (isTrendlineDrawing(drawing)) {
    updateDrawing(drawing.id, { color });
  } else if (isFibonacciDrawing(drawing)) {
    updateDrawing(drawing.id, { lineColor: color });
  } else if (isRectangleDrawing(drawing) || isCircleDrawing(drawing)) {
    updateDrawing(drawing.id, { borderColor: color });
  } else if (isPositionDrawing(drawing)) {
    // For positions, color affects TP (profit) color
    updateDrawing(drawing.id, { tpColor: color });
  }
}

/**
 * Move a drawing vertically by a number of pips
 */
function moveDrawingVertically(
  drawing: Drawing,
  direction: 1 | -1,
  pips: number,
  updateDrawing: (id: string, updates: Partial<Drawing>) => void,
  pair?: string
) {
  // Calculate pip value based on pair (JPY pairs = 0.01, others = 0.0001)
  const pipValue = pair?.includes("JPY") ? 0.01 : 0.0001;
  const delta = direction * pips * pipValue;

  if (isPositionDrawing(drawing)) {
    // Move the entire position (entry, TP, SL) by delta
    updateDrawing(drawing.id, {
      entry: {
        ...drawing.entry,
        price: drawing.entry.price + delta,
      },
      takeProfit: drawing.takeProfit + delta,
      stopLoss: drawing.stopLoss + delta,
    });
  } else if (isHorizontalLineDrawing(drawing)) {
    updateDrawing(drawing.id, { price: drawing.price + delta });
  } else if (isHorizontalRayDrawing(drawing)) {
    updateDrawing(drawing.id, {
      anchor: {
        ...drawing.anchor,
        price: drawing.anchor.price + delta,
      },
    });
  } else if (isTrendlineDrawing(drawing)) {
    updateDrawing(drawing.id, {
      anchor1: {
        ...drawing.anchor1,
        price: drawing.anchor1.price + delta,
      },
      anchor2: {
        ...drawing.anchor2,
        price: drawing.anchor2.price + delta,
      },
    });
  } else if (isFibonacciDrawing(drawing)) {
    updateDrawing(drawing.id, {
      anchor1: {
        ...drawing.anchor1,
        price: drawing.anchor1.price + delta,
      },
      anchor2: {
        ...drawing.anchor2,
        price: drawing.anchor2.price + delta,
      },
    });
  } else if (isRectangleDrawing(drawing) || isCircleDrawing(drawing)) {
    updateDrawing(drawing.id, {
      anchor1: {
        ...drawing.anchor1,
        price: drawing.anchor1.price + delta,
      },
      anchor2: {
        ...drawing.anchor2,
        price: drawing.anchor2.price + delta,
      },
    });
  }
}
