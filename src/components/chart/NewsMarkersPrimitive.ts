import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import {
  CanvasRenderingTarget2D,
  BitmapCoordinatesRenderingScope,
} from "fancy-canvas";

// Currency to flag file mapping (TradingView SVGs in /public/flags/)
const CURRENCY_TO_FLAG: Record<string, string> = {
  USD: "/flags/US.svg",
  GBP: "/flags/GB.svg",
  EUR: "/flags/EU.svg",
  JPY: "/flags/JP.svg",
  AUD: "/flags/AU.svg",
  CAD: "/flags/CA.svg",
  CHF: "/flags/CH.svg", // May not exist - will fallback
  NZD: "/flags/NZ.svg", // May not exist - will fallback
};

// Impact border colors
const IMPACT_BORDER: Record<string, string> = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#6b7280",
};

// Flag image cache
const flagImageCache: Map<string, HTMLImageElement> = new Map();
let flagsLoaded = false;

// Pre-load all flag images (browser only)
function loadFlagImages() {
  // Skip if SSR or already loaded
  if (typeof window === "undefined" || flagsLoaded) return;
  flagsLoaded = true;

  for (const [currency, path] of Object.entries(CURRENCY_TO_FLAG)) {
    const img = new Image();
    img.src = path;
    img.onload = () => {
      flagImageCache.set(currency, img);
    };
    img.onerror = () => {
      // Flag not available - will draw fallback
      console.warn(`Flag not found: ${path}`);
    };
  }
}

// Call on module load (will no-op during SSR)
loadFlagImages();

// Conditional stats for beat/miss/inline scenarios (legacy - kept for backwards compatibility)
interface ConditionalStatsUI {
  sampleSize: number;
  avgSpikePips: number;
  medianSpikePips: number;
  spikeUpPct: number;
  reversalWithin30minPct: number;
  dominantPattern: string;
}

// Individual historical event with its actual reaction (new approach)
export interface HistoricalEventReaction {
  timestamp: number;
  actualValue?: number;
  forecastValue?: number;
  outcome: "beat" | "miss" | "inline";
  spikeMagnitudePips: number;
  spikeDirection: string;
  didReverse: boolean;
  reversalMagnitudePips?: number;

  // Price data for educational display
  priceAtEvent: number;
  spikeHigh: number;
  spikeLow: number;

  // Settlement prices for timeline (optional - older reactions may not have these)
  priceAtPlus5m?: number;
  priceAtPlus15m?: number;
  priceAtPlus30m?: number;
  priceAtPlus1hr?: number;  // Legacy field, same as priceAtPlus60m
  priceAtPlus3hr?: number;  // Legacy field (rarely populated)

  // NEW: T-15 baseline for proper pip calculations
  priceAtMinus15m?: number;

  // NEW: Extended windows (only for high impact/FOMC events)
  priceAtPlus60m?: number;
  priceAtPlus90m?: number;

  // NEW: Pips calculated from T-15 baseline (more accurate)
  pipsFromBaseline?: {
    atEvent: number;
    at5m: number | null;
    at15m: number | null;
    at30m: number | null;
    at60m: number | null;
    at90m: number | null;
  };

  // NEW: Window type (30=standard, 75=high impact, 105=FOMC/ECB)
  windowMinutes?: number;
}

// Grouped historical events by outcome
export interface HistoricalEventHistory {
  hasForecastData: boolean;
  beatHistory: HistoricalEventReaction[];
  missHistory: HistoricalEventReaction[];
  rawHistory: HistoricalEventReaction[];
}

// Lower-is-better events list for frontend classification
const LOWER_IS_BETTER_EVENTS = [
  "UNEMPLOYMENT", "UNEMPLOYMENT_RATE", "JOBLESS_CLAIMS", "INITIAL_CLAIMS",
  "CONTINUING_CLAIMS", "CPI_MOM", "CPI_YOY", "CPI", "CORE_CPI_MOM",
  "CORE_CPI_YOY", "CORE_CPI", "PPI_MOM", "PPI_YOY", "PPI", "CORE_PPI", "CORE_PPI_MOM",
];

