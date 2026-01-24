"use client";

import React from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  color?: "positive" | "negative" | "neutral" | "purple";
  size?: "sm" | "md" | "lg";
}

export function StatCard({ label, value, color = "neutral", size = "md" }: StatCardProps) {
  const colorClasses = {
    positive: "text-green-400",
    negative: "text-red-400",
    neutral: "text-gray-300",
    purple: "text-purple-400",
  };

  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl",
  };

  return (
    <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-bold ${sizeClasses[size]} ${colorClasses[color]}`}>{value}</div>
    </div>
  );
}
