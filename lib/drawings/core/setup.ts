/**
 * Drawing Tools Core Setup
 *
 * Integration layer between our drawing types and lightweight-charts-line-tools.
 * This module handles:
 * - Initializing drawing tools on a chart
 * - Converting between our drawing format and the library format
 * - Syncing drawing state with our store
 */

import type { IChartApi } from "lightweight-charts";
import {
  Drawing,
  DrawingType,
  FibonacciDrawing,
  TrendlineDrawing,
  HorizontalLineDrawing,
  VerticalLineDrawing,
  RectangleDrawing,
  PositionDrawing,
  LongPositionDrawing,
  ShortPositionDrawing,
  DrawingAnchor,
} from "../types";

/**
 * Line tool types supported by lightweight-charts-line-tools
 */
type LineToolType =
  | "TrendLine"
  | "Ray"
  | "Arrow"
  | "ExtendedLine"
  | "HorizontalLine"
  | "VerticalLine"
  | "FibRetracement"
  | "Rectangle"
  | "ParallelChannel"
  | "Brush"
  | "Path"
  | "Text"
  | "Callout";

/**
 * Map our drawing types to line tool types
 */
const DRAWING_TYPE_MAP: Record<DrawingType, LineToolType | null> = {
  fibonacci: "FibRetracement",
  trendline: "TrendLine",
  ray: "Ray",
  arrow: "Arrow",
  extendedLine: "ExtendedLine",
  horizontalLine: "HorizontalLine",
  horizontalRay: null, // Uses custom canvas rendering
  verticalLine: "VerticalLine",
  rectangle: "Rectangle",
  circle: null, // Uses custom canvas rendering
  parallelChannel: "ParallelChannel",
  longPosition: null, // Position uses custom rendering
  shortPosition: null, // Position uses custom rendering
  markerArrowUp: null, // Markers use custom canvas rendering
  markerArrowDown: null,
  markerCircle: null,
  markerSquare: null,
};

/**
 * Line style mapping
 */
const LINE_STYLE_MAP: Record<string, number> = {
  solid: 0,
  dotted: 1,
  dashed: 2,
};

/**
 * Drawing tools manager
 * Handles the lifecycle of drawings on a chart
 */
export class DrawingToolsManager {
  private chart: IChartApi;
  private drawingIds: Map<string, string> = new Map(); // our ID -> library ID
  private onDrawingChange?: (drawings: Drawing[]) => void;

  constructor(chart: IChartApi) {
    this.chart = chart;
  }

  /**
   * Set callback for when drawings change
   */
  setOnDrawingChange(callback: (drawings: Drawing[]) => void): void {
    this.onDrawingChange = callback;
  }

  /**
   * Convert timestamp to chart time format (seconds)
   */
  private toChartTime(timestamp: number): number {
    return Math.floor(timestamp / 1000);
  }

  /**
   * Convert chart time to timestamp (milliseconds)
   */
  private fromChartTime(time: number): number {
    return time * 1000;
  }

  /**
   * Add a drawing to the chart
   */
  addDrawing(drawing: Drawing): string | null {
    const toolType = DRAWING_TYPE_MAP[drawing.type];

    if (!toolType) {
      // Handle position drawing separately (custom primitive)
      if (drawing.type === "longPosition" || drawing.type === "shortPosition") {
        return this.addPositionDrawing(drawing as PositionDrawing);
      }
      console.warn(`Unsupported drawing type: ${drawing.type}`);
      return null;
    }

    try {
      const { points, options } = this.convertToLineToolFormat(drawing, toolType);

      // Cast chart to any to access addLineTool (from lightweight-charts-line-tools)
      const chartWithLineTools = this.chart as IChartApi & {
        addLineTool: (
          type: string,
          points: Array<{ time: number; price: number }>,
          options: Record<string, unknown>
        ) => { id: () => string };
      };

      if (typeof chartWithLineTools.addLineTool !== "function") {
        console.warn("Chart does not support line tools. Use createChart from lightweight-charts-line-tools.");
        return null;
      }

      const lineTool = chartWithLineTools.addLineTool(toolType, points, options);
      const libraryId = lineTool.id();

      this.drawingIds.set(drawing.id, libraryId);
      return libraryId;
    } catch (error) {
      console.error(`Failed to add drawing ${drawing.id}:`, error);
      return null;
    }
  }

