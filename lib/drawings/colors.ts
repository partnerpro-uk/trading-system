/**
 * Drawing Colors System
 *
 * Color presets and utilities for drawing tools.
 * Includes named color mapping for Claude understanding.
 */

/**
 * Color preset with metadata
 */
export interface ColorPreset {
  name: string;
  value: string;
  category: "bullish" | "bearish" | "neutral" | "highlight" | "warning" | "custom";
}

/**
 * TradingView-style color presets (3x3 grid)
 */
export const COLOR_PRESETS: ColorPreset[] = [
  { name: "Red", value: "#EF5350", category: "bearish" },
  { name: "Green", value: "#26A69A", category: "bullish" },
  { name: "Blue", value: "#2962FF", category: "neutral" },
  { name: "Yellow", value: "#FFEB3B", category: "highlight" },
  { name: "Orange", value: "#FF9800", category: "warning" },
  { name: "Purple", value: "#9C27B0", category: "custom" },
  { name: "Cyan", value: "#00BCD4", category: "custom" },
  { name: "White", value: "#FFFFFF", category: "neutral" },
  { name: "Gray", value: "#787B86", category: "neutral" },
];

/**
 * Convert hex color to RGB components
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Convert RGB to hex color
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Get human-readable color name from hex value
 * Used by Claude to understand drawing colors semantically
 */
export function getColorName(hex: string): string {
  if (!hex) return "unknown";

  // Check against presets first (exact match)
  const preset = COLOR_PRESETS.find(
    (p) => p.value.toLowerCase() === hex.toLowerCase()
  );
  if (preset) return preset.name.toLowerCase();

  // Approximate color name based on RGB values
  const rgb = hexToRgb(hex);
  if (!rgb) return "custom";

  const { r, g, b } = rgb;

  // Check for grayscale
  if (Math.abs(r - g) < 30 && Math.abs(g - b) < 30 && Math.abs(r - b) < 30) {
    if (r < 50) return "black";
    if (r > 200) return "white";
    return "gray";
  }

  // Check dominant color
  const max = Math.max(r, g, b);
  const threshold = max * 0.6;

  // Strong single color dominance
  if (r >= max && r > threshold && g < threshold && b < threshold) {
    return r > 180 ? "red" : "dark red";
  }
  if (g >= max && g > threshold && r < threshold && b < threshold) {
    return g > 180 ? "green" : "dark green";
  }
  if (b >= max && b > threshold && r < threshold && g < threshold) {
    return b > 180 ? "blue" : "dark blue";
  }

  // Mixed colors
  if (r > threshold && g > threshold && b < threshold) {
    return r > g ? "orange" : "yellow";
  }
  if (r > threshold && b > threshold && g < threshold) {
    return r > b ? "pink" : "purple";
  }
  if (g > threshold && b > threshold && r < threshold) {
    return "cyan";
  }

  return "custom";
}

/**
 * Get color category for semantic grouping
 */
export function getColorCategory(hex: string): string {
  const preset = COLOR_PRESETS.find(
    (p) => p.value.toLowerCase() === hex.toLowerCase()
  );
  if (preset) return preset.category;

  const name = getColorName(hex);
  if (name.includes("red") || name.includes("orange")) return "bearish";
  if (name.includes("green") || name.includes("cyan")) return "bullish";
  return "neutral";
}

/**
 * Apply opacity to a hex color
 */
export function withOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
}

/**
 * Get contrasting text color (black or white) for a background
 */
export function getContrastingTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#FFFFFF";

  // Calculate relative luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
}

/**
 * Default colors for different drawing types
 */
export const DEFAULT_TYPE_COLORS: Record<string, string> = {
  horizontalLine: "#787B86",
  verticalLine: "#787B86",
  trendline: "#2962FF",
  ray: "#2962FF",
  arrow: "#2962FF",
  extendedLine: "#2962FF",
  fibonacci: "#787B86",
  rectangle: "#2196F3",
  position: "#26A69A",
};
