"use client";

import { useState, useRef, useEffect } from "react";
import { Bell, Settings, CheckCheck, X } from "lucide-react";
import type { AlertSeverity, AlertType } from "@/lib/alerts/types";
import { SEVERITY_COLORS } from "@/lib/alerts/types";
import type { Id } from "../../../convex/_generated/dataModel";

interface AlertItem {
  _id: Id<"alerts">;
  type: string;
  title: string;
  message: string;
  pair?: string;
  severity: string;
  read: boolean;
  createdAt: number;
}

interface AlertBellProps {
  unreadCount: number;
  recentAlerts?: AlertItem[] | null;
  onMarkRead: (id: Id<"alerts">) => void;
  onMarkAllRead: () => void;
  onOpenPreferences: () => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function AlertBell({
  unreadCount,
  recentAlerts,
  onMarkRead,
  onMarkAllRead,
  onOpenPreferences,
}: AlertBellProps) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        title="Alerts"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] bg-gray-900 border border-gray-800 rounded-xl shadow-xl shadow-black/40 overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-medium text-gray-200">Alerts</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={() => {
                    onMarkAllRead();
                  }}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-800 transition-colors flex items-center gap-1"
                >
                  <CheckCheck size={12} />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => {
                  onOpenPreferences();
                  setOpen(false);
                }}
                className="p-1.5 text-gray-500 hover:text-gray-300 rounded hover:bg-gray-800 transition-colors"
              >
                <Settings size={14} />
              </button>
            </div>
          </div>

          {/* Alert list */}
          <div className="max-h-[400px] overflow-y-auto">
            {(!recentAlerts || recentAlerts.length === 0) ? (
              <div className="flex items-center justify-center py-8 text-gray-600 text-sm">
                No alerts yet
              </div>
            ) : (
              recentAlerts.slice(0, 10).map((alert) => {
                const colors = SEVERITY_COLORS[alert.severity as AlertSeverity] ?? SEVERITY_COLORS.info;
                return (
                  <div
                    key={alert._id}
                    className={`px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${
                      !alert.read ? "bg-gray-800/20" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${colors.dot} mt-1.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs font-medium ${alert.read ? "text-gray-400" : "text-gray-200"}`}>
                            {alert.title}
                          </span>
                          {alert.pair && (
                            <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1 py-0.5 rounded">
                              {alert.pair.replace("_", "/")}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 leading-relaxed">{alert.message}</p>
                        <span className="text-[10px] text-gray-600">{timeAgo(alert.createdAt)}</span>
                      </div>
                      {!alert.read && (
                        <button
                          onClick={() => onMarkRead(alert._id)}
                          className="text-gray-600 hover:text-gray-400 transition-colors shrink-0 mt-0.5"
                          title="Mark as read"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
