/**
 * Proves that the ESLint invariant-protection rules actually fire.
 *
 * Uses the ESLint 10 flat-config Linter.verify() API directly.
 * The Linter is given our eslint.config.mjs rules for each file path.
 *
 * INVARIANT: CODING.md §4, I-12.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

/** Build the subset of flat-config rules for a given file path. */
async function getRulesForFile(filePath: string): Promise<Linter.Config[]> {
  // Load the project config
  const mod = (await import(
    /* @vite-ignore */
    path.join(repoRoot, "eslint.config.mjs") + `?t=${Date.now()}`
  )) as { default: Linter.Config[] };

  // Filter to only the configs that match this file
  return mod.default.filter((cfg) => {
    if (!cfg.files) return true; // global config
    const patterns = Array.isArray(cfg.files) ? cfg.files : [cfg.files];
    return patterns.some((p) => {
      // Simple glob match: check if the filePath matches the pattern
      const pat = typeof p === "string" ? p : null;
      if (!pat) return false;
      // Convert glob to partial match
      if (pat.includes("**")) {
        const segment = pat.replace(/\*\*/g, "").replace(/\*/g, "[^/]*").replace(/\./g, "\\.");
        const re = new RegExp(segment.replace(/\//g, "\\/"));
        return re.test(filePath) || filePath.includes(pat.split("**")[1] ?? "");
      }
      return filePath.endsWith(pat.replace(/^\*\//, ""));
    });
  });
}

/**
 * Lint a code snippet using the pure-layer rules, simulating a file at filePath.
 * Returns messages with severity === 2 (errors).
 */
async function lintDomainCode(code: string, simulatedPath: string): Promise<Linter.LintMessage[]> {
  // Build the merged rules manually from our pure-layer guard config block
  const mod = (await import(
    /* @vite-ignore */
    path.join(repoRoot, "eslint.config.mjs") + `?t=${Date.now()}`
  )) as { default: Linter.Config[] };

  // Find the pure-layer config block (it has no-restricted-properties)
  const pureLayerBlocks = mod.default.filter((cfg) => {
    const rules = cfg.rules ?? {};
    return "no-restricted-properties" in rules;
  });

  const mergedRules: Linter.RulesRecord = {};
  for (const block of pureLayerBlocks) {
    Object.assign(mergedRules, block.rules ?? {});
  }

  const linter = new Linter({ configType: "flat" });

  const messages = linter.verify(
    code,
    [
      {
        files: ["**/*.ts"],
        rules: mergedRules,
        languageOptions: {
          globals: {
            Date: "readonly",
            Math: "readonly",
            console: "readonly",
            process: "readonly",
            crypto: "readonly",
          },
        },
      },
    ],
    simulatedPath,
  );

  return messages;
}

function domainPath(file: string) {
  return path.join(repoRoot, "src/domain", file);
}

function ruleIds(messages: Linter.LintMessage[]) {
  return messages.map((m) => m.ruleId ?? m.message);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ESLint pure-layer guardrails", () => {
  it("flags Date.now() with no-restricted-properties", async () => {
    const code = `export function getTs() { return Date.now(); }`;
    const msgs = await lintDomainCode(code, domainPath("example.ts"));
    const errors = msgs.filter((m) => m.severity === 2);
    expect(errors.length, "expected at least one error").toBeGreaterThan(0);
    expect(ruleIds(errors)).toContain("no-restricted-properties");
  });

  it("flags new Date() with no-restricted-syntax", async () => {
    const code = `export function makeDate() { return new Date(); }`;
    const msgs = await lintDomainCode(code, domainPath("example.ts"));
    const errors = msgs.filter((m) => m.severity === 2);
    expect(errors.length, "expected at least one error").toBeGreaterThan(0);
    expect(ruleIds(errors)).toContain("no-restricted-syntax");
  });

  it("flags Math.random() with no-restricted-properties", async () => {
    const code = `export function nonce() { return Math.random(); }`;
    const msgs = await lintDomainCode(code, domainPath("example.ts"));
    const errors = msgs.filter((m) => m.severity === 2);
    expect(errors.length, "expected at least one error").toBeGreaterThan(0);
    expect(ruleIds(errors)).toContain("no-restricted-properties");
  });

  it("flags process.env with no-restricted-syntax", async () => {
    const code = `export function getKey() { return process.env['X'] ?? ''; }`;
    const msgs = await lintDomainCode(code, domainPath("example.ts"));
    const errors = msgs.filter((m) => m.severity === 2);
    expect(errors.length, "expected at least one error").toBeGreaterThan(0);
    expect(ruleIds(errors)).toContain("no-restricted-syntax");
  });

  it("flags console.log() with no-restricted-properties", async () => {
    const code = `export function log() { console.log('hello'); }`;
    const msgs = await lintDomainCode(code, domainPath("example.ts"));
    const errors = msgs.filter((m) => m.severity === 2);
    expect(errors.length, "expected at least one error").toBeGreaterThan(0);
    const ids = ruleIds(errors);
    expect(ids.some((id) => id === "no-restricted-properties" || id === "no-console")).toBe(true);
  });
});
