"use client";

/**
 * The Mandate Card: the one paper-coloured object on the dark workbench.
 *
 * It renders the server-issued mandate verbatim: merchant, items, quantity, total,
 * currency, policy status and expiry. Values come from the parsed server response
 * and are shown for the human to inspect; they are never sent back as payment
 * terms. Provenance and seal checks reflect only what the server reported.
 */

import { useState } from "react";
import type { ConsentView, ProposalView } from "./checkout-machine.js";
import { formatMinorUnits } from "./format-money.js";
import { parseExpiry } from "./use-agent-checkout.js";
import { Seal, type SealCheck } from "./Seal.js";

export type SignatureState = "unsigned" | "signing" | "signed";

export interface MandateCardProps {
  readonly proposal: ProposalView;
  readonly consent?: ConsentView | undefined;
  readonly signature: SignatureState;
  readonly signingStep?: "options" | "prompt" | "verifying" | undefined;
  readonly consentFailed?: boolean | undefined;
  readonly nowMs: number;
  readonly catalogLabel: string;
}

export function shortHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function formatCountdown(remainingMs: number): string {
  if (remainingMs <= 0) return "Expired";
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")} left`;
}

const SIGNING_TEXT = {
  options: "Requesting a challenge bound to this mandate…",
  prompt: "Touch your authenticator",
  verifying: "ConsentLedger is verifying your signature…",
} as const;

export function MandateCard(props: MandateCardProps) {
  const { proposal, consent, signature, signingStep, nowMs, consentFailed } = props;
  const { terms, hash, attestations, status } = proposal.mandate;
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  const lineTotal = terms.items.reduce(
    (sum, item) => sum + item.quantity * item.unitAmountMinor,
    0,
  );
  const totalsMatch = lineTotal === terms.payment.amountMinor;
  const allowed = proposal.evaluation.decision === "ALLOW";
  const remaining = parseExpiry(terms.validity.expiresAt) - nowMs;

  const checks: SealCheck[] = [
    {
      id: "authority",
      label: "Authority attestation issued",
      state: attestations.some((a) => a.role === "AUTHORITY") ? "pass" : "fail",
    },
    { id: "policy", label: "Policy allows this purchase", state: allowed ? "pass" : "fail" },
    {
      id: "consent",
      label: "Passkey consent verified by ConsentLedger",
      state: consent ? "pass" : consentFailed ? "fail" : "pending",
    },
  ];

  const copyHash = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <article className="mandate" aria-labelledby="mandate-heading">
      <header className="mandate__header">
        <div>
          <p className="mandate__kind">{terms.kind} mandate</p>
          <h2 id="mandate-heading" className="mandate__payee">
            {terms.payee.displayName}
          </h2>
          <p className="mandate__meta">
            Merchant ID <span className="mono">{terms.payee.merchantId}</span>
          </p>
        </div>
        <div>
          <p className={`paper-badge ${allowed ? "paper-badge--ok" : "paper-badge--bad"}`}>
            Policy: {allowed ? "Allowed" : "Denied"}
          </p>
          <p className="mandate__meta" role="timer" aria-label="Time until mandate expires">
            {formatCountdown(remaining)}
          </p>
        </div>
      </header>

      <table className="mandate__items">
        <caption>Items</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Qty
            </th>
            <th scope="col" className="num">
              Unit
            </th>
            <th scope="col" className="num">
              Line
            </th>
          </tr>
        </thead>
        <tbody>
          {terms.items.map((item) => (
            <tr key={item.sku}>
              <th scope="row">
                {item.description}
                <br />
                <span className="mono mandate__meta">SKU {item.sku}</span>
              </th>
              <td className="num">{item.quantity}</td>
              <td className="num">
                {formatMinorUnits(item.unitAmountMinor, terms.payment.currency)}
              </td>
              <td className="num">
                {formatMinorUnits(item.quantity * item.unitAmountMinor, terms.payment.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!totalsMatch && (
        <p className="mandate__warning" role="alert">
          The line items do not add up to the signed total. Do not approve this mandate.
        </p>
      )}

      <div className="mandate__total">
        <span>Total · {terms.payment.currency}</span>
        <strong className="mandate__amount" data-testid="mandate-total">
          {formatMinorUnits(terms.payment.amountMinor, terms.payment.currency)}
        </strong>
      </div>

      <blockquote className="mandate__quote">
        <span className="sr-only">Your request as the agent understood it: </span>“
        {terms.promptPlayback}”
      </blockquote>

      <dl className="mandate__facts">
        <dt>Agent</dt>
        <dd>
          <span className="mono">{terms.agent.id}</span> · {terms.agent.model}
        </dd>
        <dt>Catalog</dt>
        <dd>{props.catalogLabel}</dd>
        <dt>Expires</dt>
        <dd>
          <time dateTime={terms.validity.expiresAt}>{terms.validity.expiresAt}</time>
        </dd>
        <dt>Status</dt>
        <dd>{status}</dd>
        <dt>Attested by</dt>
        <dd>
          {attestations.length === 0
            ? "No attestation"
            : attestations.map((a) => `${a.role} (${a.keyId})`).join(", ")}
        </dd>
        <dt>Agent rationale</dt>
        <dd>{proposal.rationale} (not part of the signed terms)</dd>
      </dl>

      {proposal.evaluation.reasons.length > 0 && (
        <p className="mandate__meta">Policy notes: {proposal.evaluation.reasons.join(", ")}</p>
      )}

      <div className="mandate__hash">
        <span>Mandate hash</span>
        <code className="mono" title={hash}>
          {shortHash(hash)}
        </code>
        <button type="button" className="paper-btn" onClick={() => void copyHash()}>
          Copy full hash
        </button>
        <span className="mandate__meta" role="status">
          {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : ""}
        </span>
      </div>
      <details>
        <summary>Show full hash</summary>
        <code className="mono">{hash}</code>
      </details>

      <section className="signature" data-state={signature} aria-label="Signature block">
        <Seal checks={checks} />
        <div>
          {signature === "unsigned" && (
            <>
              <p className="signature__label">Unsigned</p>
              <p className="signature__detail">
                Signing with your passkey approves exactly the terms above.
              </p>
            </>
          )}
          {signature === "signing" && (
            <>
              <p className="signature__label">Signing</p>
              <p className="signature__detail">{SIGNING_TEXT[signingStep ?? "options"]}</p>
            </>
          )}
          {signature === "signed" && consent && (
            <>
              <p className="signature__label">Signed with passkey</p>
              <p className="signature__detail">
                Credential <span className="mono">{shortHash(consent.credentialId)}</span> ·{" "}
                <time dateTime={consent.verifiedAt}>{consent.verifiedAt}</time>
              </p>
            </>
          )}
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.id} data-state={c.state}>
                {c.label}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </article>
  );
}
