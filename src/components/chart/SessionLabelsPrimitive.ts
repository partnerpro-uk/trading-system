import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitiveHoveredItem,
  PrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import { CanvasRenderingTarget2D, BitmapCoordinatesRenderingScope } from "fancy-canvas";

// Session colors
const SESSION_COLORS = {
  ASIA: { high: "#fbbf24", low: "#fbbf24" },
  LONDON: { high: "#ef4444", low: "#ef4444" },
  NY: { high: "#3b82f6", low: "#3b82f6" },
} as const;

// Short session names
const SESSION_SHORT_NAMES: Record<string, string> = {
  ASIA: "ASIA",
  LONDON: "LDN",
  NY: "NY",
};

// Price tolerance for combining labels (0.5 pips)
const PRICE_TOLERANCE = 0.00005;

// Maximum days to show labels for (to avoid clutter when zoomed out)
const MAX_LABEL_DAYS = 7;

// Highlight key format: "date:session:high|low" e.g. "2026-01-17:LONDON:high"
export type HighlightKey = string;

export interface SessionData {
  session: string;
  date: string;
  high: number;
  low: number;
  endTime: number;
}

interface LabelData {
  text: string;
  price: number;
  time: number;
  color: string;
  isHigh: boolean;
  highlightKey: string; // For matching against highlights
}

interface RendererData {
  labels: Array<{
    x: number;
    y: number;
    text: string;
    color: string;
    isHigh: boolean;
    highlighted: boolean;
    glowIntensity: number; // 0-1 for breathing animation
  }>;
}

// Renderer that draws the labels on canvas
class SessionLabelsRenderer implements IPrimitivePaneRenderer {
  private _data: RendererData | null = null;

  update(data: RendererData) {
    this._data = data;
  }

  draw(target: CanvasRenderingTarget2D) {
    if (!this._data || this._data.labels.length === 0) return;

    target.useBitmapCoordinateSpace((scope: BitmapCoordinatesRenderingScope) => {
      const ctx = scope.context;
      const { horizontalPixelRatio, verticalPixelRatio } = scope;

      ctx.save();
      ctx.font = `${Math.round(10 * verticalPixelRatio)}px monospace`;
      ctx.textAlign = "right";

      for (const label of this._data!.labels) {
        // Skip if out of bounds
        if (label.y < 0 || label.y > scope.bitmapSize.height / verticalPixelRatio) continue;

        // Position: high labels above, low labels below
        const yOffset = label.isHigh ? -6 : 12;
        const x = label.x * horizontalPixelRatio;
        const y = (label.y + yOffset) * verticalPixelRatio;

        // Apply glow effect for highlighted labels
        if (label.highlighted) {
          // Breathing glow - intensity varies from 0.3 to 1.0
          const baseBlur = 15 * verticalPixelRatio;
          const glowBlur = baseBlur * (0.5 + label.glowIntensity * 0.5);

          ctx.shadowColor = label.color;
          ctx.shadowBlur = glowBlur;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;

          // Draw multiple times for stronger glow
          ctx.fillStyle = label.color;
          ctx.fillText(label.text, x - 4 * horizontalPixelRatio, y);
          ctx.fillText(label.text, x - 4 * horizontalPixelRatio, y);

          // Reset shadow for crisp text on top
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#ffffff"; // White text on top of glow
          ctx.fillText(label.text, x - 4 * horizontalPixelRatio, y);
        } else {
          ctx.fillStyle = label.color;
          ctx.fillText(label.text, x - 4 * horizontalPixelRatio, y);
        }
      }

      ctx.restore();
    });
  }
}

// Pane view that provides the renderer
class SessionLabelsPaneView implements IPrimitivePaneView {
  private _source: SessionLabelsPrimitive;
  private _renderer: SessionLabelsRenderer;

