import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const strategyFile = path.join(process.cwd(), "strategies", id, "strategy.json");

    if (!fs.existsSync(strategyFile)) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
    }

    const content = fs.readFileSync(strategyFile, "utf-8");
    const json = JSON.parse(content);

    return NextResponse.json(json);
  } catch (error) {
    console.error("Error loading strategy:", error);
    return NextResponse.json({ error: "Failed to load strategy" }, { status: 500 });
  }
}
