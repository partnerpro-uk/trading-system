import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export interface Strategy {
  id: string;
  name: string;
  version: string;
  summary: string;
}

export async function GET() {
  try {
    const strategiesDir = path.join(process.cwd(), "strategies");

    if (!fs.existsSync(strategiesDir)) {
      return NextResponse.json({ strategies: [] });
    }

    const entries = fs.readdirSync(strategiesDir, { withFileTypes: true });
    const strategies: Strategy[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const strategyFile = path.join(strategiesDir, entry.name, "strategy.json");

        if (fs.existsSync(strategyFile)) {
          try {
            const content = fs.readFileSync(strategyFile, "utf-8");
            const json = JSON.parse(content);

            strategies.push({
              id: entry.name,
              name: json.strategy?.name || entry.name,
              version: json.strategy?.version || "1.0",
              summary: json.strategy?.thesis?.summary || "",
            });
          } catch {
            // Skip invalid JSON files
          }
        }
      }
    }

    return NextResponse.json({ strategies });
  } catch (error) {
    console.error("Error loading strategies:", error);
    return NextResponse.json({ strategies: [] });
  }
}
