"use client";

import { useAlertStore } from "@/lib/alerts/store";
import { ToastItem } from "./ToastItem";

export function ToastContainer() {
  const toasts = useAlertStore((s) => s.toasts);
  const dismissToast = useAlertStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
