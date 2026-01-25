import { useState, useEffect } from "react";

export interface Strategy {
  id: string;
  name: string;
  version: string;
  summary: string;
}

export function useStrategies() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStrategies() {
      try {
        const res = await fetch("/api/strategies");
        if (!res.ok) throw new Error("Failed to fetch strategies");
        const data = await res.json();
        setStrategies(data.strategies);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    }

    fetchStrategies();
  }, []);

  return { strategies, isLoading, error };
}
