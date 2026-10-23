"use client";

import { useEffect, useRef, useState } from "react";
import type { Failure, FailureCategory } from "./failure.js";
import type { Flow } from "./checkout-machine.js";

const TITLES: Record<FailureCategory, string> = {
  auth: "Sign-in required",
  denied: "Not approved",
  expired: "Mandate expired",
  consent: "Consent not recorded",
  passkey: "Passkey not used",
  provider: "Payment provider problem",
  assistant: "The shopping assistant is busy",
  stores: "We couldn't reach the stores",
  network: "Connection problem",
  validation: "Request rejected",
  unexpected: "Unexpected response",
};

/** Plain-language explanation shown above the technical detail for non-payment failures. */
function friendlyLead(failure: Failure): string | undefined {
  switch (failure.code) {
    case "RATE_LIMITED":
      return "Too many people are asking the AI right now. Nothing was charged. We'll try again for you in a moment.";
    case "AI_QUOTA_EXHAUSTED":
      return "The AI's daily allowance for this app is used up. Nothing was charged. It resets automatically, or the owner can enable billing in Google AI Studio.";
    case "AI_PROPOSAL_FAILED":
      return "The assistant couldn't find a good match this time. Try describing the item a little differently.";
    case "CATALOG_UNAVAILABLE":
      return "Live store search is unavailable right now. We never show made-up products, so please try again shortly.";
    default:
      return undefined;
  }
}

const AUTO_RETRY_SECONDS = 10;

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

  // Short rate limits clear on their own; count down and retry once automatically.
  const autoRetry = failure.code === "RATE_LIMITED" && failure.retryable && onRetry !== undefined;
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RETRY_SECONDS);
  useEffect(() => {
    if (!autoRetry) return;
    if (secondsLeft <= 0) {
      onRetry();
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [autoRetry, secondsLeft, onRetry]);

  const lead = friendlyLead(failure);
  const tone = failure.category === "denied" || failure.category === "expired" ? "breach" : "amber";
  return (
    <section className={`notice notice--${tone}`} role="alert" aria-labelledby="failure-heading">
      <h2 id="failure-heading" className="notice__title" tabIndex={-1} ref={heading}>
        {TITLES[failure.category]}
      </h2>
      {lead !== undefined && <p className="panel__text notice__lead">{lead}</p>}
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
            {autoRetry ? `Try again now (auto in ${secondsLeft}s)` : "Try again"}
          </button>
        )}
        <button type="button" className="btn" onClick={onReset}>
          {resetLabel}
        </button>
      </div>
    </section>
  );
}
