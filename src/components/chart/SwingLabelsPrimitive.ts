/**
 * SwingLabelsPrimitive — Renders HH/HL/LH/LL/EQH/EQL labels at swing points.
 *
 * Follows the SessionLabelsPrimitive pattern (ISeriesPrimitive attached to series).
 * Colors: HH/HL = green, LH/LL = red, EQH/EQL = yellow.
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

export interface SwingLabelData {
  timestamp: number; // unix ms
  price: number;
  label: string; // "HH", "HL", "LH", "LL", "EQH", "EQL"
  type: "high" | "low";
}

const LABEL_COLORS: Record<string, string> = {
  HH: "#22c55e", // green
  HL: "#22c55e",
  LH: "#ef4444", // red
  LL: "#ef4444",
  EQH: "#eab308", // yellow
  EQL: "#eab308",
};

const LABEL_BG_COLORS: Record<string, string> = {
  HH: "rgba(34, 197, 94, 0.15)",
  HL: "rgba(34, 197, 94, 0.15)",
  LH: "rgba(239, 68, 68, 0.15)",
  LL: "rgba(239, 68, 68, 0.15)",
  EQH: "rgba(234, 179, 8, 0.15)",
  EQL: "rgba(234, 179, 8, 0.15)",
};

interface RendererLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  bgColor: string;
  isHigh: boolean;
}

interface RendererData {
  labels: RendererLabel[];
}

class SwingLabelsRenderer implements IPrimitivePaneRenderer {
  private _data: RendererData | null = null;

  update(data: RendererData) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || this._data.labels.length === 0) return;

    target.useBitmapCoordinateSpace(
      (scope: BitmapCoordinatesRenderingScope) => {
        const ctx = scope.context;
        const { horizontalPixelRatio, verticalPixelRatio } = scope;

        ctx.save();
        const fontSize = Math.round(9 * verticalPixelRatio);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = "center";

        for (const label of this._data!.labels) {
          if (
            label.y < 0 ||
            label.y > scope.bitmapSize.height / verticalPixelRatio
          )
            continue;

          // Position: highs above candle, lows below candle
          const yOffset = label.isHigh
            ? -10 * verticalPixelRatio
            : 14 * verticalPixelRatio;
          const x = label.x * horizontalPixelRatio;
          const y = label.y * verticalPixelRatio + yOffset;

          // Measure text for background
          const metrics = ctx.measureText(label.text);
          const textWidth = metrics.width;
          const textHeight = fontSize;
          const padX = 3 * horizontalPixelRatio;
          const padY = 2 * verticalPixelRatio;

          // Draw background pill
          ctx.fillStyle = label.bgColor;
          const bgX = x - textWidth / 2 - padX;
          const bgY = y - textHeight + padY;
          const bgW = textWidth + padX * 2;
          const bgH = textHeight + padY;

          ctx.beginPath();
          const radius = 3 * verticalPixelRatio;
          ctx.roundRect(bgX, bgY, bgW, bgH, radius);
          ctx.fill();

          // Draw text
          ctx.fillStyle = label.color;
          ctx.fillText(label.text, x, y);
        }

        ctx.restore();
      }
    );
  }
}

class SwingLabelsPaneView implements IPrimitivePaneView {
  private _source: SwingLabelsPrimitive;
  private _renderer: SwingLabelsRenderer;

  constructor(source: SwingLabelsPrimitive) {
    this._source = source;
    this._renderer = new SwingLabelsRenderer();
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }

  renderer(): IPrimitivePaneRenderer {
    const labels = this._source.getLabels();
    this._renderer.update({ labels });
    return this._renderer;
  }
}

export class SwingLabelsPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: SwingLabelsPaneView;
  private _swings: SwingLabelData[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;

  constructor() {
    this._paneView = new SwingLabelsPaneView(this);
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

  updateSwings(swings: SwingLabelData[]) {
    this._swings = swings;
    this._requestUpdate();
  }

  getLabels(): RendererLabel[] {
    if (!this._chart || !this._series) return [];

    const timeScale = this._chart.timeScale();
    const labels: RendererLabel[] = [];

    for (const swing of this._swings) {
      const time = (swing.timestamp / 1000) as Time;
      const x = timeScale.timeToCoordinate(time);
      const y = this._series.priceToCoordinate(swing.price);

      if (x !== null && y !== null) {
        labels.push({
          x,
          y,
          text: swing.label,
          color: LABEL_COLORS[swing.label] || "#9ca3af",
          bgColor: LABEL_BG_COLORS[swing.label] || "rgba(156, 163, 175, 0.15)",
          isHigh: swing.type === "high",
        });
      }
    }

    return labels;
  }

  private _requestUpdate() {
    if (this._chart) {
      this._chart.timeScale().applyOptions({});
    }
  }
}
