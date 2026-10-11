/**
 * Proves that the dependency-cruiser rules actually fire on violations.
 *
 * Two checks:
 *   1. The real src/ tree passes (zero violations on our own code).
 *   2. The deliberate fixture (domain importing infrastructure) produces
 *      at least one "error" violation — the rule bites.
 *
 * INVARIANT: I-07 (agent isolation) and ADR-0001 (hexagonal boundaries)
 * are mechanically enforced, not just documented.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IConfiguration, IFlattenedRuleSet, IForbiddenRuleType } from "dependency-cruiser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

type CruiseOutput = {
  summary: { error: number; warn: number };
};

async function runCruiser(directory: string, configPath: string): Promise<{ errorCount: number }> {
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

  const output = result.output as CruiseOutput;
  return { errorCount: output.summary.error };
}

describe("architecture rules (dependency-cruiser)", () => {
  it("real src/ has zero architecture violations", async () => {
    const srcDir = path.join(repoRoot, "src");
    const configPath = path.join(repoRoot, ".dependency-cruiser.cjs");
    const { errorCount } = await runCruiser(srcDir, configPath);
    expect(errorCount).toBe(0);
  }, 30_000);

  it("fixture with domain→infrastructure import triggers an error violation", async () => {
    const fixtureDir = path.join(repoRoot, "tests/fixtures/arch-violation/src");
    const configPath = path.join(repoRoot, "tests/fixtures/arch-violation/.dependency-cruiser.cjs");
    const { errorCount } = await runCruiser(fixtureDir, configPath);
    // Must be > 0 — if 0, the guard is broken
    expect(errorCount).toBeGreaterThan(0);
  }, 30_000);
});
