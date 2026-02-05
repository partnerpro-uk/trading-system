/**
 * User Drawing Preferences Store
 *
 * Persists user's last-used styling choices across sessions.
 * Applied as defaults when creating new drawings.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { COLOR_PRESETS } from "./colors";
import { DEFAULT_FIB_LEVELS, DEFAULT_DRAWING_COLORS } from "./types";

/**
 * User preferences interface
 */
interface UserDrawingPreferences {
  // Line styles
  lastLineColor: string;
  lastLineWidth: number;
  lastLineStyle: "solid" | "dashed" | "dotted";

  // Fill styles (for rectangles, circles)
  lastFillColor: string;
  lastBorderColor: string;

  // Fibonacci
  lastFibColor: string;
  lastFibLevels: number[];
  lastFibLevelColors: Record<number, string>;

  // Position drawing
  lastTpColor: string;
  lastSlColor: string;

  // Actions
  setLastLineColor: (color: string) => void;
  setLastLineWidth: (width: number) => void;
  setLastLineStyle: (style: "solid" | "dashed" | "dotted") => void;
  setLastFillColor: (color: string) => void;
  setLastBorderColor: (color: string) => void;
  setLastFibColor: (color: string) => void;
  setLastFibLevels: (levels: number[]) => void;
  setLastFibLevelColors: (colors: Record<number, string>) => void;
  setLastFibLevelColor: (level: number, color: string) => void;
  setLastTpColor: (color: string) => void;
  setLastSlColor: (color: string) => void;

  // Batch update
  updateFromDrawing: (updates: Partial<{
    lineColor: string;
    lineWidth: number;
    lineStyle: "solid" | "dashed" | "dotted";
    fillColor: string;
    borderColor: string;
    color: string;
    tpColor: string;
    slColor: string;
  }>) => void;

  // Get defaults for creating new drawings
  getLineDefaults: () => { color: string; lineWidth: number; lineStyle: "solid" | "dashed" | "dotted" };
  getFillDefaults: () => { fillColor: string; borderColor: string };
  getPositionDefaults: () => { tpColor: string; slColor: string };
  getFibDefaults: () => { levels: number[]; levelColors: Record<number, string> };
}

/**
 * Default values
 */
const DEFAULTS = {
  lineColor: "#2962FF",      // Blue
  lineWidth: 2,
  lineStyle: "solid" as const,
  fillColor: "rgba(33, 150, 243, 0.1)",
  borderColor: "#2196F3",
  fibColor: "#787B86",
  fibLevels: DEFAULT_FIB_LEVELS,
  fibLevelColors: DEFAULT_DRAWING_COLORS.fibonacci.levels,
  tpColor: "#26A69A",        // Green
  slColor: "#EF5350",        // Red
};

/**
 * User preferences store
 */
export const useUserPreferences = create<UserDrawingPreferences>()(
  persist(
    (set, get) => ({
      // Initial values
      lastLineColor: DEFAULTS.lineColor,
      lastLineWidth: DEFAULTS.lineWidth,
      lastLineStyle: DEFAULTS.lineStyle,
      lastFillColor: DEFAULTS.fillColor,
      lastBorderColor: DEFAULTS.borderColor,
      lastFibColor: DEFAULTS.fibColor,
      lastFibLevels: DEFAULTS.fibLevels,
      lastFibLevelColors: DEFAULTS.fibLevelColors,
      lastTpColor: DEFAULTS.tpColor,
      lastSlColor: DEFAULTS.slColor,

      // Setters
      setLastLineColor: (color) => set({ lastLineColor: color }),
      setLastLineWidth: (width) => set({ lastLineWidth: width }),
      setLastLineStyle: (style) => set({ lastLineStyle: style }),
      setLastFillColor: (color) => set({ lastFillColor: color }),
      setLastBorderColor: (color) => set({ lastBorderColor: color }),
      setLastFibColor: (color) => set({ lastFibColor: color }),
      setLastFibLevels: (levels) => set({ lastFibLevels: levels }),
      setLastFibLevelColors: (colors) => set({ lastFibLevelColors: colors }),
      setLastFibLevelColor: (level, color) => set((state) => ({
        lastFibLevelColors: { ...state.lastFibLevelColors, [level]: color }
      })),
      setLastTpColor: (color) => set({ lastTpColor: color }),
      setLastSlColor: (color) => set({ lastSlColor: color }),

      // Batch update from a drawing's properties
      updateFromDrawing: (updates) => {
        const newState: Partial<UserDrawingPreferences> = {};

        if (updates.lineColor || updates.color) {
          newState.lastLineColor = updates.lineColor || updates.color;
        }
        if (updates.lineWidth) {
          newState.lastLineWidth = updates.lineWidth;
        }
        if (updates.lineStyle) {
          newState.lastLineStyle = updates.lineStyle;
        }
        if (updates.fillColor) {
          newState.lastFillColor = updates.fillColor;
        }
        if (updates.borderColor) {
          newState.lastBorderColor = updates.borderColor;
        }
        if (updates.tpColor) {
          newState.lastTpColor = updates.tpColor;
        }
        if (updates.slColor) {
          newState.lastSlColor = updates.slColor;
        }

        if (Object.keys(newState).length > 0) {
          set(newState);
        }
      },

      // Get defaults for new drawings
      getLineDefaults: () => ({
        color: get().lastLineColor,
        lineWidth: get().lastLineWidth,
        lineStyle: get().lastLineStyle,
      }),

      getFillDefaults: () => ({
        fillColor: get().lastFillColor,
        borderColor: get().lastBorderColor,
      }),

      getPositionDefaults: () => ({
        tpColor: get().lastTpColor,
        slColor: get().lastSlColor,
      }),

      getFibDefaults: () => ({
        levels: get().lastFibLevels,
        levelColors: get().lastFibLevelColors,
      }),
    }),
    {
      name: "trading-user-preferences",
      partialize: (state) => ({
        lastLineColor: state.lastLineColor,
        lastLineWidth: state.lastLineWidth,
        lastLineStyle: state.lastLineStyle,
        lastFillColor: state.lastFillColor,
        lastBorderColor: state.lastBorderColor,
        lastFibColor: state.lastFibColor,
        lastFibLevels: state.lastFibLevels,
        lastFibLevelColors: state.lastFibLevelColors,
        lastTpColor: state.lastTpColor,
        lastSlColor: state.lastSlColor,
      }),
    }
  )
);

/**
 * Quick color shortcut mapping (keys 1-9)
 * Maps number keys to color presets
 */
export const QUICK_COLOR_MAP: Record<string, string> = {
  "1": COLOR_PRESETS[0].value,  // Red
  "2": COLOR_PRESETS[1].value,  // Green
  "3": COLOR_PRESETS[2].value,  // Blue
  "4": COLOR_PRESETS[3].value,  // Yellow
  "5": COLOR_PRESETS[4].value,  // Orange
  "6": COLOR_PRESETS[5].value,  // Purple
  "7": COLOR_PRESETS[6].value,  // Cyan
  "8": COLOR_PRESETS[7].value,  // White
  "9": COLOR_PRESETS[8].value,  // Gray
};

/**
 * Get color for a number key (1-9)
 */
export function getQuickColor(key: string): string | null {
  return QUICK_COLOR_MAP[key] || null;
}
