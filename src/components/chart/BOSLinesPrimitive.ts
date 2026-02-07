/**
 * BOSLinesPrimitive — Renders dashed horizontal lines for Break of Structure events.
 *
 * Lines extend from the broken swing timestamp to the confirming candle.
 * Green = bullish, red = bearish. BOS = continuation, MSS = reversal.
 * Active = full opacity, reclaimed = faded.
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

export interface BOSLineData {
  brokenLevel: number;
  brokenSwingTimestamp: number; // unix ms
  direction: "bullish" | "bearish";
  status: "active" | "reclaimed";
  confirmingTimestamp: number; // unix ms
  magnitudePips: number;
  reclaimedAt?: number; // unix ms — when the BOS was reclaimed
  bosType: "bos" | "mss"; // bos = continuation, mss = market structure shift
  timeframe?: string; // for label display
}

interface RendererLine {
  startX: number;
  y: number;
  endX: number;
  color: string;
  alpha: number;
  labelText: string;
}

interface RendererData {
  lines: RendererLine[];
}

class BOSLinesRenderer implements IPrimitivePaneRenderer {
  private _data: RendererData | null = null;

  update(data: RendererData) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || this._data.lines.length === 0) return;

    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const ctx = scope.context;
        const { horizontalPixelRatio, verticalPixelRatio } = scope;

        ctx.save();

        for (const line of this._data!.lines) {
          if (
            line.y < 0 ||
            line.y > scope.bitmapSize.height / verticalPixelRatio
          )
            continue;

          const sx = line.startX * horizontalPixelRatio;
          const ex = line.endX * horizontalPixelRatio;
          const y = line.y * verticalPixelRatio;

          // Draw dashed line
          ctx.globalAlpha = line.alpha;
          ctx.strokeStyle = line.color;
          ctx.lineWidth = 1 * verticalPixelRatio;
          ctx.setLineDash([
            6 * horizontalPixelRatio,
            4 * horizontalPixelRatio,
          ]);

          ctx.beginPath();
          ctx.moveTo(sx, y);
          ctx.lineTo(ex, y);
          ctx.stroke();

          // Draw label at midpoint of line
          const midX = (sx + ex) / 2;
          const fontSize = Math.round(8 * verticalPixelRatio);
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = line.color;
          ctx.textAlign = "center";
          ctx.setLineDash([]);
          ctx.globalAlpha = Math.min(line.alpha + 0.2, 1);

          // Background for label
          const metrics = ctx.measureText(line.labelText);
          const padX = 3 * horizontalPixelRatio;
          const padY = 2 * verticalPixelRatio;
          ctx.fillStyle = "rgba(10, 10, 10, 0.8)";
          ctx.fillRect(
            midX - metrics.width / 2 - padX,
            y - fontSize - padY,
            metrics.width + padX * 2,
            fontSize + padY * 2
          );

          // Label text
          ctx.fillStyle = line.color;
          ctx.fillText(line.labelText, midX, y - padY);

          ctx.globalAlpha = 1;
        }

        ctx.restore();
      }
    );
  }
}

class BOSLinesPaneView implements IPrimitivePaneView {
  private _source: BOSLinesPrimitive;
  private _renderer: BOSLinesRenderer;

  constructor(source: BOSLinesPrimitive) {
    this._source = source;
    this._renderer = new BOSLinesRenderer();
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer {
    const lines = this._source.getLines();
    this._renderer.update({ lines });
    return this._renderer;
  }
}

export class BOSLinesPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: BOSLinesPaneView;
  private _bosEvents: BOSLineData[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;

  constructor() {
    this._paneView = new BOSLinesPaneView(this);
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

  updateBOSEvents(events: BOSLineData[]) {
    this._bosEvents = events;
    this._requestUpdate();
  }

  getLines(): RendererLine[] {
    if (!this._chart || !this._series) return [];

    const timeScale = this._chart.timeScale();
    const lines: RendererLine[] = [];

    for (const bos of this._bosEvents) {
      const startTime = (bos.brokenSwingTimestamp / 1000) as Time;
      const startX = timeScale.timeToCoordinate(startTime);
      const confirmX = timeScale.timeToCoordinate(
        (bos.confirmingTimestamp / 1000) as Time
      );
      const y = this._series.priceToCoordinate(bos.brokenLevel);

      // Only render when both endpoints and price level are resolvable
      if (startX !== null && confirmX !== null && y !== null) {
        const typeLabel = bos.bosType === "mss" ? "MSS" : "BOS";
        const tfSuffix = bos.timeframe ? `\n${bos.timeframe}` : "";

        lines.push({
          startX,
          y,
          endX: confirmX,
          color: bos.direction === "bullish" ? "#22c55e" : "#ef4444",
          alpha: bos.status === "active" ? 0.7 : 0.25,
          labelText: `${typeLabel}${tfSuffix}`,
        });
      }
    }

    return lines;
  }

  private _requestUpdate() {
    if (this._chart) {
      this._chart.timeScale().applyOptions({});
    }
  }
}
