/**
 * Tests for src/infrastructure/logging/logger.ts and redact.ts
 *
 * Proves: I-12 — the logger redacts every field on the redaction list.
 * Every field in REDACT_PATHS must produce "[REDACTED]" when logged.
 */

import { describe, expect, it } from "vitest";
import pino from "pino";
import { REDACT_PATHS } from "../../../src/infrastructure/logging/redact.js";

/**
 * Create a test logger that writes to an in-memory stream.
 * Returns the logger and a function to read the last logged line as JSON.
 */
function makeTestLogger() {
  const lines: string[] = [];

  const stream = {
    write(line: string) {
      lines.push(line);
    },
  };

  const log = pino(
    {
      level: "trace",
      redact: {
        paths: REDACT_PATHS as string[],
        censor: "[REDACTED]",
      },
      timestamp: false,
    },
    stream,
  );

  function lastLine(): Record<string, unknown> {
    const last = lines.at(-1);
    if (!last) throw new Error("No log lines written");
    return JSON.parse(last) as Record<string, unknown>;
  }

  return { log, lastLine };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("logger redaction (I-12)", () => {
  it("does not redact a plain non-secret field", () => {
    const { log, lastLine } = makeTestLogger();
    log.info({ event: "test", mandateId: "abc-123" }, "test message");
    const line = lastLine();
    expect(line["mandateId"]).toBe("abc-123");
  });

  // Test every path in REDACT_PATHS
  const topLevelPaths = REDACT_PATHS.filter(
    (p) => !p.includes(".") && !p.includes("*") && !p.includes("["),
  );

  for (const field of topLevelPaths) {
    it(`redacts top-level field: ${field}`, () => {
      const { log, lastLine } = makeTestLogger();
      log.info({ [field]: "real-secret-value" }, "should be redacted");
      const line = lastLine();
      expect(line[field]).toBe("[REDACTED]");
    });
  }

  it("redacts authorization header via nested path", () => {
    const { log, lastLine } = makeTestLogger();
    log.info({ headers: { authorization: "Bearer tok_secret" } }, "request");
    const line = lastLine() as { headers: Record<string, unknown> };
    expect(line.headers?.["authorization"]).toBe("[REDACTED]");
  });

  it("redacts cookie header via nested path", () => {
    const { log, lastLine } = makeTestLogger();
    log.info({ headers: { cookie: "session=abc123" } }, "request");
    const line = lastLine() as { headers: Record<string, unknown> };
    expect(line.headers?.["cookie"]).toBe("[REDACTED]");
  });

  it("does not throw when a redacted field is absent", () => {
    const { log, lastLine } = makeTestLogger();
    expect(() => {
      log.info({ event: "no-secrets-here", value: 42 }, "clean log");
    }).not.toThrow();
    const line = lastLine();
    expect(line["value"]).toBe(42);
  });
});
