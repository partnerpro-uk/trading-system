/**
 * Drawing Filter for Trade Snapshots
 *
 * Pure functions that determine which drawings belong in a snapshot.
 * Three criteria applied as a union (OR), deduped by drawing ID:
 * 1. Trade-linked: drawing.tradeId matches the trade
 * 2. Time-correlated: drawing created during the trade lifecycle
 * 3. Viewport-intersecting: drawing visible in the snapshot's time range
 */

import {
  Drawing,
  isFibonacciDrawing,
  isTrendlineDrawing,
  isHorizontalLineDrawing,
  isHorizontalRayDrawing,
  isVerticalLineDrawing,
  isRectangleDrawing,
  isCircleDrawing,
  isPositionDrawing,
  isMarkerDrawing,
} from "@/lib/drawings/types";

interface VisibleRange {
  from: number; // Earliest visible candle timestamp (Unix ms)
  to: number;   // Latest visible candle timestamp (Unix ms)
}

/**
 * Get drawings explicitly linked to a trade via tradeId
 */
function getTradeLinkedDrawings(allDrawings: Drawing[], tradeId: string): Drawing[] {
  return allDrawings.filter((d) => d.tradeId === tradeId);
}

/**
 * Get drawings created during the trade's lifecycle
 */
function getTimeCorrelatedDrawings(
  allDrawings: Drawing[],
  tradeCreatedAt: number,
  snapshotTimestamp: number
): Drawing[] {
  return allDrawings.filter(
    (d) => d.createdAt >= tradeCreatedAt && d.createdAt <= snapshotTimestamp
  );
}

/**
 * Check if a drawing intersects the visible time range.
 * This catches old zones/levels that extend into the current view.
 */
function doesDrawingIntersectViewport(drawing: Drawing, range: VisibleRange): boolean {
  // Horizontal lines span all time — always visible
  if (isHorizontalLineDrawing(drawing)) {
    return true;
  }

  // Horizontal rays extend rightward from their anchor
  if (isHorizontalRayDrawing(drawing)) {
    return drawing.anchor.timestamp <= range.to;
  }

  // Vertical lines — visible if timestamp is in range
  if (isVerticalLineDrawing(drawing)) {
    return drawing.timestamp >= range.from && drawing.timestamp <= range.to;
  }

  // Two-anchor drawings: fibonacci, trendline, rectangle, circle, parallel channel
  if (isFibonacciDrawing(drawing) || isRectangleDrawing(drawing) || isCircleDrawing(drawing)) {
    const minTime = Math.min(drawing.anchor1.timestamp, drawing.anchor2.timestamp);
    const maxTime = Math.max(drawing.anchor1.timestamp, drawing.anchor2.timestamp);
    // Overlaps if drawing's time range intersects the visible range
    return minTime <= range.to && maxTime >= range.from;
  }

  // Trendlines, rays, extended lines — check anchor overlap + extension
  if (isTrendlineDrawing(drawing)) {
    const minTime = Math.min(drawing.anchor1.timestamp, drawing.anchor2.timestamp);
    const maxTime = Math.max(drawing.anchor1.timestamp, drawing.anchor2.timestamp);

    // Extended lines and rays extend beyond their anchors
    if (drawing.type === "extendedLine" || drawing.type === "ray") {
      // Extends rightward — visible if start is before range end
      return minTime <= range.to;
    }

    return minTime <= range.to && maxTime >= range.from;
  }

  // Position drawings — check entry timestamp
  if (isPositionDrawing(drawing)) {
    const entryTime = drawing.entry.timestamp;
    const endTime = drawing.endTimestamp || drawing.exitTimestamp || entryTime;
    return entryTime <= range.to && endTime >= range.from;
  }

  // Markers — single anchor point
  if (isMarkerDrawing(drawing)) {
    return drawing.anchor.timestamp >= range.from && drawing.anchor.timestamp <= range.to;
  }

  return false;
}

/**
 * Get drawings that intersect the visible time range
 */
function getViewportIntersectingDrawings(
  allDrawings: Drawing[],
  visibleRange: VisibleRange
): Drawing[] {
  return allDrawings.filter((d) => doesDrawingIntersectViewport(d, visibleRange));
}

/**
 * Filter drawings for a snapshot using three criteria (union, deduped).
 *
 * @param allDrawings - All drawings for the current pair/timeframe
 * @param tradeId - The trade this snapshot belongs to
 * @param tradeCreatedAt - When the trade was created (Unix ms)
 * @param snapshotTimestamp - When the snapshot is being taken (Unix ms)
 * @param visibleRange - The visible time range on the chart
 * @returns Filtered and deduped array of drawings
 */
export function filterDrawingsForSnapshot(
  allDrawings: Drawing[],
  tradeId: string,
  tradeCreatedAt: number,
  snapshotTimestamp: number,
  visibleRange: VisibleRange
): Drawing[] {
  const sets = [
    getTradeLinkedDrawings(allDrawings, tradeId),
    getTimeCorrelatedDrawings(allDrawings, tradeCreatedAt, snapshotTimestamp),
    getViewportIntersectingDrawings(allDrawings, visibleRange),
  ];

  // Union and dedupe by drawing.id
  const seen = new Set<string>();
  const result: Drawing[] = [];

  for (const set of sets) {
    for (const d of set) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        result.push(d);
      }
    }
  }

  return result;
}
