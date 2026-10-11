/**
 * RFC 9457 application/problem+json builder.
 *
 * Every error response from the API uses this shape. The `code` field carries
 * a stable ReasonCode from the closed list in domain/shared/reason-codes.ts.
 * Unknown errors are masked — no messages, no stacks leak to the client.
 *
 * CODING.md §2: "The HTTP layer maps errors to RFC 9457 problem+json."
 * ARCHITECTURE.md §13: "Errors are application/problem+json with a stable code."
 */

import type { AppError } from "../../domain/shared/errors.js";
import type { ReasonCode } from "../../domain/shared/reason-codes.js";

/** RFC 9457 problem+json document with a ConsentLedger `code` extension. */
export interface ProblemDocument {
  /** A URI reference identifying the problem type. */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation for this specific occurrence. */
  detail: string;
  /** URI reference identifying this specific occurrence. */
  instance: string;
  /** Stable reason code. Part of the public API — never changes for a given error. */
  code: ReasonCode;
}

const PROBLEM_TYPE_BASE = "https://consentledger.dev/problems";

/** Map a ReasonCode to an HTTP status code. */
function statusFor(code: ReasonCode): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
    case "CONSENT_MISSING":
    case "CONSENT_INVALID":
    case "POLICY_DENIED":
    case "POLICY_DRIFT":
    case "AUTHORITY_SIGNATURE_INVALID":
    case "MERCHANT_SIGNATURE_INVALID":
    case "HASH_MISMATCH":
      return 403;
    case "MANDATE_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "MANDATE_REVOKED":
    case "MANDATE_EXPIRED":
    case "MANDATE_STATE_INVALID":
    case "REPLAY_DETECTED":
    case "BUDGET_EXCEEDED":
    case "TX_CAP_EXCEEDED":
    case "STEP_UP_REQUIRED":
    case "TERMS_MISMATCH":
    case "MERCHANT_NOT_ALLOWED":
    case "CURRENCY_NOT_ALLOWED":
    case "WEBHOOK_SIGNATURE_INVALID":
    case "WEBHOOK_DUPLICATE":
      return 422;
    case "PROVIDER_ERROR":
    case "PROVIDER_OUTCOME_UNKNOWN":
    case "RECONCILIATION_MISMATCH":
    case "INSUFFICIENT_EVIDENCE":
    case "INTERNAL":
      return 500;
    default: {
      // Exhaustive check — TypeScript ensures all codes are handled.
      const _exhaustive: never = code;
      void _exhaustive;
      return 500;
    }
  }
}

/** Short title for each code. */
function titleFor(code: ReasonCode): string {
  return code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a ProblemDocument from an AppError.
 * `instance` should be the request path, e.g. "/api/v1/mandates/123/execute".
 */
export function fromAppError(error: AppError, instance: string): ProblemDocument {
  const status = statusFor(error.code);
  return {
    type: `${PROBLEM_TYPE_BASE}/${error.code.toLowerCase().replace(/_/g, "-")}`,
    title: titleFor(error.code),
    status,
    detail: error.message,
    instance,
    code: error.code,
  };
}

/**
 * Build a ProblemDocument from an unknown thrown value.
 *
 * Unknown errors NEVER leak messages or stacks to the client.
 * The original error should be logged server-side before calling this.
 */
export function fromUnknown(instance: string): ProblemDocument {
  return {
    type: `${PROBLEM_TYPE_BASE}/internal`,
    title: "Internal Server Error",
    status: 500,
    detail: "An unexpected error occurred. Please try again later.",
    instance,
    code: "INTERNAL",
  };
}

/**
 * Serialise a ProblemDocument to a Next.js Response.
 * Sets Content-Type: application/problem+json and the correct status.
 */
export function toProblemResponse(problem: ProblemDocument): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "content-type": "application/problem+json; charset=utf-8",
    },
  });
}
