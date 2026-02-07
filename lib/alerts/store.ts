/**
 * Alert Store
 *
 * Zustand store for toast queue management and browser notification dispatch.
 */

import { create } from "zustand";
import type { ToastItem, AlertSeverity } from "./types";
import { TOAST_DURATIONS } from "./types";

let toastIdCounter = 0;
function generateToastId(): string {
  return `toast_${Date.now()}_${++toastIdCounter}`;
}

interface AlertStoreState {
  toasts: ToastItem[];
  permissionGranted: boolean;
}

interface AlertStoreActions {
  addToast: (item: Omit<ToastItem, "id" | "createdAt">) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
  requestPermission: () => Promise<void>;
  sendBrowserNotification: (item: { title: string; message: string; pair?: string }) => void;
}

const MAX_TOASTS = 5;

export const useAlertStore = create<AlertStoreState & AlertStoreActions>((set, get) => ({
  toasts: [],
  permissionGranted:
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission === "granted"
      : false,

  addToast: (item) => {
    const id = generateToastId();
    const toast: ToastItem = { ...item, id, createdAt: Date.now() };

    set((state) => {
      const next = [toast, ...state.toasts];
      // Trim to max
      if (next.length > MAX_TOASTS) next.length = MAX_TOASTS;
      return { toasts: next };
    });

    // Auto-dismiss based on severity
    const duration = TOAST_DURATIONS[item.severity as AlertSeverity];
    if (duration > 0) {
      setTimeout(() => {
        get().dismissToast(id);
      }, duration);
    }
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearToasts: () => {
    set({ toasts: [] });
  },

  requestPermission: async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;

    try {
      const result = await Notification.requestPermission();
      set({ permissionGranted: result === "granted" });
    } catch {
      // Permission denied or error
    }
  },

  sendBrowserNotification: (item) => {
    if (!get().permissionGranted) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    try {
      const title = item.pair
        ? `${item.pair.replace("_", "/")} — ${item.title}`
        : item.title;

      new Notification(title, {
        body: item.message,
        icon: "/favicon.ico",
        tag: `alert-${Date.now()}`,
      });
    } catch {
      // Browser notification failed
    }
  },
}));
