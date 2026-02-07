/**
 * useAlerts Hook
 *
 * Bridges Convex alert queries to the toast store + browser notifications.
 * Tracks which alerts have already been toasted to avoid re-firing on re-render.
 */

"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAlertStore } from "@/lib/alerts/store";
import { getAlertCategory } from "@/lib/alerts/types";
import type { AlertType, AlertSeverity, AlertPreferences } from "@/lib/alerts/types";

export function useAlerts() {
  const { userId } = useAuth();

  const unreadAlerts = useQuery(
    api.alerts.getUnreadAlerts,
    userId ? { userId } : "skip"
  );

  const recentAlerts = useQuery(
    api.alerts.getRecentAlerts,
    userId ? { userId } : "skip"
  );

  const preferences = useQuery(
    api.alerts.getAlertPreferences,
    userId ? { userId } : "skip"
  );

  const markReadMut = useMutation(api.alerts.markRead);
  const markAllReadMut = useMutation(api.alerts.markAllRead);

  // Track which alert IDs we've already toasted
  const toastedRef = useRef<Set<string>>(new Set());

  // Fire toasts + browser notifications for new unread alerts
  useEffect(() => {
    if (!unreadAlerts) return;

    for (const alert of unreadAlerts) {
      if (toastedRef.current.has(alert._id)) continue;
      toastedRef.current.add(alert._id);

      // Check preferences
      const category = getAlertCategory(alert.type as AlertType);
      if (preferences && !preferences[category as keyof typeof preferences]) continue;

      // Add toast
      useAlertStore.getState().addToast({
        type: alert.type as AlertType,
        title: alert.title,
        message: alert.message,
        pair: alert.pair,
        severity: alert.severity as AlertSeverity,
      });

      // Browser notification if enabled and tab is hidden
      if (preferences?.browserNotifications && typeof document !== "undefined" && document.hidden) {
        useAlertStore.getState().sendBrowserNotification({
          title: alert.title,
          message: alert.message,
          pair: alert.pair,
        });
      }
    }
  }, [unreadAlerts, preferences]);

  const unreadCount = unreadAlerts?.length ?? 0;

  const markRead = (id: Id<"alerts">) => markReadMut({ id });
  const markAllRead = () => {
    if (userId) markAllReadMut({ userId });
  };

  return {
    unreadCount,
    unreadAlerts,
    recentAlerts,
    preferences,
    markRead,
    markAllRead,
  };
}
