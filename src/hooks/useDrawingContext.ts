/**
 * useDrawingContext Hook
 *
 * Provides drawing context for Claude conversations.
 * Generates semantic understanding of chart annotations.
 */

import { useCallback, useMemo } from "react";
import { useChartDrawings } from "@/lib/drawings/store";
import {
  Drawing,
  isHorizontalLineDrawing,
  isFibonacciDrawing,
  isRectangleDrawing,
  isPositionDrawing,
  isTrendlineDrawing,
} from "@/lib/drawings/types";
import {
  describeDrawing,
  describeAllDrawings,
  extractKeyLevels,
  isNearPrice,
  isPriceAbove,
  isPriceBelow,
} from "@/lib/drawings/describe";
import { getColorName } from "@/lib/drawings/colors";

interface DrawingContextOptions {
  pair: string;
  timeframe: string;
}

interface HorizontalLevel {
  price: number;
  label?: string;
  color: string;
  colorName: string;
}

interface FibLevel {
  price: number;
  level: string;
  fibId: string;
  label?: string;
}

interface DrawingContextResult {
  // Summary for Claude
  summary: string;

  // Structured data for precise queries
  levels: {
    horizontalLines: HorizontalLevel[];
    fibLevels: FibLevel[];
  };

  // All key price levels sorted by proximity
  keyLevels: Array<{
    price: number;
    description: string;
    label?: string;
    type: string;
  }>;

  // Grouped by position relative to price
  resistance: Drawing[];
  support: Drawing[];
  nearby: Drawing[];
}

/**
 * Hook that provides drawing context for Claude conversations
 */
export function useDrawingContext({ pair, timeframe }: DrawingContextOptions) {
  const { drawings } = useChartDrawings(pair, timeframe);

  /**
   * Get full context for Claude given the current price
   */
  const getContext = useCallback(
    (currentPrice: number, thresholdPips = 20): DrawingContextResult => {
      // Generate summary description
      const summary = describeAllDrawings(drawings, currentPrice, thresholdPips);

      // Extract horizontal line levels
      const horizontalLines: HorizontalLevel[] = drawings
        .filter(isHorizontalLineDrawing)
        .map((d) => ({
          price: d.price,
          label: d.label,
          color: d.color,
          colorName: getColorName(d.color),
        }));

      // Extract fibonacci levels
      const fibLevels: FibLevel[] = drawings
        .filter(isFibonacciDrawing)
        .flatMap((d) =>
          d.levels.map((level) => ({
            price: d.anchor1.price + (d.anchor2.price - d.anchor1.price) * level,
            level: `${(level * 100).toFixed(1)}%`,
            fibId: d.id,
            label: d.label,
          }))
        );

      // Extract key levels
      const keyLevels = extractKeyLevels(drawings, currentPrice);

      // Group by position relative to price
      const nearby = drawings.filter((d) => isNearPrice(d, currentPrice, thresholdPips));
      const resistance = drawings.filter(
        (d) => isPriceAbove(d, currentPrice) && !isNearPrice(d, currentPrice, thresholdPips)
      );
      const support = drawings.filter(
        (d) => isPriceBelow(d, currentPrice) && !isNearPrice(d, currentPrice, thresholdPips)
      );

      return {
        summary,
        levels: {
          horizontalLines,
          fibLevels,
        },
        keyLevels,
        resistance,
        support,
        nearby,
      };
    },
    [drawings]
  );

  /**
   * Find drawings by label (case-insensitive partial match)
   */
  const findByLabel = useCallback(
    (label: string): Drawing[] => {
      const searchTerm = label.toLowerCase();
      return drawings.filter((d) =>
        d.label?.toLowerCase().includes(searchTerm)
      );
    },
    [drawings]
  );

  /**
   * Find drawings by color name
   */
  const findByColor = useCallback(
    (colorName: string): Drawing[] => {
      const searchTerm = colorName.toLowerCase();
      return drawings.filter((d) => {
        const drawingColor = (d as { color?: string; lineColor?: string }).color ||
          (d as { lineColor?: string }).lineColor ||
          (d as { borderColor?: string }).borderColor;
        if (!drawingColor) return false;
        return getColorName(drawingColor) === searchTerm;
      });
    },
    [drawings]
  );

  /**
   * Find drawings by tag
   */
  const findByTag = useCallback(
    (tag: string): Drawing[] => {
      const searchTerm = tag.toLowerCase();
      return drawings.filter((d) =>
        d.tags?.some((t) => t.toLowerCase() === searchTerm)
      );
    },
    [drawings]
  );

  /**
   * Find drawings by type
   */
  const findByType = useCallback(
    (type: Drawing["type"]): Drawing[] => {
      return drawings.filter((d) => d.type === type);
    },
    [drawings]
  );

  /**
   * Find the nearest drawing to a price level
   */
  const findNearestToPrice = useCallback(
    (price: number): Drawing | null => {
      if (drawings.length === 0) return null;

      let nearest: Drawing | null = null;
      let minDistance = Infinity;

      for (const drawing of drawings) {
        let drawingPrice: number | null = null;

        if (isHorizontalLineDrawing(drawing)) {
          drawingPrice = drawing.price;
        } else if (isTrendlineDrawing(drawing) || isRectangleDrawing(drawing) || isFibonacciDrawing(drawing)) {
          const d = drawing as { anchor1: { price: number }; anchor2: { price: number } };
          drawingPrice = (d.anchor1.price + d.anchor2.price) / 2;
        } else if (isPositionDrawing(drawing)) {
          drawingPrice = drawing.entry.price;
        }

        if (drawingPrice !== null) {
          const distance = Math.abs(drawingPrice - price);
          if (distance < minDistance) {
            minDistance = distance;
            nearest = drawing;
          }
        }
      }

      return nearest;
    },
    [drawings]
  );

  /**
   * Get individual drawing description
   */
  const describe = useCallback((drawing: Drawing): string => {
    return describeDrawing(drawing);
  }, []);

  /**
   * Statistics about drawings
   */
  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    const byCreator: Record<string, number> = {};
    const labeled = drawings.filter((d) => d.label).length;
    const withNotes = drawings.filter((d) => d.notes).length;
    const withTags = drawings.filter((d) => d.tags && d.tags.length > 0).length;

    for (const d of drawings) {
      byType[d.type] = (byType[d.type] || 0) + 1;
      byCreator[d.createdBy] = (byCreator[d.createdBy] || 0) + 1;
    }

    return {
      total: drawings.length,
      byType,
      byCreator,
      labeled,
      withNotes,
      withTags,
    };
  }, [drawings]);

  return {
    // Raw drawings
    drawings,

    // Context generator
    getContext,

    // Search methods
    findByLabel,
    findByColor,
    findByTag,
    findByType,
    findNearestToPrice,

    // Description helper
    describe,

    // Stats
    stats,
  };
}