  constructor(source: SessionLabelsPrimitive) {
    this._source = source;
    this._renderer = new SessionLabelsRenderer();
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

// Main primitive class
export class SessionLabelsPrimitive implements ISeriesPrimitive<Time> {
  private _paneView: SessionLabelsPaneView;
  private _sessions: SessionData[] = [];
  private _labelData: LabelData[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _series: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chart: any = null;

  // Highlight state
  private _highlightedKeys: Set<HighlightKey> = new Set();
  private _glowIntensity: number = 0;
  private _glowDirection: number = 1; // 1 = increasing, -1 = decreasing
  private _animationFrame: number | null = null;
  private _isAnimating: boolean = false;

  constructor() {
    this._paneView = new SessionLabelsPaneView(this);
  }

  // Called by Lightweight Charts when attached to a series
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attached({ chart, series }: { chart: any; series: any }) {
    this._chart = chart;
    this._series = series;
  }

  detached() {
    this._stopAnimation();
    this._chart = null;
    this._series = null;
  }

  // Animation loop for breathing glow effect
  private _startAnimation() {
    if (this._isAnimating) return;
    this._isAnimating = true;

    const animate = () => {
      if (!this._isAnimating) return;

      // Update glow intensity (breathing effect: 0 to 1 and back)
      this._glowIntensity += this._glowDirection * 0.03;

      if (this._glowIntensity >= 1) {
        this._glowIntensity = 1;
        this._glowDirection = -1;
      } else if (this._glowIntensity <= 0) {
        this._glowIntensity = 0;
        this._glowDirection = 1;
      }

      this._requestUpdate();
      this._animationFrame = requestAnimationFrame(animate);
    };

    this._animationFrame = requestAnimationFrame(animate);
  }

  private _stopAnimation() {
    this._isAnimating = false;
    if (this._animationFrame !== null) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
  }

  // Highlight a specific session level
  // key format: "date:session:high" or "date:session:low"
  // e.g., "2026-01-17:LONDON:high"
  highlightSession(date: string, session: string, level: "high" | "low") {
    const key = `${date}:${session}:${level}`;
    this._highlightedKeys.add(key);
    this._startAnimation();
    this._requestUpdate();
  }

  // Highlight both high and low for a session
  highlightSessionBoth(date: string, session: string) {
    this.highlightSession(date, session, "high");
    this.highlightSession(date, session, "low");
  }

  // Remove highlight from a specific session level
  unhighlightSession(date: string, session: string, level: "high" | "low") {
    const key = `${date}:${session}:${level}`;
    this._highlightedKeys.delete(key);

    if (this._highlightedKeys.size === 0) {
      this._stopAnimation();
    }
    this._requestUpdate();
  }

  // Clear all highlights
  clearHighlights() {
    this._highlightedKeys.clear();
    this._stopAnimation();
    this._glowIntensity = 0;
    this._requestUpdate();
  }

  // Get currently highlighted keys (for debugging or UI)
  getHighlightedKeys(): string[] {
    return Array.from(this._highlightedKeys);
  }

  // Update session data
  updateSessions(sessions: SessionData[]) {
    this._sessions = sessions;
    this._processLabels();
    this._requestUpdate();
  }

  // Process sessions into label data with combining logic
  private _processLabels() {
    // Calculate cutoff date (7 days ago)
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - MAX_LABEL_DAYS);
    const cutoffDateStr = cutoffDate.toISOString().split("T")[0];

    const rawLabels: Array<{
      sessionNames: string[];
      sessions: string[]; // Full session names for highlight keys
      price: number;
      time: number;
      color: string;
      isHigh: boolean;
      date: string;
    }> = [];

    for (const session of this._sessions) {
      // Skip sessions older than cutoff (labels only for last 7 days)
      if (session.date < cutoffDateStr) continue;
      const sessionType = session.session as keyof typeof SESSION_COLORS;
      const colors = SESSION_COLORS[sessionType];
      if (!colors) continue;

      const shortName = SESSION_SHORT_NAMES[sessionType] || sessionType;

      // High label
      rawLabels.push({
        sessionNames: [shortName],
        sessions: [session.session],
        price: session.high,
        time: session.endTime / 1000,
        color: colors.high,
        isHigh: true,
        date: session.date,
      });

      // Low label
      rawLabels.push({
        sessionNames: [shortName],
        sessions: [session.session],
        price: session.low,
        time: session.endTime / 1000,
        color: colors.low,
        isHigh: false,
        date: session.date,
      });
    }

    // Group labels at same price level
    const groupedLabels: typeof rawLabels = [];

    for (const label of rawLabels) {
      const existing = groupedLabels.find(
        (g) =>
          g.date === label.date &&
          g.isHigh === label.isHigh &&
          Math.abs(g.price - label.price) < PRICE_TOLERANCE
      );

      if (existing) {
        existing.sessionNames.push(...label.sessionNames);
        existing.sessions.push(...label.sessions);
        existing.time = Math.max(existing.time, label.time);
      } else {
        groupedLabels.push({ ...label });
      }
    }

    // Convert to final format with highlight keys
    this._labelData = groupedLabels.map((g) => ({
      text: `${g.sessionNames.join("/")} ${g.isHigh ? "H" : "L"} ${g.price.toFixed(5)}`,
      price: g.price,
      time: g.time,
      color: g.color,
      isHigh: g.isHigh,
      // Create highlight key from all sessions in this grouped label
      highlightKey: g.sessions.map(s => `${g.date}:${s}:${g.isHigh ? "high" : "low"}`).join(","),
    }));
  }

  // Get labels with calculated x/y positions for renderer
  getLabels(): RendererData["labels"] {
    if (!this._chart || !this._series) return [];

    const timeScale = this._chart.timeScale();
    const labels: RendererData["labels"] = [];

    for (const label of this._labelData) {
      const x = timeScale.timeToCoordinate(label.time as Time);
      const y = this._series.priceToCoordinate(label.price);

      if (x !== null && y !== null) {
        // Check if this label should be highlighted
        // The highlightKey may contain multiple keys separated by comma (for grouped labels)
        const labelKeys = label.highlightKey.split(",");
        const isHighlighted = labelKeys.some(key => this._highlightedKeys.has(key));

        labels.push({
          x,
          y,
          text: label.text,
          color: label.color,
          isHigh: label.isHigh,
          highlighted: isHighlighted,
          glowIntensity: this._glowIntensity,
        });
      }
    }

    return labels;
  }

  // Request chart to redraw
  private _requestUpdate() {
    if (this._chart) {
      // Force a redraw by slightly nudging the time scale
      this._chart.timeScale().applyOptions({});
    }
  }

  // Return pane views for rendering
  paneViews() {
    return [this._paneView];
  }

  // Optional: handle hover (not needed for labels)
  hitTest(): PrimitiveHoveredItem | null {
    return null;
  }
}
