import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Convex generated files
    "convex/_generated/**",
    // Scripts - one-off migration/setup utilities
    "scripts/**",
    // Worker backfill scripts
    "worker/src/historical-backfill/**",
    // Worker test/utility files
    "worker/src/test-*.ts",
    "worker/src/verify-*.ts",
    "worker/src/cleanup-*.ts",
    "worker/src/triple-check.ts",
  ]),
]);

export default eslintConfig;
