#!/usr/bin/env npx tsx
/**
 * Migration Orchestrator
 * Runs all migration scripts in order with progress tracking
 */

import { config } from "dotenv";
import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

config({ path: ".env.local" });

const DATA_DIR = join(__dirname, "../../data");
const PROGRESS_FILE = join(DATA_DIR, "migration-progress.json");

interface MigrationProgress {
  startedAt?: string;
  completedAt?: string;
  steps: {
    name: string;
    status: "pending" | "running" | "completed" | "failed";
    startedAt?: string;
    completedAt?: string;
    error?: string;
  }[];
}

const MIGRATION_STEPS = [
  {
    name: "Export candles to ClickHouse",
    script: "export-candles-to-clickhouse.ts",
  },
  {
    name: "Export recent candles to Timescale",
    script: "export-recent-to-timescale.ts",
  },
  {
    name: "Export news data to databases",
    script: "export-news-to-databases.ts",
  },
];

function loadProgress(): MigrationProgress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return {
    steps: MIGRATION_STEPS.map((s) => ({
      name: s.name,
      status: "pending",
    })),
  };
}

function saveProgress(progress: MigrationProgress) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function runScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["tsx", join(__dirname, script)], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${script} exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log("═".repeat(60));
  console.log("  TRADING SYSTEM DATABASE MIGRATION");
  console.log("  Convex → Timescale Cloud + ClickHouse");
  console.log("═".repeat(60));
  console.log();

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const progress = loadProgress();

  if (!progress.startedAt) {
    progress.startedAt = new Date().toISOString();
    saveProgress(progress);
  }

  // Find where to resume
  const startIndex = progress.steps.findIndex(
    (s) => s.status === "pending" || s.status === "running"
  );

  if (startIndex === -1) {
    console.log("All migration steps already completed!");
    console.log("To re-run, delete data/migration-progress.json");
    return;
  }

  console.log(`Starting from step ${startIndex + 1}/${MIGRATION_STEPS.length}\n`);

  for (let i = startIndex; i < MIGRATION_STEPS.length; i++) {
    const step = MIGRATION_STEPS[i];
    const stepProgress = progress.steps[i];

    console.log("─".repeat(60));
    console.log(`Step ${i + 1}/${MIGRATION_STEPS.length}: ${step.name}`);
    console.log("─".repeat(60));
    console.log();

    stepProgress.status = "running";
    stepProgress.startedAt = new Date().toISOString();
    saveProgress(progress);

    try {
      await runScript(step.script);
      stepProgress.status = "completed";
      stepProgress.completedAt = new Date().toISOString();
      saveProgress(progress);
      console.log(`\n✓ ${step.name} completed\n`);
    } catch (err: any) {
      stepProgress.status = "failed";
      stepProgress.error = err.message;
      saveProgress(progress);
      console.error(`\n✗ ${step.name} failed: ${err.message}\n`);
      console.log("Re-run this script to resume from this step.");
      process.exit(1);
    }
  }

  progress.completedAt = new Date().toISOString();
  saveProgress(progress);

  console.log("═".repeat(60));
  console.log("  MIGRATION COMPLETE");
  console.log("═".repeat(60));
  console.log();
  console.log(`Started:   ${progress.startedAt}`);
  console.log(`Completed: ${progress.completedAt}`);
  console.log();

  // Summary
  for (const step of progress.steps) {
    const symbol = step.status === "completed" ? "✓" : "✗";
    console.log(`  ${symbol} ${step.name}`);
  }

  console.log();
  console.log("Next steps:");
  console.log("  1. Verify data in Timescale and ClickHouse");
  console.log("  2. Run: npm run verify-migration");
  console.log("  3. Update application code to use new databases");
  console.log();
}

main().catch(console.error);
