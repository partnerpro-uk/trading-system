"use client";

import { X } from "lucide-react";
import type { ToastItem as ToastItemType } from "@/lib/alerts/types";
import { SEVERITY_COLORS } from "@/lib/alerts/types";

interface ToastItemProps {
  toast: ToastItemType;
  onDismiss: (id: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const colors = SEVERITY_COLORS[toast.severity];

  return (
    <div
      className={`bg-gray-900 border border-gray-800 border-l-4 ${colors.border} rounded-xl px-4 py-3 shadow-lg shadow-black/40 animate-slide-in-right min-w-[320px] max-w-[400px]`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full ${colors.dot} mt-1.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-gray-200 truncate">{toast.title}</span>
            {toast.pair && (
              <span className="text-[10px] font-mono text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded shrink-0">
                {toast.pair.replace("_", "/")}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">{toast.message}</p>
          <span className="text-[10px] text-gray-600 mt-1 block">{timeAgo(toast.createdAt)}</span>
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="text-gray-600 hover:text-gray-400 transition-colors shrink-0 mt-0.5"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
