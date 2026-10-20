#!/usr/bin/env node
/**
 * Standalone offline evidence bundle verifier CLI.
 *
 * Runs without application credentials, a database connection, network access
 * or private signing keys (Invariant I-09, ARCHITECTURE.md §11).
 *
 * Usage:
 *   pnpm verify:bundle --bundle <path> --trust-store <path>
 *   pnpm verify:bundle <bundle.json> [trust-store.json]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEvidenceBundle } from "../src/domain/evidence/verifier.js";
import type { TrustStore } from "../src/domain/evidence/types.js";

function printUsage(): void {
  console.log(`
ConsentLedger Offline Evidence Verifier (v1)

USAGE:
  pnpm verify:bundle --bundle <file> [--trust-store <file>]
  pnpm verify:bundle <bundle-file> [<trust-store-file>]

OPTIONS:
  -b, --bundle <file>       Path to the evidence bundle JSON file.
  -t, --trust-store <file>  Path to the trusted public keys JSON store.
  -h, --help                Show this help message.

EXIT CODES:
  0   All cryptographic and state consistency checks passed.
  1   Verification failed, file not found, or input invalid.
`);
}

function parseArgs(args: string[]): {
  bundlePath?: string | undefined;
  trustStorePath?: string | undefined;
  help?: boolean | undefined;
} {
  const result: {
    bundlePath?: string | undefined;
    trustStorePath?: string | undefined;
    help?: boolean | undefined;
  } = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      result.help = true;
      return result;
    }
    if (arg === "-b" || arg === "--bundle") {
      result.bundlePath = args[++i];
    } else if (arg === "-t" || arg === "--trust-store") {
      result.trustStorePath = args[++i];
    } else if (arg && !arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  if (!result.bundlePath && positional[0]) {
    result.bundlePath = positional[0];
  }
  if (!result.trustStorePath && positional[1]) {
    result.trustStorePath = positional[1];
  }

  return result;
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);

  if (args.help) {
    printUsage();
    return 0;
  }

  if (!args.bundlePath) {
    console.error("\nError: Missing bundle file path.\n");
    printUsage();
    return 1;
  }

  const bundleFullPath = resolve(process.cwd(), args.bundlePath);
  if (!existsSync(bundleFullPath)) {
    console.error(`\nError: Bundle file not found: ${args.bundlePath}\n`);
    return 1;
  }

  let bundleData: unknown;
  try {
    const raw = readFileSync(bundleFullPath, "utf8");
    bundleData = JSON.parse(raw);
  } catch (e) {
    console.error(
      `\nError reading/parsing bundle JSON: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 1;
  }

  let trustStoreData: TrustStore | null = null;
  if (args.trustStorePath) {
    const trustFullPath = resolve(process.cwd(), args.trustStorePath);
    if (!existsSync(trustFullPath)) {
      console.error(`\nError: Trust store file not found: ${args.trustStorePath}\n`);
      return 1;
    }
    try {
      const raw = readFileSync(trustFullPath, "utf8");
      trustStoreData = JSON.parse(raw);
    } catch (e) {
      console.error(
        `\nError reading/parsing trust store JSON: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      return 1;
    }
  }

  console.log("================================================================================");
  console.log("  CONSENTLEDGER OFFLINE EVIDENCE VERIFIER (v1)");
  console.log("================================================================================");
  console.log(`  Bundle:       ${args.bundlePath}`);
  console.log(
    `  Trust Store:  ${args.trustStorePath ?? "NONE (Self-asserted bundle keys will be rejected)"}`,
  );
  console.log("--------------------------------------------------------------------------------");

  const result = verifyEvidenceBundle(bundleData, trustStoreData);

  for (const check of result.ok ? result.value.checks : result.error.checks) {
    const tag = `[${check.status}]`;
    const paddedTag = tag.padEnd(8, " ");
    console.log(`  ${paddedTag} ${check.id}: ${check.name}`);
    if (check.details) {
      console.log(`           ${check.details}`);
    }
  }

  console.log("--------------------------------------------------------------------------------");

  if (result.ok) {
    console.log("  RESULT: VERIFIED VALID OFFLINE");
    console.log(`  Correlation ID: ${result.value.correlationId}`);
    console.log(`  Summary:        ${result.value.summary}`);
    console.log("");
    console.log("  NOTICE: Offline verification proves cryptographic integrity, passkey consent");
    console.log(
      "  binding, and ledger consistency. It does NOT prove external merchant fulfillment",
    );
    console.log("  or independent PayPal server state.");
    console.log("================================================================================");
    return 0;
  } else {
    console.error("  RESULT: VERIFICATION FAILED");
    console.error(`  Failed Check:   ${result.error.failedCheck}`);
    console.error(`  Reason Code:    ${result.error.code}`);
    console.error(`  Message:        ${result.error.message}`);
    console.log("================================================================================");
    return 1;
  }
}

// If executed directly as a script
if (
  process.argv[1]?.endsWith("verify-bundle.ts") ||
  process.argv[1]?.endsWith("verify-bundle.js")
) {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}
