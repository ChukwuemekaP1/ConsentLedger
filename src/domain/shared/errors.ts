/**
 * AppError — the typed error value for domain and application failures.
 *
 * AppError is a plain object (not a class) — it is a value, not an exception.
 * It carries a stable ReasonCode so the HTTP layer can map it to RFC 9457
 * problem+json without any string matching.
 *
 * CODING.md §2: "Expected failures are values."
 */

import type { ReasonCode } from "./reason-codes.js";

export interface AppError {
  /** Stable code from the closed reason-code list. Part of the public API. */
  readonly code: ReasonCode;

  /** Human-readable message. Never include secrets, stack traces, or raw DB errors. */
  readonly message: string;

  /**
   * Structured details for debugging. Optional.
   * Must never contain secrets, keys, or raw provider responses.
   */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Construct an AppError. */
export function appError(
  code: ReasonCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AppError {
  return details !== undefined ? { code, message, details } : { code, message };
}
