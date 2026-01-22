import {
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PriceToCoordinateConverter,
} from "lightweight-charts";
import { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from "fancy-canvas";

interface LivePriceData {
  price: number;
  countdown: string;
  isUp: boolean;
}

// Constants for price axis label rendering
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;
const LINE_HEIGHT = 14;
const FONT_SIZE = 11;
const FONT = `${FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

// Price axis pane renderer - draws custom label box on price axis
class PriceAxisLabelRenderer implements IPrimitivePaneRenderer {
  private _data: LivePriceData | null = null;
  private _priceToCoordinate: PriceToCoordinateConverter | null = null;
  private _priceAxisWidth: number = 0;

  update(
    data: LivePriceData | null,
    priceToCoordinate: PriceToCoordinateConverter | null,
    priceAxisWidth: number
  ) {
    this._data = data;
    this._priceToCoordinate = priceToCoordinate;
    this._priceAxisWidth = priceAxisWidth;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || !this._priceToCoordinate) return;

    const y = this._priceToCoordinate(this._data.price);
    if (y === null) return;

    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      const ctx = scope.context;
      const pixelRatio = scope.verticalPixelRatio;

      const priceText = this._data!.price.toFixed(5);
      const countdownText = this._data!.countdown;
      const hasCountdown = countdownText && countdownText.length > 0;
      const bgColor = this._data!.isUp ? "#089981" : "#f23645";

      // Calculate box height
      const boxHeight = hasCountdown
        ? LINE_HEIGHT * 2 + LABEL_PADDING_Y * 2
        : LINE_HEIGHT + LABEL_PADDING_Y * 2;

      // Position: full width of price axis, centered vertically on price
      const scaledY = y * pixelRatio;
      const x = 0;
      const w = this._priceAxisWidth * pixelRatio;
      const h = boxHeight * pixelRatio;
      const boxY = scaledY - (h / 2);

      // Draw rectangle background (full width, no rounded corners on right)
      ctx.save();
      ctx.fillStyle = bgColor;
      ctx.fillRect(x, boxY, w, h);

      // Draw text
      ctx.fillStyle = "white";
      ctx.textBaseline = "middle";

      // Scale for high DPI then draw in logical pixels
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.font = FONT;
      ctx.textAlign = "left";

      const textX = LABEL_PADDING_X;
      const priceY = hasCountdown
        ? (boxY / pixelRatio) + LABEL_PADDING_Y + (LINE_HEIGHT / 2)
        : y;

      ctx.fillText(priceText, textX, priceY);

      // Draw countdown text if present
      if (hasCountdown) {
        const countdownY = priceY + LINE_HEIGHT;
        ctx.fillText(countdownText, textX, countdownY);
      }

      ctx.restore();
      ctx.restore();
    });
  }
}

// Price axis pane view
class PriceAxisLabelView implements IPrimitivePaneView {
  private _renderer = new PriceAxisLabelRenderer();

  update(
    data: LivePriceData | null,
    priceToCoordinate: PriceToCoordinateConverter | null,
    priceAxisWidth: number
  ) {
    this._renderer.update(data, priceToCoordinate, priceAxisWidth);
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

// Main chart pane renderer - draws the horizontal price line
class LivePricePaneRenderer implements IPrimitivePaneRenderer {
  private _data: LivePriceData | null = null;
  private _priceToCoordinate: PriceToCoordinateConverter | null = null;

  update(data: LivePriceData | null, priceToCoordinate: PriceToCoordinateConverter | null) {
    this._data = data;
    this._priceToCoordinate = priceToCoordinate;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || !this._priceToCoordinate) return;

    const y = this._priceToCoordinate(this._data.price);
    if (y === null) return;

    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      const ctx = scope.context;
      const scaledY = y * scope.verticalPixelRatio;
      const width = scope.bitmapSize.width;

      // Draw horizontal price line
      ctx.save();
      ctx.strokeStyle = this._data!.isUp ? "#089981" : "#f23645";
      ctx.lineWidth = scope.verticalPixelRatio;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, scaledY);
      ctx.lineTo(width, scaledY);
      ctx.stroke();
      ctx.restore();
    });
  }
}

// Main chart pane view
class LivePricePaneView implements IPrimitivePaneView {
  private _renderer = new LivePricePaneRenderer();

  update(data: LivePriceData | null, priceToCoordinate: PriceToCoordinateConverter | null) {
    this._renderer.update(data, priceToCoordinate);
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

// Main primitive class
export class LivePricePrimitive implements ISeriesPrimitive<Time> {
  private _paneView = new LivePricePaneView();
  private _priceAxisView = new PriceAxisLabelView();
  private _data: LivePriceData | null = null;
  private _series: SeriesAttachedParameter<Time> | null = null;
  private _requestUpdate?: () => void;

  attached(param: SeriesAttachedParameter<Time>) {
    this._series = param;
    this._requestUpdate = param.requestUpdate;
  }

  detached() {
    this._series = null;
    this._requestUpdate = undefined;
  }

  updateData(price: number, countdown: string, isUp: boolean) {
    this._data = { price, countdown, isUp };
    this._updateViews();
    this._requestUpdate?.();
  }

  clearData() {
    this._data = null;
    this._updateViews();
    this._requestUpdate?.();
  }

  private _updateViews() {
    const priceToCoordinate = this._series?.series.priceToCoordinate.bind(this._series.series) || null;
    this._paneView.update(this._data, priceToCoordinate);

    // Get price axis width from chart
    const priceAxisWidth = this._series?.chart.priceScale("right").width() || 80;
    this._priceAxisView.update(this._data, priceToCoordinate, priceAxisWidth);
  }

  paneViews() {
    return [this._paneView];
  }

  // Use priceAxisPaneViews for custom rendering on price axis
  priceAxisPaneViews() {
    return [this._priceAxisView];
  }
}
