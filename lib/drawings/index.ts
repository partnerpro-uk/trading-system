/**
 * Drawings Module - Public API
 *
 * Chart drawing tools for Fibonacci, trendlines, rectangles, and positions.
 * Includes Claude-readable description generation.
 */

// Types
export * from "./types";

// Store
export { useDrawingStore, useChartDrawings } from "./store";

// Tools
export * from "./tools";

// Colors
export * from "./colors";

// Description generator (for Claude)
export * from "./describe";
