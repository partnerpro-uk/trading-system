"use client";

import { Pencil, Trash2, MoveHorizontal, RefreshCw } from "lucide-react";
import type { DrawingAction } from "@/lib/chat/types";

interface DrawingActionCardProps {
  action: DrawingAction;
}

export function DrawingActionCard({ action }: DrawingActionCardProps) {
  const Icon =
    action.action === "update"
      ? RefreshCw
      : action.action === "remove"
        ? Trash2
        : action.action === "scroll"
          ? MoveHorizontal
          : Pencil;

  const bgColor =
    action.action === "update"
      ? "bg-amber-900/30 border-amber-800/50"
      : action.action === "remove"
        ? "bg-red-900/30 border-red-800/50"
        : action.action === "scroll"
          ? "bg-gray-800/50 border-gray-700"
          : "bg-blue-900/30 border-blue-800/50";

  const iconColor =
    action.action === "update"
      ? "text-amber-400"
      : action.action === "remove"
        ? "text-red-400"
        : action.action === "scroll"
          ? "text-gray-400"
          : "text-blue-400";

  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs ${bgColor}`}>
      <Icon className={`w-3 h-3 shrink-0 ${iconColor}`} />
      <span className="text-gray-300 truncate">{action.description}</span>
    </div>
  );
}
