/**
 * Alert System — Type Definitions
 *
 * Shared types for the notification/alert system.
 * Used by: Convex CRUD, worker jobs, toast UI, useAlerts hook.
 */

export type AlertType =
  | "bos_confirmed"
  | "fvg_filled"
  | "counter_trend_bos"
  | "key_level_broken"
  | "mtf_divergence"
  | "price_level_crossed"
  | "news_upcoming"
  | "news_occurred"
  | "tp_proximity"
  | "sl_proximity";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertData {
  type: AlertType;
  title: string;
  message: string;
  pair?: string;
  timeframe?: string;
  severity: AlertSeverity;
  metadata?: string;
}

export interface ToastItem {
  id: string;
  type: AlertType;
  title: string;
  message: string;
  pair?: string;
  severity: AlertSeverity;
  createdAt: number;
}

export interface AlertPreferences {
  structureAlerts: boolean;
  priceAlerts: boolean;
  newsAlerts: boolean;
  tradeAlerts: boolean;
  browserNotifications: boolean;
}

export const TOAST_DURATIONS: Record<AlertSeverity, number> = {
  info: 5000,
  warning: 10000,
  critical: 0, // persistent until dismissed
};

/** Map alert type to preference category */
export function getAlertCategory(type: AlertType): keyof AlertPreferences {
  switch (type) {
    case "bos_confirmed":
    case "fvg_filled":
    case "counter_trend_bos":
    case "key_level_broken":
    case "mtf_divergence":
      return "structureAlerts";
    case "price_level_crossed":
      return "priceAlerts";
    case "news_upcoming":
    case "news_occurred":
      return "newsAlerts";
    case "tp_proximity":
    case "sl_proximity":
      return "tradeAlerts";
  }
}

/** Severity colors for UI */
export const SEVERITY_COLORS: Record<AlertSeverity, { border: string; dot: string; text: string }> = {
  info: { border: "border-l-blue-500", dot: "bg-blue-500", text: "text-blue-400" },
  warning: { border: "border-l-amber-500", dot: "bg-amber-500", text: "text-amber-400" },
  critical: { border: "border-l-red-500", dot: "bg-red-500", text: "text-red-400" },
};
