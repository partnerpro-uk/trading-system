#!/usr/bin/env npx tsx
/**
 * Robust Bulk Upload Script (FAST VERSION)
 *
 * Uses BATCH mutations - single HTTP call inserts many records.
 * Much faster than individual mutations (100x+ speedup).
 *
 * Features:
 * - Checkpointing (resume on crash)
 * - Streaming JSONL reads (no memory issues)
 * - Batch mutations (100 reactions per call, 10 windows per call)
 * - Progress reporting with ETA
 *
 * Usage:
 *   npx tsx scripts/bulk-upload.ts reactions       # Upload reactions (~1-2 hours)
 *   npx tsx scripts/bulk-upload.ts statistics      # Upload statistics (~1 min)
 *   npx tsx scripts/bulk-upload.ts windows         # Upload windows (~6-8 hours)
 *   npx tsx scripts/bulk-upload.ts all             # Upload all in order
 *   npx tsx scripts/bulk-upload.ts reactions --reset  # Reset checkpoint, start fresh
 */

import { config } from "dotenv";
import { createReadStream, existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { createInterface } from "readline";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // File paths
  files: {
    reactions: "data/reactions.jsonl",
    statistics: "data/statistics.json",
    windows: "data/candle-windows.jsonl",
  },

  // Checkpoints (saved line numbers to resume)
  checkpoints: {
    reactions: "data/.checkpoint-reactions",
    statistics: "data/.checkpoint-statistics",
    windows: "data/.checkpoint-windows",
  },

  // Upload settings - BATCH SIZES
  batchSizes: {
    reactions: 100,   // 100 reactions per mutation (small docs)
    statistics: 50,   // 50 stats per mutation
    windows: 5,       // 5 windows per mutation (large docs with candles)
  },

  // Delay between batches (ms)
  delayBetweenBatches: 50,

  // Retry settings
  retryAttempts: 3,
  retryDelay: 2000,

  // Progress reporting
  reportEvery: 500,
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface UploadResult {
  uploaded: number;
  skipped: number;
  errors: number;
  elapsed: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECKPOINT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function loadCheckpoint(type: keyof typeof CONFIG.checkpoints): number {
  const file = CONFIG.checkpoints[type];
  if (!existsSync(file)) return 0;
  try {
    return parseInt(readFileSync(file, "utf-8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function saveCheckpoint(type: keyof typeof CONFIG.checkpoints, line: number): void {
  writeFileSync(CONFIG.checkpoints[type], String(line));
}

function resetCheckpoint(type: keyof typeof CONFIG.checkpoints): void {
  const file = CONFIG.checkpoints[type];
  if (existsSync(file)) {
    writeFileSync(file, "0");
    console.log(`  Reset checkpoint for ${type}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD HELPERS
// ═══════════════════════════════════════════════════════════════════════════

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = CONFIG.retryAttempts
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      console.error(`\n  Retry ${i + 1}/${attempts}: ${(e as Error).message}`);
      if (i < attempts - 1) {
        await sleep(CONFIG.retryDelay * (i + 1));
      }
    }
  }
  throw lastError;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function countLines(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });
    rl.on("line", () => count++);
    rl.on("close", () => resolve(count));
    rl.on("error", reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UPLOAD FUNCTIONS (BATCH MODE)
// ═══════════════════════════════════════════════════════════════════════════

async function uploadReactions(client: ConvexHttpClient): Promise<UploadResult> {
  console.log("\n━━━ Uploading Reactions (Batch Mode) ━━━\n");

  const file = CONFIG.files.reactions;
  if (!existsSync(file)) {
    console.log("  No reactions file found.");
    return { uploaded: 0, skipped: 0, errors: 0, elapsed: 0 };
  }

  const total = await countLines(file);
  const startLine = loadCheckpoint("reactions");
  console.log(`  Total reactions: ${total.toLocaleString()}`);
  console.log(`  Starting from line: ${startLine.toLocaleString()}`);
  console.log(`  Remaining: ${(total - startLine).toLocaleString()}`);
  console.log(`  Batch size: ${CONFIG.batchSizes.reactions}\n`);

  if (startLine >= total) {
    console.log("  All reactions already uploaded!");
    return { uploaded: 0, skipped: startLine, errors: 0, elapsed: 0 };
  }

  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let uploaded = 0;
  let errors = 0;
  const startTime = Date.now();
  let batch: unknown[] = [];
  let batchStartLine = 0;

  const processBatch = async () => {
    if (batch.length === 0) return;

    try {
      await withRetry(() =>
        client.mutation(api.newsReactions.uploadReactionsBatch, {
          reactions: batch,
        } as never)
      );
      uploaded += batch.length;
      saveCheckpoint("reactions", lineNum);
    } catch (e) {
      console.error(`\n  Batch failed at lines ${batchStartLine}-${lineNum}: ${(e as Error).message}`);
      errors += batch.length;
    }
    batch = [];
  };

  for await (const line of rl) {
    lineNum++;
    if (lineNum <= startLine) continue;
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);
      if (batch.length === 0) batchStartLine = lineNum;
      batch.push(data);

      if (batch.length >= CONFIG.batchSizes.reactions) {
        await processBatch();
        await sleep(CONFIG.delayBetweenBatches);
      }

      if (uploaded % CONFIG.reportEvery === 0 && uploaded > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = uploaded / elapsed;
        const remaining = total - startLine - uploaded;
        const eta = remaining / rate;
        process.stdout.write(
          `\r  Progress: ${uploaded.toLocaleString()} / ${(total - startLine).toLocaleString()} | ${rate.toFixed(0)}/s | ETA: ${formatTime(eta)}   `
        );
      }
    } catch {
      errors++;
    }
  }

  // Process remaining batch
  await processBatch();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n  Uploaded: ${uploaded.toLocaleString()}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Time:     ${formatTime(elapsed)}`);
  console.log(`  Rate:     ${(uploaded / elapsed).toFixed(0)}/s`);

  return { uploaded, skipped: startLine, errors, elapsed };
}

async function uploadStatistics(client: ConvexHttpClient): Promise<UploadResult> {
  console.log("\n━━━ Uploading Statistics ━━━\n");

  const file = CONFIG.files.statistics;
  if (!existsSync(file)) {
    console.log("  No statistics file found.");
    return { uploaded: 0, skipped: 0, errors: 0, elapsed: 0 };
  }

  const startLine = loadCheckpoint("statistics");
  const data = JSON.parse(readFileSync(file, "utf-8"));
  const stats = Array.isArray(data) ? data : [data];

  console.log(`  Total statistics: ${stats.length.toLocaleString()}`);
  console.log(`  Starting from: ${startLine}`);
  console.log(`  Remaining: ${stats.length - startLine}\n`);

  if (startLine >= stats.length) {
    console.log("  All statistics already uploaded!");
    return { uploaded: 0, skipped: startLine, errors: 0, elapsed: 0 };
  }

  let uploaded = 0;
  let errors = 0;
  const startTime = Date.now();

  // Statistics don't have a batch mutation, upload individually but fast
  for (let i = startLine; i < stats.length; i++) {
    try {
      await withRetry(() =>
        client.mutation(api.newsStatistics.uploadStatistics, stats[i])
      );
      uploaded++;
      saveCheckpoint("statistics", i + 1);
    } catch {
      errors++;
    }

    if (i % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (uploaded + errors) / elapsed;
      process.stdout.write(
        `\r  Progress: ${uploaded} / ${stats.length - startLine} | ${rate.toFixed(1)}/s   `
      );
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n  Uploaded: ${uploaded}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Time:     ${formatTime(elapsed)}`);

  return { uploaded, skipped: startLine, errors, elapsed };
}

async function uploadWindows(client: ConvexHttpClient): Promise<UploadResult> {
  console.log("\n━━━ Uploading Windows (Batch Mode - Large Data) ━━━\n");

  const file = CONFIG.files.windows;
  if (!existsSync(file)) {
    console.log("  No windows file found.");
    return { uploaded: 0, skipped: 0, errors: 0, elapsed: 0 };
  }

  const fileSize = statSync(file).size;
  console.log(`  File size: ${(fileSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

  const total = await countLines(file);
  const startLine = loadCheckpoint("windows");
  console.log(`  Total windows: ${total.toLocaleString()}`);
  console.log(`  Starting from line: ${startLine.toLocaleString()}`);
  console.log(`  Remaining: ${(total - startLine).toLocaleString()}`);
  console.log(`  Batch size: ${CONFIG.batchSizes.windows} (small due to large docs)\n`);

  if (startLine >= total) {
    console.log("  All windows already uploaded!");
    return { uploaded: 0, skipped: startLine, errors: 0, elapsed: 0 };
  }

  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let uploaded = 0;
  let errors = 0;
  const startTime = Date.now();
  let batch: unknown[] = [];
  let batchStartLine = 0;

  const processBatch = async () => {
    if (batch.length === 0) return;

    try {
      await withRetry(() =>
        client.mutation(api.newsReactions.uploadWindowsBatch, {
          windows: batch,
        } as never)
      );
      uploaded += batch.length;
      saveCheckpoint("windows", lineNum);
    } catch (e) {
      console.error(`\n  Batch failed at lines ${batchStartLine}-${lineNum}: ${(e as Error).message}`);
      errors += batch.length;
    }
    batch = [];
  };

  for await (const line of rl) {
    lineNum++;
    if (lineNum <= startLine) continue;
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);
      if (batch.length === 0) batchStartLine = lineNum;
      batch.push(data);

      if (batch.length >= CONFIG.batchSizes.windows) {
        await processBatch();
        await sleep(CONFIG.delayBetweenBatches);
      }

      if (uploaded % CONFIG.reportEvery === 0 && uploaded > 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = uploaded / elapsed;
        const remaining = total - startLine - uploaded;
        const eta = remaining / rate;
        process.stdout.write(
          `\r  Progress: ${uploaded.toLocaleString()} / ${(total - startLine).toLocaleString()} | ${rate.toFixed(0)}/s | ETA: ${formatTime(eta)}   `
        );
      }
    } catch {
      errors++;
    }
  }

  // Process remaining batch
  await processBatch();

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n  Uploaded: ${uploaded.toLocaleString()}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Time:     ${formatTime(elapsed)}`);
  console.log(`  Rate:     ${(uploaded / elapsed).toFixed(0)}/s`);

  return { uploaded, skipped: startLine, errors, elapsed };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const type = args[0] || "all";
  const shouldReset = args.includes("--reset");

  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║           BULK UPLOAD TO CONVEX (BATCH MODE)                      ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝\n");

  const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!CONVEX_URL) {
    console.log("ERROR: NEXT_PUBLIC_CONVEX_URL not set in .env.local");
    process.exit(1);
  }

  console.log(`  Target: ${type}`);
  console.log(`  Convex URL: ${CONVEX_URL.substring(0, 30)}...`);

  if (shouldReset) {
    console.log("\n  Resetting checkpoints...");
    if (type === "all" || type === "reactions") resetCheckpoint("reactions");
    if (type === "all" || type === "statistics") resetCheckpoint("statistics");
    if (type === "all" || type === "windows") resetCheckpoint("windows");
  }

  const client = new ConvexHttpClient(CONVEX_URL);
  const results: Record<string, UploadResult> = {};

  if (type === "reactions" || type === "all") {
    results.reactions = await uploadReactions(client);
  }

  if (type === "statistics" || type === "all") {
    results.statistics = await uploadStatistics(client);
  }

  if (type === "windows" || type === "all") {
    results.windows = await uploadWindows(client);
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("                           SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  let totalUploaded = 0;
  let totalErrors = 0;
  let totalTime = 0;

  for (const [name, result] of Object.entries(results)) {
    console.log(`  ${name.toUpperCase()}:`);
    console.log(`    Uploaded: ${result.uploaded.toLocaleString()}`);
    console.log(`    Skipped:  ${result.skipped.toLocaleString()} (already uploaded)`);
    console.log(`    Errors:   ${result.errors}`);
    console.log(`    Time:     ${formatTime(result.elapsed)}\n`);

    totalUploaded += result.uploaded;
    totalErrors += result.errors;
    totalTime += result.elapsed;
  }

  console.log(`  TOTAL: ${totalUploaded.toLocaleString()} uploaded, ${totalErrors} errors in ${formatTime(totalTime)}`);
  console.log("\n═══════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
