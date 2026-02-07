/**
 * PremiumDiscountPrimitive — Renders premium/discount background shading.
 *
 * Premium half: faint red, Discount half: faint green.
 * Dashed gray equilibrium line at midpoint.
 * Labels at right edge.
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

export interface PDZoneData {
  equilibrium: number;
  swingHigh: number;
  swingLow: number;
}

interface RendererPDZone {
  equilibriumY: number;
  highY: number;
  lowY: number;
  chartWidth: number;
}

interface RendererData {
  zone: RendererPDZone | null;
}

class PremiumDiscountRenderer implements IPrimitivePaneRenderer {
  private _data: RendererData | null = null;

  update(data: RendererData) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || !this._data.zone) return;

    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const ctx = scope.context;
        const { horizontalPixelRatio, verticalPixelRatio } = scope;
        const chartWidth = scope.bitmapSize.width;

        const zone = this._data!.zone!;
        const eqY = zone.equilibriumY * verticalPixelRatio;
        const highY = zone.highY * verticalPixelRatio;
        const lowY = zone.lowY * verticalPixelRatio;

        ctx.save();

        // Premium half (above equilibrium): faint red
        ctx.globalAlpha = 0.03;
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(0, highY, chartWidth, eqY - highY);

        // Discount half (below equilibrium): faint green
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(0, eqY, chartWidth, lowY - eqY);

        // Equilibrium line: dashed gray
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = "#9ca3af";
        ctx.lineWidth = 1 * verticalPixelRatio;
        ctx.setLineDash([6 * horizontalPixelRatio, 4 * horizontalPixelRatio]);
        ctx.beginPath();
        ctx.moveTo(0, eqY);
        ctx.lineTo(chartWidth, eqY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels at right edge
        const fontSize = Math.round(8 * verticalPixelRatio);
        ctx.font = `${fontSize}px monospace`;
        ctx.textAlign = "right";
        const rightX = chartWidth - 8 * horizontalPixelRatio;

        // "PREMIUM" label
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = "#ef4444";
        const premY = highY + (eqY - highY) / 2 + fontSize / 2;
        ctx.fillText("PREMIUM", rightX, premY);

        // "DISCOUNT" label
        ctx.fillStyle = "#22c55e";
        const discY = eqY + (lowY - eqY) / 2 + fontSize / 2;
        ctx.fillText("DISCOUNT", rightX, discY);

        // "EQ" label at equilibrium
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = "#9ca3af";
        ctx.fillText("EQ", rightX, eqY - 3 * verticalPixelRatio);

        ctx.restore();
      }
    );
  }
}

class PremiumDiscountPaneView implements IPrimitivePaneView {
  private _source: PremiumDiscountPrimitive;
  private _renderer: PremiumDiscountRenderer;

  constructor(source: PremiumDiscountPrimitive) {
    this._source = source;
    this._renderer = new PremiumDiscountRenderer();
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer {
    const zone = this._source.getZone();
    this._renderer.update({ zone });
    return this._renderer;
  }
}

export class PremiumDiscountPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: PremiumDiscountPaneView;
  private _zoneData: PDZoneData | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;

  constructor() {
    this._paneView = new PremiumDiscountPaneView(this);
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

  updateZone(data: PDZoneData | null) {
    this._zoneData = data;
    this._requestUpdate();
  }

  getZone(): RendererPDZone | null {
    if (!this._chart || !this._series || !this._zoneData) return null;

    const eqY = this._series.priceToCoordinate(this._zoneData.equilibrium);
    const highY = this._series.priceToCoordinate(this._zoneData.swingHigh);
    const lowY = this._series.priceToCoordinate(this._zoneData.swingLow);

    if (eqY === null || highY === null || lowY === null) return null;

    return {
      equilibriumY: eqY,
      highY,
      lowY,
      chartWidth: 0, // set by renderer from scope
    };
  }

  private _requestUpdate() {
    if (this._chart) {
      this._chart.timeScale().applyOptions({});
    }
  }
}