// Classify outcome on frontend (mirrors backend logic)
function classifyOutcomeFrontend(
  actual: number,
  forecast: number,
  eventType: string
): "beat" | "miss" | "inline" {
  if (forecast === 0) {
    if (actual === 0) return "inline";
    return actual > 0 ? "beat" : "miss";
  }
  const deviationPct = Math.abs((actual - forecast) / forecast) * 100;
  if (deviationPct <= 5) return "inline";
  const lowerIsBetter = LOWER_IS_BETTER_EVENTS.includes(eventType);
  if (lowerIsBetter) return actual < forecast ? "beat" : "miss";
  return actual > forecast ? "beat" : "miss";
}

export interface NewsEventData {
  eventId: string;
  name: string;
  eventType: string;
  currency: string;
  timestamp: number;
  impact: "high" | "medium" | "low";
  actual?: string;
  forecast?: string;
  previous?: string;
  surpriseZScore?: number;
  // Timezone data
  datetimeUtc?: string;
  datetimeNewYork?: string;
  datetimeLondon?: string;
  tradingSession?: string;
  reaction?: {
    spikeDirection: string;
    spikeMagnitudePips: number;
    patternType: string;
    didReverse: boolean;
  } | null;
  stats?: {
    sampleSize: number;
    avgSpikePips: number;
    medianSpikePips: number;
    spikeUpPct: number;
    reversalWithin30minPct: number;
    // Conditional stats
    hasForecastData: boolean;
    beatStats?: ConditionalStatsUI;
    missStats?: ConditionalStatsUI;
    inlineStats?: ConditionalStatsUI;
  } | null;
}

// Grouped events at same timestamp
interface GroupedMarker {
  timestamp: number;
  events: NewsEventData[];
  primaryCurrency: string;
  highestImpact: string;
}

interface MarkerRenderData {
  x: number;
  events: NewsEventData[];
  primaryCurrency: string;
  highestImpact: string;
  isHovered: boolean;
  groupKey: string;
  historicalData?: HistoricalEventHistory;
}

interface RendererData {
  markers: MarkerRenderData[];
}

// Renderer that draws the flag markers on canvas
class NewsMarkersRenderer implements IPrimitivePaneRenderer {
  private _data: RendererData | null = null;

  update(data: RendererData) {
    this._data = data;
  }

  // Helper to classify event outcome using frontend logic
  private _getEventOutcome(event: NewsEventData): "beat" | "miss" | "inline" {
    if (!event.actual || !event.forecast) return "inline";
    const actual = parseFloat(event.actual.replace(/[%,]/g, ""));
    const forecast = parseFloat(event.forecast.replace(/[%,]/g, ""));
    if (isNaN(actual) || isNaN(forecast)) return "inline";
    return classifyOutcomeFrontend(actual, forecast, event.eventType);
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || this._data.markers.length === 0) return;

    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      const ctx = scope.context;
      const { horizontalPixelRatio, verticalPixelRatio } = scope;

      ctx.save();

      const chartBottom = scope.bitmapSize.height;
      const flagSize = 18 * horizontalPixelRatio; // SVGs are 18x18
      const flagY = chartBottom - 18 * verticalPixelRatio; // Closer to x-axis