  /**
   * Remove a drawing from the chart
   */
  removeDrawing(drawingId: string): boolean {
    const libraryId = this.drawingIds.get(drawingId);

    if (!libraryId) {
      return false;
    }

    try {
      const chartWithLineTools = this.chart as IChartApi & {
        removeLineToolsById: (ids: string[]) => void;
      };

      if (typeof chartWithLineTools.removeLineToolsById === "function") {
        chartWithLineTools.removeLineToolsById([libraryId]);
      }

      this.drawingIds.delete(drawingId);
      return true;
    } catch (error) {
      console.error(`Failed to remove drawing ${drawingId}:`, error);
      return false;
    }
  }

  /**
   * Clear all drawings
   */
  clearAll(): void {
    const chartWithLineTools = this.chart as IChartApi & {
      removeAllLineTools: () => void;
    };

    if (typeof chartWithLineTools.removeAllLineTools === "function") {
      chartWithLineTools.removeAllLineTools();
    }

    this.drawingIds.clear();
  }

  /**
   * Set active drawing tool mode
   */
  setActiveDrawingTool(type: DrawingType | null, options?: Record<string, unknown>): void {
    if (!type) {
      // Clear active tool
      const chartWithLineTools = this.chart as IChartApi & {
        setActiveLineTool: (type: null, options: null) => void;
      };

      if (typeof chartWithLineTools.setActiveLineTool === "function") {
        chartWithLineTools.setActiveLineTool(null, null);
      }
      return;
    }

    const toolType = DRAWING_TYPE_MAP[type];

    if (!toolType) {
      console.warn(`Cannot set active tool for type: ${type}`);
      return;
    }

    const chartWithLineTools = this.chart as IChartApi & {
      setActiveLineTool: (type: string, options: Record<string, unknown>) => void;
    };

    if (typeof chartWithLineTools.setActiveLineTool === "function") {
      chartWithLineTools.setActiveLineTool(toolType, options || {});
    }
  }

  /**
   * Convert our drawing format to library format
   */
  private convertToLineToolFormat(
    drawing: Drawing,
    toolType: LineToolType
  ): {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  } {
    switch (drawing.type) {
      case "fibonacci":
        return this.convertFibonacci(drawing as FibonacciDrawing);

      case "trendline":
      case "ray":
      case "arrow":
      case "extendedLine":
        return this.convertTrendline(drawing as TrendlineDrawing);

      case "horizontalLine":
        return this.convertHorizontalLine(drawing as HorizontalLineDrawing);

      case "verticalLine":
        return this.convertVerticalLine(drawing as VerticalLineDrawing);

      case "rectangle":
        return this.convertRectangle(drawing as RectangleDrawing);

      default:
        return { points: [], options: {} };
    }
  }

  /**
   * Convert Fibonacci drawing
   */
  private convertFibonacci(drawing: FibonacciDrawing): {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  } {
    return {
      points: [
        { time: this.toChartTime(drawing.anchor1.timestamp), price: drawing.anchor1.price },
        { time: this.toChartTime(drawing.anchor2.timestamp), price: drawing.anchor2.price },
      ],
      options: {
        levels: drawing.levels.map((level) => ({
          coeff: level,
          color: drawing.levelColors?.[level] || drawing.lineColor,
        })),
        extendLeft: drawing.extendLeft,
        extendRight: drawing.extendRight,
        showLabels: drawing.showLabels,
        showPrices: drawing.showPrices,
        lineColor: drawing.lineColor,
      },
    };
  }

  /**
   * Convert Trendline drawing
   */
  private convertTrendline(drawing: TrendlineDrawing): {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  } {
    return {
      points: [
        { time: this.toChartTime(drawing.anchor1.timestamp), price: drawing.anchor1.price },
        { time: this.toChartTime(drawing.anchor2.timestamp), price: drawing.anchor2.price },
      ],
      options: {
        line: {
          color: drawing.color,
          width: drawing.lineWidth,
          style: LINE_STYLE_MAP[drawing.lineStyle] || 0,
        },
        text: drawing.showLabel
          ? {
              value: drawing.labelText || "",
              visible: true,
            }
          : undefined,
      },
    };
  }

  /**
   * Convert Horizontal Line drawing
   */
  private convertHorizontalLine(drawing: HorizontalLineDrawing): {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  } {
    return {
      points: [{ time: 0, price: drawing.price }],
      options: {
        line: {
          color: drawing.color,
          width: drawing.lineWidth,
          style: LINE_STYLE_MAP[drawing.lineStyle] || 0,
        },
        text: drawing.showLabel
          ? {
              value: drawing.labelText || drawing.price.toFixed(5),
              visible: true,
            }
          : undefined,
      },
    };
  }

