/**
 * Failure model for the Agent surface.
 *
 * Every server problem or transport error is reduced to one of a small closed
 * set of categories so the UI can render a distinct, named state for each.
 * Unknown means failure, never success (I-11).
 */

export type FailureCategory =
  | "auth"
  | "denied"
  | "expired"
  | "consent"
  | "passkey"
  | "provider"
  /** The AI shopping assistant was busy, out of quota, or could not finish. Never a payment problem. */
  | "assistant"
  /** Real stores (Channel3) could not be reached; nothing was substituted. */
  | "stores"
  | "network"
  | "validation"
  | "unexpected";

export interface Failure {
  readonly category: FailureCategory;
  /** Stable server reason code, or a client-side code such as `NETWORK_ERROR`. */
  readonly code: string;
  readonly detail: string;
  readonly reasons?: readonly string[];
  readonly retryable: boolean;
  readonly requestId?: string;
}

const DENIED_CODES: ReadonlySet<string> = new Set([
  "POLICY_DENIED",
  "POLICY_DRIFT",
  "MERCHANT_NOT_ALLOWED",
  "CURRENCY_NOT_ALLOWED",
  "TX_CAP_EXCEEDED",
  "STEP_UP_REQUIRED",
  "BUDGET_EXCEEDED",
  "FORBIDDEN",
  "HASH_MISMATCH",
  "TERMS_MISMATCH",
  "MERCHANT_SIGNATURE_INVALID",
  "AUTHORITY_SIGNATURE_INVALID",
  "MANDATE_REVOKED",
  "MANDATE_NOT_FOUND",
]);

const CONSENT_RETRYABLE: ReadonlySet<string> = new Set(["CONSENT_INVALID", "REPLAY_DETECTED"]);

const PROVIDER_CODES: ReadonlySet<string> = new Set([
  "PROVIDER_ERROR",
  "PROVIDER_OUTCOME_UNKNOWN",
  "RECONCILIATION_MISMATCH",
  "INTERNAL",
]);

export interface ProblemInput {
  readonly status: number;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
  readonly reasons?: readonly string[] | undefined;
  readonly requestId?: string | undefined;
}

export function failureFromProblem(problem: ProblemInput): Failure {
  const base = {
    detail: problem.detail ?? "The server rejected the request.",
    ...(problem.reasons !== undefined ? { reasons: problem.reasons } : {}),
    ...(problem.requestId !== undefined ? { requestId: problem.requestId } : {}),
  };
  const code = problem.code ?? inferCode(problem);

  if (code === "UNAUTHENTICATED" || problem.status === 401) {
    return {
      ...base,
      category: "auth",
      code: "UNAUTHENTICATED",
      detail:
        problem.detail && problem.detail !== "The server rejected the request."
          ? problem.detail
          : "Registration Required: Register your device passkey first in Step 1 to approve.",
      retryable: false,
    };
  }
  if (code === "MANDATE_EXPIRED") {
    return { ...base, category: "expired", code, retryable: false };
  }
  if (DENIED_CODES.has(code)) {
    return { ...base, category: "denied", code, retryable: false };
  }
  if (
    code === "CONSENT_MISSING" ||
    code === "MANDATE_STATE_INVALID" ||
    CONSENT_RETRYABLE.has(code)
  ) {
    return { ...base, category: "consent", code, retryable: CONSENT_RETRYABLE.has(code) };
  }
  if (code === "RATE_LIMITED" || code === "AI_PROPOSAL_FAILED") {
    return { ...base, category: "assistant", code, retryable: true };
  }
  if (code === "AI_QUOTA_EXHAUSTED") {
    return { ...base, category: "assistant", code, retryable: false };
  }
  if (code === "CATALOG_UNAVAILABLE") {
    return { ...base, category: "stores", code, retryable: true };
  }
  if (PROVIDER_CODES.has(code) || problem.status >= 500) {
    return { ...base, category: "provider", code, retryable: true };
  }
  if (code === "VALIDATION_FAILED" || code === "NOT_FOUND") {
    return { ...base, category: "validation", code, retryable: false };
  }
  return { ...base, category: "unexpected", code, retryable: false };
}

/** Proposal endpoints return problem+json without `code` for policy denial and rate limiting. */
function inferCode(problem: ProblemInput): string {
  if (problem.status === 401) return "UNAUTHENTICATED";
  if (problem.status === 429) return "RATE_LIMITED";
  if (problem.status === 422 && problem.reasons !== undefined) return "POLICY_DENIED";
  if (problem.status === 502) return "PROVIDER_ERROR";
  return "UNEXPECTED_RESPONSE";
}

export function networkFailure(): Failure {
  return {
    category: "network",
    code: "NETWORK_ERROR",
    detail: "ConsentLedger could not be reached. Check your connection and try again.",
    retryable: true,
  };
}

export function malformedResponseFailure(): Failure {
  return {
    category: "unexpected",
    code: "MALFORMED_RESPONSE",
    detail: "The server response was not in the expected format, so it was not trusted.",
    retryable: false,
  };
}