      for (const marker of this._data!.markers) {
        const x = marker.x * horizontalPixelRatio;
        const borderColor = IMPACT_BORDER[marker.highestImpact] || IMPACT_BORDER.low;

        // Draw outer border circle (impact indicator)
        const borderRadius = (flagSize / 2) + 3 * horizontalPixelRatio;
        ctx.beginPath();
        ctx.arc(x, flagY, borderRadius, 0, Math.PI * 2);
        ctx.fillStyle = borderColor;
        ctx.fill();

        // Draw white background circle for flag
        ctx.beginPath();
        ctx.arc(x, flagY, flagSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        // Draw flag image (clipped to circle)
        this._drawFlag(ctx, x, flagY, flagSize, marker.primaryCurrency);

        // Draw event count badge if multiple events
        if (marker.events.length > 1) {
          const badgeX = x + flagSize * 0.35;
          const badgeY = flagY - flagSize * 0.35;
          const badgeRadius = 7 * horizontalPixelRatio;

          ctx.beginPath();
          ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
          ctx.fillStyle = "#1f2937";
          ctx.fill();
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1.5 * horizontalPixelRatio;
          ctx.stroke();

          ctx.fillStyle = "#ffffff";
          ctx.font = `bold ${9 * verticalPixelRatio}px -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(marker.events.length), badgeX, badgeY);
        }

        // Draw tooltip if hovered
        if (marker.isHovered) {
          this._drawTooltip(ctx, x, flagY, marker, scope, borderColor);
        }
      }

      ctx.restore();
    });
  }

  private _drawFlag(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    currency: string
  ) {
    const flagImg = flagImageCache.get(currency);

    ctx.save();

    // Clip to circle
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.clip();

    if (flagImg && flagImg.complete && flagImg.naturalWidth > 0) {
      // Draw the SVG flag image
      ctx.drawImage(
        flagImg,
        x - size / 2,
        y - size / 2,
        size,
        size
      );
    } else {
      // Fallback: draw currency text
      ctx.fillStyle = "#374151";
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${size * 0.4}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(currency.substring(0, 2), x, y);
    }

    ctx.restore();
  }

  // Minimal tooltip - just shows event info + "Click for history"
  private _drawTooltip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    marker: MarkerRenderData,
    scope: BitmapCoordinatesRenderingScope,
    borderColor: string
  ) {
    const { horizontalPixelRatio, verticalPixelRatio } = scope;
    const titleFontSize = 13 * verticalPixelRatio;
    const labelFontSize = 10 * verticalPixelRatio;
    const valueFontSize = 11 * verticalPixelRatio;
    const dateFontSize = 10 * verticalPixelRatio;
    const hintFontSize = 9 * verticalPixelRatio;

    const padding = 12 * horizontalPixelRatio;
    const impactBarWidth = 4 * horizontalPixelRatio;
    const rowHeight = 18 * verticalPixelRatio;
    const eventSpacing = 12 * verticalPixelRatio;
    const colWidth = 65 * horizontalPixelRatio;

    // Format date from first event
    const eventDate = new Date(marker.events[0].timestamp);
    const dateStr = eventDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
    const timeStr = eventDate.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isFutureEvent = !marker.events[0].actual;

    // Calculate tooltip dimensions
    ctx.font = `bold ${titleFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    let maxNameWidth = 0;
    for (const event of marker.events) {
      maxNameWidth = Math.max(maxNameWidth, ctx.measureText(event.name).width);
    }

    const hasValues = marker.events.some(e => e.actual || e.forecast || e.previous);
    const tableWidth = hasValues ? colWidth * 3 : 0;
    const contentWidth = Math.max(maxNameWidth + impactBarWidth + padding, tableWidth + impactBarWidth + padding);
    const tooltipWidth = contentWidth + padding * 2;

    // Calculate height - minimal: header + events + result + hint
    const eventHeight = rowHeight + (hasValues ? rowHeight * 2.2 : rowHeight * 0.5);
    const headerHeight = rowHeight * 1.5;
    const resultHeight = !isFutureEvent ? rowHeight * 1.2 : 0;
    const hintHeight = rowHeight * 1.2;
    const tooltipHeight = headerHeight + marker.events.length * eventHeight + (marker.events.length - 1) * eventSpacing + resultHeight + hintHeight + padding * 0.5;

    // Position tooltip above flag
    let tooltipX = x - tooltipWidth / 2;
    const tooltipY = y - 30 * verticalPixelRatio - tooltipHeight;

    // Keep tooltip on screen
    if (tooltipX < 5) tooltipX = 5;
    if (tooltipX + tooltipWidth > scope.bitmapSize.width - 5) {
      tooltipX = scope.bitmapSize.width - tooltipWidth - 5;
    }

    // Draw tooltip background with shadow
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 10 * horizontalPixelRatio;
    ctx.shadowOffsetY = 4 * verticalPixelRatio;
    ctx.fillStyle = "rgba(17, 24, 39, 0.98)";
    ctx.beginPath();
    const radius = 8 * horizontalPixelRatio;
    ctx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, radius);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Draw subtle border
    ctx.strokeStyle = "rgba(75, 85, 99, 0.5)";
    ctx.lineWidth = 1 * horizontalPixelRatio;
    ctx.stroke();

    // Draw header with date/time
    let currentY = tooltipY + padding + dateFontSize;
    ctx.font = `${dateFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "left";
    ctx.fillText(`${dateStr} ${timeStr}`, tooltipX + padding + impactBarWidth + 8 * horizontalPixelRatio, currentY);
    currentY += rowHeight;

    // Draw each event
    for (let i = 0; i < marker.events.length; i++) {
      const event = marker.events[i];
      const impactColor = IMPACT_BORDER[event.impact] || IMPACT_BORDER.low;
      const eventStartY = currentY;

      // Impact color bar on left
      ctx.fillStyle = impactColor;
      ctx.beginPath();
      ctx.roundRect(
        tooltipX + padding,
        eventStartY - labelFontSize * 0.3,
        impactBarWidth,
        hasValues ? rowHeight * 2.5 : rowHeight,
        2 * horizontalPixelRatio
      );
      ctx.fill();

      // Event name
      ctx.font = `600 ${titleFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "left";
      ctx.fillText(
        event.name,
        tooltipX + padding + impactBarWidth + 8 * horizontalPixelRatio,
        currentY
      );
      currentY += rowHeight * 0.9;

      // Values table (Actual | Forecast | Previous)
      if (hasValues) {
        const tableX = tooltipX + padding + impactBarWidth + 8 * horizontalPixelRatio;

        // Labels row
        ctx.font = `${labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = "#6b7280";
        ctx.fillText("Actual", tableX, currentY);
        ctx.fillText("Forecast", tableX + colWidth, currentY);
        ctx.fillText("Previous", tableX + colWidth * 2, currentY);
        currentY += rowHeight * 0.8;

        // Values row
        ctx.font = `600 ${valueFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;

        // Actual - highlight if different from forecast
        if (event.actual) {
          const actualNum = parseFloat(event.actual.replace(/[%,]/g, ""));
          const forecastNum = event.forecast ? parseFloat(event.forecast.replace(/[%,]/g, "")) : null;
          if (forecastNum !== null && !isNaN(actualNum) && !isNaN(forecastNum)) {
            ctx.fillStyle = actualNum > forecastNum ? "#22c55e" : actualNum < forecastNum ? "#ef4444" : "#ffffff";
          } else {
            ctx.fillStyle = "#ffffff";
          }
          ctx.fillText(event.actual, tableX, currentY);
        } else {
          ctx.fillStyle = "#4b5563";
          ctx.fillText("—", tableX, currentY);
        }

        // Forecast
        ctx.fillStyle = event.forecast ? "#ffffff" : "#4b5563";
        ctx.fillText(event.forecast || "—", tableX + colWidth, currentY);

        // Previous
        ctx.fillStyle = event.previous ? "#9ca3af" : "#4b5563";
        ctx.fillText(event.previous || "—", tableX + colWidth * 2, currentY);

        currentY += rowHeight * 0.8;
      }

      // Separator line between events
      if (i < marker.events.length - 1) {
        currentY += eventSpacing * 0.3;
        ctx.strokeStyle = "rgba(75, 85, 99, 0.4)";
        ctx.lineWidth = 1 * horizontalPixelRatio;
        ctx.beginPath();
        ctx.moveTo(tooltipX + padding, currentY);
        ctx.lineTo(tooltipX + tooltipWidth - padding, currentY);
        ctx.stroke();
        currentY += eventSpacing * 0.7;
      }
    }

    // Show result badge for past events
    if (!isFutureEvent) {
      const event = marker.events[0];
      const outcome = this._getEventOutcome(event);
      const statsX = tooltipX + padding + impactBarWidth + 8 * horizontalPixelRatio;

      currentY += eventSpacing * 0.3;
      ctx.font = `600 ${labelFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      if (outcome === "beat") {
        ctx.fillStyle = "#22c55e";
        ctx.fillText("BEAT", statsX, currentY);
      } else if (outcome === "miss") {
        ctx.fillStyle = "#ef4444";
        ctx.fillText("MISS", statsX, currentY);
      } else {
        ctx.fillStyle = "#9ca3af";
        ctx.fillText("INLINE", statsX, currentY);
      }
      currentY += rowHeight * 0.8;
    }

    // "Click for history" hint at bottom
    ctx.font = `${hintFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "center";
    ctx.fillText("Click for history", tooltipX + tooltipWidth / 2, currentY + rowHeight * 0.3);
  }
}

// Pane view that provides the renderer
class NewsMarkersPaneView implements IPrimitivePaneView {
  private _source: NewsMarkersPrimitive;
  private _renderer: NewsMarkersRenderer;

  constructor(source: NewsMarkersPrimitive) {
    this._source = source;
    this._renderer = new NewsMarkersRenderer();
  }

  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }

  renderer(): IPrimitivePaneRenderer {
    const data = this._source.getRendererData();
    this._renderer.update(data);
    return this._renderer;
  }
}

// Main primitive class
export class NewsMarkersPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: NewsMarkersPaneView;
  private _events: NewsEventData[] = [];
  private _groupedMarkers: GroupedMarker[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;
  private _hoveredGroupKey: string | null = null;
  private _clickedGroupKey: string | null = null;
  // Historical events cache (keyed by eventId)
  private _historicalCache: Map<string, HistoricalEventHistory> = new Map();
  // Callback to fetch historical data on hover
  private _onHoverFetch: ((event: NewsEventData) => void) | null = null;

  constructor() {
    this._paneView = new NewsMarkersPaneView(this);
  }

  // Set the historical events cache from Chart.tsx
  setHistoricalCache(cache: Map<string, HistoricalEventHistory>) {
    this._historicalCache = cache;
    this._requestUpdate();
  }

  // Set callback to fetch historical data when hovering
  setOnHoverFetch(callback: (event: NewsEventData) => void) {
    this._onHoverFetch = callback;
  }

  // Get historical data for an event
  getHistoricalData(eventId: string): HistoricalEventHistory | undefined {
    return this._historicalCache.get(eventId);
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

  updateEvents(events: NewsEventData[]) {
    this._events = events;
    this._groupEvents();
    this._requestUpdate();
  }

  setHoveredEvent(eventId: string | null) {
    let groupKey: string | null = null;
    let hoveredEvent: NewsEventData | null = null;

    if (eventId) {
      for (const marker of this._groupedMarkers) {
        const found = marker.events.find(e => e.eventId === eventId);
        if (found) {
          groupKey = String(marker.timestamp);
          hoveredEvent = found;
          break;
        }
      }
    }

    if (this._hoveredGroupKey !== groupKey) {
      this._hoveredGroupKey = groupKey;

      // Trigger fetch for historical data if we have a callback and don't have cached data
      if (hoveredEvent && this._onHoverFetch && !this._historicalCache.has(hoveredEvent.eventId)) {
        this._onHoverFetch(hoveredEvent);
      }

      this._requestUpdate();
    }
  }

  // Toggle clicked state for flag - click to pin tooltip open
  toggleClickedEvent(eventId: string | null) {
    if (!eventId) {
      // Clicked outside - clear clicked state
      if (this._clickedGroupKey !== null) {
        this._clickedGroupKey = null;
        this._requestUpdate();
      }
      return;
    }

    let groupKey: string | null = null;
    for (const marker of this._groupedMarkers) {
      if (marker.events.some(e => e.eventId === eventId)) {
        groupKey = String(marker.timestamp);
        break;
      }
    }

    if (groupKey === this._clickedGroupKey) {
      // Clicking same flag - toggle off
      this._clickedGroupKey = null;
    } else {
      // Clicking different flag - select it
      this._clickedGroupKey = groupKey;
    }
    this._requestUpdate();
  }

  clearClickedEvent() {
    if (this._clickedGroupKey !== null) {
      this._clickedGroupKey = null;
      this._requestUpdate();
    }
  }

  getEventAtCoordinate(x: number): NewsEventData | null {
    if (!this._chart) return null;

    const timeScale = this._chart.timeScale();
    const tolerance = 15;

    for (const marker of this._groupedMarkers) {
      const markerX = timeScale.timeToCoordinate((marker.timestamp / 1000) as Time);
      if (markerX !== null && Math.abs(markerX - x) < tolerance) {
        return marker.events[0];
      }
    }
    return null;
  }

  getAllEventsAtCoordinate(x: number): NewsEventData[] {
    if (!this._chart) return [];

    const timeScale = this._chart.timeScale();
    const tolerance = 15;

    for (const marker of this._groupedMarkers) {
      const markerX = timeScale.timeToCoordinate((marker.timestamp / 1000) as Time);
      if (markerX !== null && Math.abs(markerX - x) < tolerance) {
        return marker.events;
      }
    }
    return [];
  }

  // Group events by timestamp (within 5 minutes)
  private _groupEvents() {
    const groups = new Map<number, NewsEventData[]>();
    const TIME_TOLERANCE = 5 * 60 * 1000;

    for (const event of this._events) {
      let foundGroup = false;
      for (const [ts, events] of groups) {
        if (Math.abs(event.timestamp - ts) < TIME_TOLERANCE) {
          events.push(event);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        groups.set(event.timestamp, [event]);
      }
    }

    this._groupedMarkers = [];
    for (const [timestamp, events] of groups) {
      const currencies = [...new Set(events.map(e => e.currency))];
      const primaryCurrency = currencies[0];

      const impacts = events.map(e => e.impact);
      const highestImpact = impacts.includes("high") ? "high" : impacts.includes("medium") ? "medium" : "low";

      this._groupedMarkers.push({
        timestamp,
        events,
        primaryCurrency,
        highestImpact,
      });
    }

    this._groupedMarkers.sort((a, b) => a.timestamp - b.timestamp);
  }

  getRendererData(): RendererData {
    if (!this._chart || !this._series) {
      return { markers: [] };
    }

    const timeScale = this._chart.timeScale();
    const markers: MarkerRenderData[] = [];

    for (const group of this._groupedMarkers) {
      const x = timeScale.timeToCoordinate((group.timestamp / 1000) as Time);
      if (x === null) continue;

      const groupKey = String(group.timestamp);
      // Show tooltip only on click (not hover)
      const isActive = groupKey === this._clickedGroupKey;

      // Get historical data for the first event in the group
      const firstEventId = group.events[0]?.eventId;
      const historicalData = firstEventId ? this._historicalCache.get(firstEventId) : undefined;

      markers.push({
        x,
        events: group.events,
        primaryCurrency: group.primaryCurrency,
        highestImpact: group.highestImpact,
        isHovered: isActive,
        groupKey,
        historicalData,
      });
    }

    return { markers };
  }

  private _requestUpdate() {
    if (this._chart) {
      this._chart.timeScale().applyOptions({});
    }
  }

  paneViews() {
    return [this._paneView];
  }

  hitTest(): PrimitiveHoveredItem | null {
    return null;
  }
}