  /**
   * Convert Vertical Line drawing
   */
  private convertVerticalLine(drawing: VerticalLineDrawing): {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  } {
    return {
      points: [{ time: this.toChartTime(drawing.timestamp), price: 0 }],
      options: {
        line: {
          color: drawing.color,
          width: drawing.lineWidth,
          style: LINE_STYLE_MAP[drawing.lineStyle] || 0,
        },
        text: drawing.showLabel
          ? {
              value: drawing.labelText || "",
              visible: true,
            }
          : undefined,
      },
    };
  }

  /**
   * Convert Rectangle drawing
   */
  private convertRectangle(drawing: RectangleDrawing): {
    points: Array<{ time: number; price: number }>;
    options: Record<string, unknown>;
  } {
    return {
      points: [
        { time: this.toChartTime(drawing.anchor1.timestamp), price: drawing.anchor1.price },
        { time: this.toChartTime(drawing.anchor2.timestamp), price: drawing.anchor2.price },
      ],
      options: {
        background: {
          color: drawing.fillColor,
        },
        border: {
          color: drawing.borderColor,
          width: drawing.borderWidth,
        },
        text: drawing.showLabel
          ? {
              value: drawing.labelText || "",
              visible: true,
            }
          : undefined,
      },
    };
  }

  /**
   * Add position drawing (custom handling)
   * Position drawings show entry, TP, and SL levels
   */
  private addPositionDrawing(drawing: PositionDrawing): string | null {
    // Position drawings need multiple horizontal lines
    // For now, we'll add them as separate lines
    // In a full implementation, this would use a custom primitive

    const entryTime = this.toChartTime(drawing.entry.timestamp);
    const isLong = drawing.type === "longPosition";
    const direction = isLong ? "LONG" : "SHORT";

    try {
      const chartWithLineTools = this.chart as IChartApi & {
        addLineTool: (
          type: string,
          points: Array<{ time: number; price: number }>,
          options: Record<string, unknown>
        ) => { id: () => string };
      };

      if (typeof chartWithLineTools.addLineTool !== "function") {
        return null;
      }

      // Entry line
      chartWithLineTools.addLineTool(
        "HorizontalLine",
        [{ time: entryTime, price: drawing.entry.price }],
        {
          line: { color: "#2196F3", width: 2, style: 0 },
          text: { value: `Entry ${direction}`, visible: true },
        }
      );

      // Take profit line
      chartWithLineTools.addLineTool(
        "HorizontalLine",
        [{ time: entryTime, price: drawing.takeProfit }],
        {
          line: { color: "#26A69A", width: 1, style: 2 },
          text: { value: "TP", visible: true },
        }
      );

      // Stop loss line
      chartWithLineTools.addLineTool(
        "HorizontalLine",
        [{ time: entryTime, price: drawing.stopLoss }],
        {
          line: { color: "#EF5350", width: 1, style: 2 },
          text: { value: "SL", visible: true },
        }
      );

      // Store a placeholder ID
      this.drawingIds.set(drawing.id, `position_${drawing.id}`);
      return drawing.id;
    } catch (error) {
      console.error(`Failed to add position drawing:`, error);
      return null;
    }
  }

  /**
   * Export all drawings to our format
   */
  exportDrawings(): string {
    const chartWithLineTools = this.chart as IChartApi & {
      exportLineTools: () => string;
    };

    if (typeof chartWithLineTools.exportLineTools === "function") {
      return chartWithLineTools.exportLineTools();
    }

    return "[]";
  }

  /**
   * Import drawings from JSON
   */
  importDrawings(json: string): boolean {
    const chartWithLineTools = this.chart as IChartApi & {
      importLineTools: (json: string) => boolean;
    };

    if (typeof chartWithLineTools.importLineTools === "function") {
      return chartWithLineTools.importLineTools(json);
    }

    return false;
  }
}

/**
 * Initialize drawing tools on a chart
 *
 * Note: The chart must be created using createChart from lightweight-charts-line-tools
 * instead of the standard lightweight-charts package.
 *
 * @param chart - The chart instance (must support line tools)
 * @returns DrawingToolsManager instance
 */
export function initializeDrawingTools(chart: IChartApi): DrawingToolsManager {
  return new DrawingToolsManager(chart);
}

/**
 * Check if a chart supports line tools
 */
export function supportsLineTools(chart: IChartApi): boolean {
  const chartWithLineTools = chart as IChartApi & {
    addLineTool?: unknown;
  };

  return typeof chartWithLineTools.addLineTool === "function";
}
