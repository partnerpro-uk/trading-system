"use client";

import React from "react";

export interface StatProps {
  label: string;
  value: React.ReactNode;
  color?: string;
}

export function Stat({ label, value, color }: StatProps) {
  const effectiveColor =
    color && color.includes("255,255,255") ? "rgba(120,180,255,0.95)" : color;
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.03)",
        padding: 10,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 13,
          fontWeight: 900,
          color: effectiveColor || "rgba(255,255,255,0.88)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
    </div>
  );
}
