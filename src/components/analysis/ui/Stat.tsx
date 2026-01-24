"use client";

import React from "react";

interface StatProps {
  label: string;
  value: React.ReactNode;
  color?: string;
}

export function Stat({ label, value, color }: StatProps) {
  const effectiveColor =
    color && color.includes("255,255,255")
      ? "rgba(120,180,255,0.95)"
      : color || "rgba(255,255,255,0.9)";

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 min-w-0">
      <div className="text-[10px] text-white/65">{label}</div>
      <div
        className="mt-1 text-[13px] font-black whitespace-nowrap overflow-hidden text-ellipsis"
        style={{ color: effectiveColor }}
      >
        {value}
      </div>
    </div>
  );
}
