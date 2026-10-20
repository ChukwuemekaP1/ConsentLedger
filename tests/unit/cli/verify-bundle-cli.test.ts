/**
 * Tests for the standalone verify:bundle CLI.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { runCli } from "../../../scripts/verify-bundle.js";
import { createValidBundleFixture } from "../domain/evidence-fixture.js";

describe("CLI: verify:bundle", () => {
  const tempBundlePath = resolve(process.cwd(), "temp-test-bundle.json");
  const tempTrustStorePath = resolve(process.cwd(), "temp-test-trust-store.json");
  const tempTamperedBundlePath = resolve(process.cwd(), "temp-test-tampered-bundle.json");

  beforeAll(() => {
    const { bundle, trustStore } = createValidBundleFixture();
    writeFileSync(tempBundlePath, JSON.stringify(bundle, null, 2), "utf8");
    writeFileSync(tempTrustStorePath, JSON.stringify(trustStore, null, 2), "utf8");

    const tampered = JSON.parse(JSON.stringify(bundle));
    tampered.mandates[0].terms.promptPlayback = "Tampered prompt altering hash";
    writeFileSync(tempTamperedBundlePath, JSON.stringify(tampered, null, 2), "utf8");
  });

  afterAll(() => {
    if (existsSync(tempBundlePath)) unlinkSync(tempBundlePath);
    if (existsSync(tempTrustStorePath)) unlinkSync(tempTrustStorePath);
    if (existsSync(tempTamperedBundlePath)) unlinkSync(tempTamperedBundlePath);
  });

  it("runCli returns 0 for a valid bundle and trusted keys", () => {
    const code = runCli(["--bundle", tempBundlePath, "--trust-store", tempTrustStorePath]);
    expect(code).toBe(0);
  });

  it("runCli returns 0 using positional arguments", () => {
    const code = runCli([tempBundlePath, tempTrustStorePath]);
    expect(code).toBe(0);
  });

  it("runCli returns 1 for a tampered bundle", () => {
    const code = runCli(["--bundle", tempTamperedBundlePath, "--trust-store", tempTrustStorePath]);
    expect(code).toBe(1);
  });

  it("runCli returns 1 if trust store is omitted (untrusted keys rejected)", () => {
    const code = runCli(["--bundle", tempBundlePath]);
    expect(code).toBe(1);
  });

  it("runCli returns 1 for a non-existent bundle file", () => {
    const code = runCli(["--bundle", "does-not-exist.json"]);
    expect(code).toBe(1);
  });

  it("runCli returns 0 for --help", () => {
    const code = runCli(["--help"]);
    expect(code).toBe(0);
  });

  it("executes via pnpm verify:bundle CLI command with exit code 0", { timeout: 30000 }, () => {
    const output = execSync(
      `pnpm verify:bundle --bundle "${tempBundlePath}" --trust-store "${tempTrustStorePath}"`,
      { encoding: "utf8" },
    );
    expect(output).toContain("RESULT: VERIFIED VALID OFFLINE");
    expect(output).toContain("All offline cryptographic and state consistency checks passed");
  });

  it(
    "executes via pnpm verify:bundle CLI command and exits non-zero on failure",
    { timeout: 30000 },
    () => {
      let failed = false;
      try {
        execSync(
          `pnpm verify:bundle --bundle "${tempTamperedBundlePath}" --trust-store "${tempTrustStorePath}"`,
          { encoding: "utf8", stdio: "pipe" },
        );
      } catch (err: unknown) {
        failed = true;
        const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
        expect(e.status).toBe(1);
        const combined = `${e.stdout?.toString() ?? ""}\n${e.stderr?.toString() ?? ""}`;
        expect(combined).toContain("RESULT: VERIFICATION FAILED");
        expect(combined).toContain("V1");
      }
      expect(failed).toBe(true);
    },
  );
});
