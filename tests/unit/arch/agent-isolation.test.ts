/**
 * Agent Isolation Architecture Test (arch.agent-isolation.test).
 *
 * Mechanically proves Invariant I-07:
 *   "The agent is isolated. Agent and LLM code can reach only the propose,
 *    catalog and status ports. It holds no PayPal or signing secrets."
 *
 * Verified by dependency-cruiser AST boundary checks.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IConfiguration, IFlattenedRuleSet, IForbiddenRuleType } from "dependency-cruiser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

type CruiseViolation = {
  rule: { name: string; severity: string };
  from: string;
  to: string;
};

type CruiseOutput = {
  summary: {
    error: number;
    warn: number;
    violations?: CruiseViolation[];
  };
};

async function runCruiser(
  directory: string,
  configPath: string,
): Promise<{ errorCount: number; violations: CruiseViolation[] }> {
  const { cruise } = await import("dependency-cruiser");

  const configMod = (await import(/* @vite-ignore */ configPath)) as {
    default: IConfiguration;
  };
  const ruleSet: IFlattenedRuleSet = {
    forbidden: (configMod.default.forbidden ?? []) as IForbiddenRuleType[],
  };

  const result = await cruise([directory], {
    ruleSet,
    validate: true,
    tsPreCompilationDeps: true,
  });

  const output = result.output as unknown as CruiseOutput;
  return {
    errorCount: output.summary.error,
    violations: output.summary.violations ?? [],
  };
}

describe("arch.agent-isolation.test (Invariant I-07)", () => {
  it("real src/ has zero agent isolation violations", async () => {
    const srcDir = path.join(repoRoot, "src");
    const configPath = path.join(repoRoot, ".dependency-cruiser.cjs");
    const { errorCount, violations } = await runCruiser(srcDir, configPath);

    const agentViolations = violations.filter(
      (v) =>
        v.rule.name === "agent-code-imports-settlement-port" ||
        v.rule.name === "agent-code-imports-config-secrets",
    );

    expect(agentViolations).toHaveLength(0);
    expect(errorCount).toBe(0);
  }, 30_000);

  it("proves agent-code-imports-config-secrets and agent-code-imports-settlement-port fire on violations", async () => {
    const fixtureDir = path.join(repoRoot, "tests/fixtures/agent-isolation-violation/src");
    const configPath = path.join(
      repoRoot,
      "tests/fixtures/agent-isolation-violation/.dependency-cruiser.cjs",
    );
    const { errorCount, violations } = await runCruiser(fixtureDir, configPath);

    expect(errorCount).toBeGreaterThanOrEqual(2);

    const secretViolations = violations.filter(
      (v) => v.rule.name === "agent-code-imports-config-secrets",
    );
    expect(secretViolations.length).toBeGreaterThan(0);

    const portViolations = violations.filter(
      (v) => v.rule.name === "agent-code-imports-settlement-port",
    );
    expect(portViolations.length).toBeGreaterThan(0);
  }, 30_000);
});
