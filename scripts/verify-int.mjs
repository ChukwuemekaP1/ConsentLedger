#!/usr/bin/env node
/**
 * Runs integration tests as part of `pnpm verify`.
 *
 * - In CI (CI=true env var): DATABASE_URL must be set; failure aborts verify.
 * - Locally: if DATABASE_URL is absent, prints a clear skip message and exits 0.
 *   Set DATABASE_URL and run `pnpm db:up` to enable locally.
 */
import { execSync } from "node:child_process";

const isCI = process.env["CI"] === "true";
const hasDb = Boolean(process.env["DATABASE_URL"]);

if (!hasDb) {
  if (isCI) {
    console.error(
      "\n  ERROR: CI=true but DATABASE_URL is not set.\n" +
        "  Integration tests require a Postgres service. Check ci.yml.\n",
    );
    process.exit(1);
  }
  console.log(
    "\n  [test:int] DATABASE_URL not set — skipping integration tests locally.\n" +
      "  Run `pnpm db:up` and export DATABASE_URL to enable them.\n",
  );
  process.exit(0);
}

try {
  execSync("pnpm vitest run --project integration", { stdio: "inherit" });
} catch {
  process.exit(1);
}
