/**
 * FVGZonesPrimitive — Renders Fair Value Gap zones as filled rectangles.
 *
 * Each FVG is a horizontal rectangle from createdAt to the right edge.
 * Bullish = green tint, bearish = red tint.
 * Alpha varies by status (fresh > partial > filled > inverted) and tier.
 * Includes dashed midline and small label at left edge.
 */

import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import {
  CanvasRenderingTarget2D,
  BitmapCoordinatesRenderingScope,
} from "fancy-canvas";

export interface FVGZoneData {
  topPrice: number;
  bottomPrice: number;
  midline: number;
  direction: "bullish" | "bearish";
  status: "fresh" | "partial" | "filled" | "inverted";
  tier: 1 | 2 | 3;
  createdAt: number; // unix ms
  fillPercent: number;
}

interface RendererZone {
  startX: number;
  endX: number;
  topY: number;
  bottomY: number;
  midlineY: number;
  color: string;
  alpha: number;
  labelText: string;
  isInverted: boolean;
}

interface RendererData {
  zones: RendererZone[];
}

// Alpha by status
const STATUS_ALPHA: Record<string, number> = {
  fresh: 0.15,
  partial: 0.10,
  filled: 0.04,
  inverted: 0.03,
};

// Tier multiplier (lower tier = less visible)
const TIER_MULTIPLIER: Record<number, number> = {
  1: 1.0,
  2: 0.7,
  3: 0.4,
};

class FVGZonesRenderer implements IPrimitivePaneRenderer {
  private _data: RendererData | null = null;

  update(data: RendererData) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || this._data.zones.length === 0) return;

    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const ctx = scope.context;
        const { horizontalPixelRatio, verticalPixelRatio } = scope;
        const chartWidth = scope.bitmapSize.width;

        ctx.save();

        for (const zone of this._data!.zones) {
          const sx = zone.startX * horizontalPixelRatio;
          const ex = zone.endX > 0
            ? zone.endX * horizontalPixelRatio
            : chartWidth;
          const topY = zone.topY * verticalPixelRatio;
          const bottomY = zone.bottomY * verticalPixelRatio;
          const midY = zone.midlineY * verticalPixelRatio;

          // Skip off-screen
          if (bottomY < 0 || topY > scope.bitmapSize.height) continue;

          const width = ex - sx;
          const height = bottomY - topY;

          // --- Filled rectangle ---
          ctx.globalAlpha = zone.alpha;
          ctx.fillStyle = zone.color;
          ctx.fillRect(sx, topY, width, height);

          // --- Inverted: dashed border ---
          if (zone.isInverted) {
            ctx.strokeStyle = zone.color;
            ctx.lineWidth = 1 * verticalPixelRatio;
            ctx.setLineDash([4 * horizontalPixelRatio, 3 * horizontalPixelRatio]);
            ctx.globalAlpha = Math.min(zone.alpha * 2, 0.3);
            ctx.strokeRect(sx, topY, width, height);
            ctx.setLineDash([]);
          }

          // --- Dashed midline ---
          ctx.globalAlpha = Math.min(zone.alpha + 0.05, 0.25);
          ctx.strokeStyle = zone.color;
          ctx.lineWidth = 1 * verticalPixelRatio;
          ctx.setLineDash([3 * horizontalPixelRatio, 3 * horizontalPixelRatio]);
          ctx.beginPath();
          ctx.moveTo(sx, midY);
          ctx.lineTo(ex, midY);
          ctx.stroke();
          ctx.setLineDash([]);

          // --- Label at left edge ---
          const fontSize = Math.round(7 * verticalPixelRatio);
          ctx.font = `${fontSize}px monospace`;
          ctx.globalAlpha = Math.min(zone.alpha + 0.15, 0.5);

          // Background for label
          const metrics = ctx.measureText(zone.labelText);
          const padX = 2 * horizontalPixelRatio;
          const padY = 1 * verticalPixelRatio;
          ctx.fillStyle = "rgba(10, 10, 10, 0.7)";
          ctx.fillRect(
            sx,
            topY - fontSize - padY * 2,
            metrics.width + padX * 2,
            fontSize + padY * 2
          );

          // Label text
          ctx.fillStyle = zone.color;
          ctx.textAlign = "left";
          ctx.fillText(zone.labelText, sx + padX, topY - padY);

          ctx.globalAlpha = 1;
        }

        ctx.restore();
      }
    );
  }
}

class FVGZonesPaneView implements IPrimitivePaneView {
  private _source: FVGZonesPrimitive;
  private _renderer: FVGZonesRenderer;

  constructor(source: FVGZonesPrimitive) {
    this._source = source;
    this._renderer = new FVGZonesRenderer();
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer {
    const zones = this._source.getZones();
    this._renderer.update({ zones });
    return this._renderer;
  }
}

export class FVGZonesPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: FVGZonesPaneView;
  private _fvgs: FVGZoneData[] = [];
  private _minTier: 1 | 2 | 3 = 3;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;

  constructor() {
    this._paneView = new FVGZonesPaneView(this);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attached({ chart, series }: { chart: any; series: any }) {
    this._chart = chart;
    this._series = series;
  }

  detached() {
    this._chart = null;
    this._series = null;
  }

  paneViews() {
    return [this._paneView];
  }

  updateFVGs(fvgs: FVGZoneData[]) {
    this._fvgs = fvgs;
    this._requestUpdate();
  }

  setTierFilter(minTier: 1 | 2 | 3) {
    this._minTier = minTier;
    this._requestUpdate();
  }

  getZones(): RendererZone[] {
    if (!this._chart || !this._series) return [];

    const timeScale = this._chart.timeScale();
    const zones: RendererZone[] = [];

    // Get the right edge coordinate
    const visibleRange = timeScale.getVisibleLogicalRange();
    const rightEdgeX = visibleRange
      ? timeScale.logicalToCoordinate(visibleRange.to)
      : null;

    // Cap: last 50 unfilled FVGs
    const filtered = this._fvgs
      .filter((f) => f.tier <= this._minTier)
      .slice(-50);

    for (const fvg of filtered) {
      const startTime = (fvg.createdAt / 1000) as Time;
      const startX = timeScale.timeToCoordinate(startTime);
      const topY = this._series.priceToCoordinate(fvg.topPrice);
      const bottomY = this._series.priceToCoordinate(fvg.bottomPrice);
      const midlineY = this._series.priceToCoordinate(fvg.midline);

      if (startX !== null && topY !== null && bottomY !== null && midlineY !== null) {
        const baseColor = fvg.direction === "bullish" ? "#22c55e" : "#ef4444";
        const displayColor = fvg.status === "inverted"
          ? (fvg.direction === "bullish" ? "#ef4444" : "#22c55e") // flip color
          : baseColor;

        const baseAlpha = STATUS_ALPHA[fvg.status] || 0.10;
        const tierMult = TIER_MULTIPLIER[fvg.tier] || 1.0;
        const alpha = baseAlpha * tierMult;

        const fillPctText = fvg.fillPercent > 0
          ? ` ${Math.round(fvg.fillPercent)}%`
          : "";

        zones.push({
          startX,
          endX: rightEdgeX ?? -1,
          topY,
          bottomY,
          midlineY,
          color: displayColor,
          alpha,
          labelText: `FVG T${fvg.tier}${fillPctText}`,
          isInverted: fvg.status === "inverted",
        });
      }
    }

    return zones;
  }

  private _requestUpdate() {
    if (this._chart) {
      this._chart.timeScale().applyOptions({});
    }
  }
}
