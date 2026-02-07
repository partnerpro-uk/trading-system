"use client";

import { useAlerts } from "@/hooks/useAlerts";
import { SEVERITY_COLORS } from "@/lib/alerts/types";
import type { AlertSeverity } from "@/lib/alerts/types";
import { CheckCheck } from "lucide-react";

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function RecentAlertsWidget() {
  const { recentAlerts, unreadCount, markAllRead } = useAlerts();

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Recent Alerts</h3>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            <CheckCheck size={12} />
            Mark all read
          </button>
        )}
      </div>

      {!recentAlerts || recentAlerts.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-4">No alerts yet</div>
      ) : (
        <div className="space-y-1.5">
          {recentAlerts.slice(0, 5).map((alert) => {
            const colors = SEVERITY_COLORS[alert.severity as AlertSeverity] ?? SEVERITY_COLORS.info;
            return (
              <div
                key={alert._id}
                className={`px-3 py-2 rounded text-xs ${
                  !alert.read ? "bg-gray-800/40" : "bg-gray-800/20"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0`} />
                  <span className={`flex-1 truncate ${alert.read ? "text-gray-500" : "text-gray-300"}`}>
                    {alert.title}
                  </span>
                  {alert.pair && (
                    <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1 py-0.5 rounded shrink-0">
                      {alert.pair.replace("_", "/")}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5 pl-3.5">
                  <span className="text-gray-600 truncate">{alert.message}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(alert.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
