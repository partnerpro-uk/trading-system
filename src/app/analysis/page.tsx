"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Simple redirect to default analysis view
// All configuration happens on the [pair]/[timeframe] page
export default function AnalysisRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/analysis/EUR_USD/H1");
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400">Loading analysis...</div>
    </div>
  );
}
