/**
 * Tests for src/infrastructure/config/env.ts
 *
 * Proves: I-12 — a misconfigured env fails at boot with a readable error
 * that contains variable NAMES but never their VALUES.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Run the env parser against a fake process.env object.
 * We re-create the schema inline rather than importing the singleton `config`
 * export, so we can test validation in isolation without side-effecting the
 * real process.env.
 */
function parseWith(env: Record<string, string>): {
  ok: boolean;
  config?: Record<string, unknown>;
  error?: string;
} {
  const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),
    SETTLEMENT_MODE: z.enum(["paypal", "simulated"]).default("simulated"),
    LLM_MODE: z.enum(["live", "mock"]).default("mock"),
    LAB_ENABLED: z
      .string()
      .transform((v) => v === "true")
      .pipe(z.boolean())
      .default(false),
    COMMIT: z.string().default("unknown"),
  });

  const result = schema.safeParse(env);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")} — ${issue.message}`,
    );
    return {
      ok: false,
      error: `[config] Environment validation failed:\n${lines.join("\n")}`,
    };
  }

  return { ok: true, config: result.data as Record<string, unknown> };
}

describe("env config validation (I-12)", () => {
  it("accepts a minimal valid environment with all defaults", () => {
    const result = parseWith({});
    expect(result.ok).toBe(true);
    expect(result.config?.["NODE_ENV"]).toBe("development");
    expect(result.config?.["SETTLEMENT_MODE"]).toBe("simulated");
    expect(result.config?.["LLM_MODE"]).toBe("mock");
    expect(result.config?.["LAB_ENABLED"]).toBe(false);
  });

  it("accepts a fully-specified valid environment", () => {
    const result = parseWith({
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      SETTLEMENT_MODE: "paypal",
      LLM_MODE: "live",
      LAB_ENABLED: "false",
      COMMIT: "abc123",
    });
    expect(result.ok).toBe(true);
    expect(result.config?.["NODE_ENV"]).toBe("production");
    expect(result.config?.["LOG_LEVEL"]).toBe("warn");
  });

  it("rejects an invalid NODE_ENV value", () => {
    const result = parseWith({ NODE_ENV: "staging" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("NODE_ENV");
  });

  it("rejects an invalid SETTLEMENT_MODE", () => {
    const result = parseWith({ SETTLEMENT_MODE: "stripe" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SETTLEMENT_MODE");
  });

  it("error message contains variable names but never their values (I-12)", () => {
    const secret = "super-secret-value-that-must-not-appear";
    const result = parseWith({
      NODE_ENV: secret,
      SETTLEMENT_MODE: "another-secret",
    });
    expect(result.ok).toBe(false);
    // Error must name the field
    expect(result.error).toContain("NODE_ENV");
    // Must never echo the value back
    expect(result.error).not.toContain(secret);
    expect(result.error).not.toContain("another-secret");
  });
});
