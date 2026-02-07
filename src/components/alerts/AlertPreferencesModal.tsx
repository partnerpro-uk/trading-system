"use client";

import { X } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAlertStore } from "@/lib/alerts/store";
import type { AlertPreferences } from "@/lib/alerts/types";

interface AlertPreferencesModalProps {
  open: boolean;
  onClose: () => void;
  preferences: AlertPreferences | null | undefined;
}

const PREF_ITEMS: { key: keyof AlertPreferences; label: string; description: string }[] = [
  {
    key: "structureAlerts",
    label: "Structure Alerts",
    description: "BOS confirmed, FVG filled, counter-trend, key level broken, MTF divergence",
  },
  {
    key: "priceAlerts",
    label: "Price Alerts",
    description: "Horizontal line crossings and custom price levels",
  },
  {
    key: "newsAlerts",
    label: "News Alerts",
    description: "Upcoming high-impact events and news proximity warnings",
  },
  {
    key: "tradeAlerts",
    label: "Trade Alerts",
    description: "TP/SL proximity warnings for open positions",
  },
  {
    key: "browserNotifications",
    label: "Browser Notifications",
    description: "Show system notifications when the tab is in the background",
  },
];

export function AlertPreferencesModal({ open, onClose, preferences }: AlertPreferencesModalProps) {
  const updatePrefs = useMutation(api.alerts.updateAlertPreferences);
  const { permissionGranted, requestPermission } = useAlertStore();

  if (!open) return null;

  const handleToggle = async (key: keyof AlertPreferences) => {
    const current = preferences?.[key] ?? (key === "browserNotifications" ? false : true);

    // If enabling browser notifications, request permission first
    if (key === "browserNotifications" && !current && !permissionGranted) {
      await requestPermission();
    }

    await updatePrefs({ [key]: !current });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-medium text-gray-200">Alert Preferences</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toggles */}
        <div className="px-5 py-4 space-y-4">
          {PREF_ITEMS.map(({ key, label, description }) => {
            const enabled = preferences?.[key] ?? (key === "browserNotifications" ? false : true);
            const isBrowser = key === "browserNotifications";

            return (
              <div key={key} className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm text-gray-200">{label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{description}</div>
                  {isBrowser && !permissionGranted && (
                    <button
                      onClick={requestPermission}
                      className="text-xs text-blue-400 hover:text-blue-300 mt-1 transition-colors"
                    >
                      Grant browser permission
                    </button>
                  )}
                </div>
                <button
                  onClick={() => handleToggle(key)}
                  className={`relative shrink-0 w-10 h-5.5 rounded-full transition-colors ${
                    enabled ? "bg-blue-600" : "bg-gray-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white transition-transform shadow-sm ${
                      enabled ? "translate-x-[18px]" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
