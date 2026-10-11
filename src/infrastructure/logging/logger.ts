/**
 * Application logger — pino with central redaction.
 *
 * Rules:
 *   - JSON output always. No pretty-print in production.
 *   - Every line carries at minimum: level, time, msg.
 *   - Request-scoped lines carry requestId and correlationId via child loggers.
 *   - Redaction list is in redact.ts — add fields there, not inline.
 *
 * CODING.md §8: "pino only. No console.* outside scripts."
 * INVARIANTS.md I-12: "Never log secrets."
 */

import pino from "pino";
import { REDACT_PATHS } from "./redact.js";

// Config is read here (infrastructure layer) — not in domain or application.
// We access LOG_LEVEL lazily to avoid a circular dependency with env.ts during
// module initialisation in tests that stub process.env.
function getLogLevel(): string {
  return process.env["LOG_LEVEL"] ?? "info";
}

export const logger = pino({
  level: getLogLevel(),
  redact: {
    paths: REDACT_PATHS as string[],
    censor: "[REDACTED]",
  },
  // Emit ISO timestamps for structured log aggregators.
  timestamp: pino.stdTimeFunctions.isoTime,
  // Log event objects with a stable shape: { event, ...fields }
  // formatters keep the shape consistent across pino versions.
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

/**
 * Create a child logger bound to a specific request and correlation context.
 * Every log line from this child will include requestId and correlationId.
 *
 * Usage (in an HTTP handler or use case):
 *   const log = childLogger({ requestId: id, correlationId: cid });
 *   log.info({ event: 'gate.passed', mandateId }, 'gate passed');
 */
export function childLogger(context: { requestId: string; correlationId?: string }): pino.Logger {
  return logger.child(context);
}
