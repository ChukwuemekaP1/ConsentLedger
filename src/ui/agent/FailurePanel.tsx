"use client";

import { useEffect, useRef } from "react";
import type { Failure, FailureCategory } from "./failure.js";
import type { Flow } from "./checkout-machine.js";

const TITLES: Record<FailureCategory, string> = {
  auth: "Sign-in required",
  denied: "Not approved",
  expired: "Mandate expired",
  consent: "Consent not recorded",
  passkey: "Passkey not used",
  provider: "Payment provider problem",
  network: "Connection problem",
  validation: "Request rejected",
  unexpected: "Unexpected response",
};

/**
 * Says exactly what is and is not known about money after a failure.
 * It never implies success: unknown capture outcomes are called unconfirmed.
 */
export function outcomeNote(resume: Flow | undefined): string {
  if (resume?.stage === "checkout" && resume.step === "approved") {
    return "Payment status is unconfirmed. Check your PayPal activity before trying again.";
  }
  if (resume?.stage === "consented" || resume?.stage === "checkout") {
    return "Your passkey approval was recorded, but no payment has been confirmed.";
  }
  return "No consent was recorded and no payment was made.";
}

interface FailurePanelProps {
  readonly failure: Failure;
  readonly resume?: Flow | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly onReset: () => void;
  readonly resetLabel?: string;
  readonly showOutcome?: boolean;
}

export function FailurePanel(props: FailurePanelProps) {
  const {
    failure,
    resume,
    onRetry,
    onReset,
    resetLabel = "Start over",
    showOutcome = true,
  } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const tone = failure.category === "denied" || failure.category === "expired" ? "breach" : "amber";
  return (
    <section className={`notice notice--${tone}`} role="alert" aria-labelledby="failure-heading">
      <h2 id="failure-heading" className="notice__title" tabIndex={-1} ref={heading}>
        {TITLES[failure.category]}
      </h2>
      <p className="panel__text">{failure.detail}</p>
      {failure.reasons !== undefined && failure.reasons.length > 0 && (
        <ul className="notice__list" aria-label="Reason codes">
          {failure.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {showOutcome && <p className="panel__text">{outcomeNote(resume)}</p>}
      <p className="notice__code">
        Code: {failure.code}
        {failure.requestId !== undefined ? ` · Request ${failure.requestId}` : ""}
      </p>
      <div className="actions">
        {failure.retryable && onRetry !== undefined && (
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="btn" onClick={onReset}>
          {resetLabel}
        </button>
      </div>
    </section>
  );
}
