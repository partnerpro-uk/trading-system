#!/usr/bin/env npx tsx
/**
 * API Key Management CLI
 *
 * Usage:
 *   npx tsx scripts/manage-api-keys.ts create --name "John Doe" --email "john@example.com"
 *   npx tsx scripts/manage-api-keys.ts list
 *   npx tsx scripts/manage-api-keys.ts revoke --id <uuid>
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Trim env vars (fix for newline issues in .env.local)
if (process.env.TIMESCALE_URL) {
  process.env.TIMESCALE_URL = process.env.TIMESCALE_URL.trim();
}

import { createApiKey, listApiKeys, revokeApiKey } from "../lib/api-keys";

const command = process.argv[2];

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 3; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, "");
    const value = process.argv[i + 1];
    if (key && value) {
      args[key] = value;
    }
  }
  return args;
}

async function main() {
  switch (command) {
    case "create": {
      const args = parseArgs();

      if (!args.name) {
        console.error("Error: --name is required");
        console.log("\nUsage: npx tsx scripts/manage-api-keys.ts create --name <name> [--email <email>] [--tier <tier>] [--rate-limit <rpm>]");
        process.exit(1);
      }

      const result = await createApiKey({
        name: args.name,
        email: args.email,
        description: args.description,
        tier: args.tier || "free",
        rateLimitPerMinute: args["rate-limit"] ? parseInt(args["rate-limit"], 10) : 60,
      });

      console.log("\n════════════════════════════════════════════════════════════════");
      console.log("  API KEY CREATED SUCCESSFULLY");
      console.log("════════════════════════════════════════════════════════════════\n");
      console.log("  Key ID:    ", result.id);
      console.log("  Name:      ", args.name);
      console.log("  Tier:      ", args.tier || "free");
      console.log("  Rate Limit:", args["rate-limit"] || 60, "requests/min");
      console.log("\n  ┌─────────────────────────────────────────────────────────────┐");
      console.log("  │  API KEY (save this - it won't be shown again):            │");
      console.log("  │                                                             │");
      console.log(`  │  ${result.key}  │`);
      console.log("  │                                                             │");
      console.log("  └─────────────────────────────────────────────────────────────┘\n");
      break;
    }

    case "list": {
      const keys = await listApiKeys();

      console.log("\n════════════════════════════════════════════════════════════════");
      console.log("  API KEYS");
      console.log("════════════════════════════════════════════════════════════════\n");

      if (keys.length === 0) {
        console.log("  No API keys found.\n");
        break;
      }

      for (const key of keys) {
        const status = key.isActive ? "✓ Active" : "✗ Revoked";
        console.log(`  ${key.keyPrefix}...  │  ${key.name.padEnd(20)}  │  ${key.tier.padEnd(10)}  │  ${status}`);
        console.log(`  ID: ${key.id}`);
        console.log(`  Requests: ${key.totalRequests}  │  Last used: ${key.lastUsedAt?.toISOString() || "Never"}`);
        console.log("  ────────────────────────────────────────────────────────────────");
      }
      console.log("");
      break;
    }

    case "revoke": {
      const args = parseArgs();

      if (!args.id) {
        console.error("Error: --id is required");
        console.log("\nUsage: npx tsx scripts/manage-api-keys.ts revoke --id <uuid> [--reason <reason>]");
        process.exit(1);
      }

      const success = await revokeApiKey(args.id, args.reason);

      if (success) {
        console.log(`\n✓ API key ${args.id} has been revoked.\n`);
      } else {
        console.error(`\n✗ Failed to revoke API key ${args.id}. Key may not exist.\n`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
API Key Management CLI

Commands:
  create    Create a new API key
  list      List all API keys
  revoke    Revoke an API key

Examples:
  npx tsx scripts/manage-api-keys.ts create --name "John Doe" --email "john@example.com"
  npx tsx scripts/manage-api-keys.ts create --name "Pro User" --tier pro --rate-limit 1000
  npx tsx scripts/manage-api-keys.ts list
  npx tsx scripts/manage-api-keys.ts revoke --id <uuid> --reason "Abuse detected"
`);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
