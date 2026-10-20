"use client";

/**
 * Agent surface: discover, review the mandate, sign with a passkey, then PayPal.
 *
 * Presentational glue over `useAgentCheckout`. Dependencies are injectable so the same
 * component runs against real endpoints in the browser and against fakes in tests.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createAgentApi, type AgentApi } from "./api-client.js";
import type { ClientConfig } from "./api-schemas.js";
import { browserPasskeys, type PasskeyPort } from "./passkeys.js";
import { paypalV6, type PayPalCheckoutPort } from "./paypal-v6.js";
import { CheckoutPanel } from "./CheckoutPanel.js";
import { FailurePanel } from "./FailurePanel.js";
import { MandateCard } from "./MandateCard.js";
import { StageRail } from "./StageRail.js";
import { formatMinorUnits } from "./format-money.js";
import { proposalOf, type Flow } from "./checkout-machine.js";
import { PROMPT_MAX_LENGTH, useAgentCheckout } from "./use-agent-checkout.js";

export interface AgentWorkbenchProps {
  readonly api?: AgentApi;
  readonly passkeys?: PasskeyPort;
  readonly paypal?: PayPalCheckoutPort;
  readonly now?: () => number;
}

const EXAMPLES = [
  "Buy a 75% mechanical keyboard",
  "Get $50 of cloud compute credits",
  "A keycap set and a wrist rest",
] as const;

export function announcement(flow: Flow): string {
  switch (flow.stage) {
    case "compose":
      return flow.notice === "PASSKEY_REGISTERED"
        ? "Passkey registered. You can now ask the agent."
        : "";
    case "registering":
      return "Registering your passkey.";
    case "auth_required":
      return "Sign-in required. Register a passkey to continue.";
    case "proposing":
      return "The agent is preparing a proposal.";
    case "denied":
      return "The proposal was not approved.";
    case "review":
      return "Proposal ready. Review the mandate before approving.";
    case "signing":
      return "Waiting for your passkey.";
    case "consented":
    case "ordering":
      return "Passkey consent verified. Creating the PayPal order.";
    case "checkout":
      return flow.step === "ready"
        ? "PayPal order created. Payment has not been approved yet."
        : "PayPal approval received. Capturing payment.";
    case "settled":
      return flow.capture.status === "COMPLETED"
        ? "Payment captured and confirmed by the server."
        : "Payment is pending at PayPal.";
    case "expired":
      return "The mandate has expired.";
    case "failed":
      return `Problem: ${flow.failure.detail}`;
    default: {
      const unreachable: never = flow;
      return unreachable;
    }
  }
}

function catalogLabel(config: ClientConfig | undefined): string {
  if (config === undefined) return "Source not yet loaded";
  return config.catalogMode === "fixture"
    ? "DEMO DATA: deterministic fixture catalog, not live products"
    : "Live product catalog (Channel3)";
}

export function AgentWorkbench(props: AgentWorkbenchProps) {
  const api = useMemo(() => props.api ?? createAgentApi((i, init) => fetch(i, init)), [props.api]);
  const passkeys = props.passkeys ?? browserPasskeys;
  const paypal = props.paypal ?? paypalV6;
  const now = useMemo(() => props.now ?? (() => Date.now()), [props.now]);

  const checkout = useAgentCheckout({ api, passkeys, now });
  const { state, nowMs, fieldErrors } = checkout;
  const flow = state.flow;

  const [config, setConfig] = useState<ClientConfig | undefined>(undefined);
  const [configError, setConfigError] = useState(false);
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api.getClientConfig().then((result) => {
      if (cancelled) return;
      if (result.ok) setConfig(result.value);
      else setConfigError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (flow.stage === "review") reviewHeading.current?.focus();
  }, [flow.stage]);

  // While a failure is shown, the mandate card keeps showing the stage the user was in.
  const context = flow.stage === "failed" ? flow.resume : flow;
  const proposal = proposalOf(context);
  const busy =
    flow.stage === "proposing" ||
    flow.stage === "registering" ||
    flow.stage === "signing" ||
    flow.stage === "ordering";

  const onSubmitPrompt = (event: FormEvent): void => {
    event.preventDefault();
    void checkout.propose();
  };
  const onSubmitRegistration = (event: FormEvent): void => {
    event.preventDefault();
    void checkout.registerPasskey(displayName);
  };

  const signature =
    context.stage === "signing"
      ? ("signing" as const)
      : "consent" in context
        ? ("signed" as const)
        : ("unsigned" as const);

  const showCompose = flow.stage === "compose" || flow.stage === "auth_required";

  return (
    <main className="wb">
      <div className="wb-shell">
        <header className="wb-header">
          <div>
            <h1 className="wb-title">ConsentLedger · Agent</h1>
            <p className="wb-subtitle">
              The agent proposes. You sign with a passkey. PayPal settles.
            </p>
          </div>
          <ul className="wb-badges" aria-label="Environment">
            {config?.catalogMode === "fixture" && <li className="badge badge--amber">Demo data</li>}
            {config?.settlementMode === "simulated" && (
              <li className="badge badge--amber">Simulated settlement</li>
            )}
            {config?.settlementMode === "paypal" && config.environment === "sandbox" && (
              <li className="badge badge--link">PayPal Sandbox</li>
            )}
            {config === undefined && configError && (
              <li className="badge badge--breach">Config unavailable</li>
            )}
            {state.passkeyRegistered && <li className="badge badge--seal">Passkey registered</li>}
          </ul>
        </header>

        <StageRail flow={flow} />

        <div className="wb-grid">
          <div className="wb-left" style={{ display: "grid", gap: 16 }}>
            {flow.stage === "auth_required" && (
              <section className="notice notice--amber" role="alert">
                <h2 className="notice__title">Sign-in required</h2>
                <p className="panel__text">
                  There is no active ConsentLedger session. Register a passkey below to start one,
                  then ask the agent again.
                </p>
              </section>
            )}

            {showCompose && (
              <>
                <section className="panel" aria-labelledby="passkey-heading">
                  <h2 id="passkey-heading" className="panel__title">
                    1. Passkey
                  </h2>
                  <p className="panel__text">
                    Register a passkey on this device. It starts your session and is what you will
                    sign mandates with.
                  </p>
                  <form
                    onSubmit={onSubmitRegistration}
                    noValidate
                    style={{ display: "grid", gap: 12 }}
                  >
                    <div className="field">
                      <label className="field__label" htmlFor="display-name">
                        Name for this passkey
                      </label>
                      <input
                        id="display-name"
                        className="input"
                        value={displayName}
                        autoComplete="off"
                        aria-invalid={fieldErrors.displayName !== undefined}
                        aria-describedby={
                          fieldErrors.displayName !== undefined ? "display-name-error" : undefined
                        }
                        onChange={(e) => setDisplayName(e.target.value)}
                      />
                      {fieldErrors.displayName !== undefined && (
                        <p id="display-name-error" className="field__error" role="alert">
                          {fieldErrors.displayName}
                        </p>
                      )}
                    </div>
                    <div className="actions">
                      <button type="submit" className="btn" disabled={busy}>
                        Register passkey
                      </button>
                    </div>
                  </form>
                  {flow.stage === "compose" && flow.notice === "PASSKEY_REGISTERED" && (
                    <p className="notice notice--seal" role="status">
                      Passkey registered and session started by the server.
                    </p>
                  )}
                </section>

                <section className="panel" aria-labelledby="request-heading">
                  <h2 id="request-heading" className="panel__title">
                    2. Ask the agent
                  </h2>
                  <form onSubmit={onSubmitPrompt} noValidate style={{ display: "grid", gap: 12 }}>
                    <div className="field">
                      <label className="field__label" htmlFor="prompt">
                        What should the agent buy?
                      </label>
                      <textarea
                        id="prompt"
                        className="input"
                        value={flow.prompt}
                        maxLength={PROMPT_MAX_LENGTH}
                        aria-invalid={fieldErrors.prompt !== undefined}
                        aria-describedby={
                          fieldErrors.prompt !== undefined ? "prompt-error" : "prompt-hint"
                        }
                        onChange={(e) => checkout.setPrompt(e.target.value)}
                      />
                      <p id="prompt-hint" className="field__hint">
                        The agent can only propose. It cannot approve or pay.
                      </p>
                      {fieldErrors.prompt !== undefined && (
                        <p id="prompt-error" className="field__error" role="alert">
                          {fieldErrors.prompt}
                        </p>
                      )}
                    </div>
                    <ul className="chips" aria-label="Example requests">
                      {EXAMPLES.map((example) => (
                        <li key={example}>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => checkout.setPrompt(example)}
                          >
                            {example}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="actions">
                      <button type="submit" className="btn btn--primary" disabled={busy}>
                        Ask the agent
                      </button>
                    </div>
                  </form>
                </section>
              </>
            )}

            {flow.stage === "registering" && (
              <section className="panel" aria-labelledby="registering-heading">
                <h2 id="registering-heading" className="panel__title">
                  Registering passkey
                </h2>
                <p className="progress" role="status">
                  <span className="spinner" aria-hidden="true" />
                  {flow.step === "options" && "Requesting registration options…"}
                  {flow.step === "prompt" && "Follow your browser's passkey prompt."}
                  {flow.step === "verifying" && "ConsentLedger is verifying your new passkey…"}
                </p>
              </section>
            )}

            {flow.stage === "proposing" && (
              <section className="panel" aria-labelledby="proposing-heading">
                <h2 id="proposing-heading" className="panel__title">
                  The agent is working
                </h2>
                <p className="progress" role="status">
                  <span className="spinner" aria-hidden="true" />
                  Searching the catalog and drafting a proposal for “{flow.prompt.trim()}”…
                </p>
              </section>
            )}

            {flow.stage === "review" && (
              <section className="panel" aria-labelledby="review-heading">
                <h2 id="review-heading" className="panel__title" tabIndex={-1} ref={reviewHeading}>
                  Review, then approve with your passkey
                </h2>
                <p className="panel__text">
                  The paper mandate shows the exact terms. Approving binds your passkey to this
                  mandate and nothing else. <strong>No payment happens at this step.</strong>
                </p>
                <p className="panel__text">
                  Total to approve:{" "}
                  <strong>
                    {formatMinorUnits(
                      flow.proposal.mandate.terms.payment.amountMinor,
                      flow.proposal.mandate.terms.payment.currency,
                    )}
                  </strong>
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void checkout.signMandate()}
                  >
                    Approve with passkey
                  </button>
                  <button type="button" className="btn" onClick={checkout.reset}>
                    Discard proposal
                  </button>
                </div>
              </section>
            )}

            {flow.stage === "signing" && (
              <section className="panel" aria-labelledby="signing-heading">
                <h2 id="signing-heading" className="panel__title">
                  Waiting for your passkey
                </h2>
                <p className="progress" role="status">
                  <span className="spinner" aria-hidden="true" />
                  {flow.step === "options" && "Requesting a challenge bound to this mandate…"}
                  {flow.step === "prompt" && "Touch your authenticator to approve this mandate."}
                  {flow.step === "verifying" && "ConsentLedger is verifying your signature…"}
                </p>
                <p className="panel__text">Consent is not recorded until the server confirms it.</p>
              </section>
            )}

            {(flow.stage === "consented" || flow.stage === "ordering") && (
              <section className="panel" aria-labelledby="ordering-heading">
                <h2 id="ordering-heading" className="panel__title">
                  Passkey consent verified
                </h2>
                <p className="progress" role="status">
                  <span className="spinner" aria-hidden="true" />
                  Creating the PayPal order from the signed mandate…
                </p>
              </section>
            )}

            {flow.stage === "checkout" && (
              <CheckoutPanel
                flow={flow}
                config={config}
                configError={configError}
                paypal={paypal}
                onApproved={() => void checkout.onPayPalApproved()}
                onCancelled={checkout.onPayPalCancelled}
                onError={checkout.onPayPalError}
                onSimulatedApproval={() => void checkout.simulateApproval()}
              />
            )}

            {flow.stage === "settled" && (
              <section className="panel" aria-labelledby="settled-heading">
                <h2 id="settled-heading" className="panel__title">
                  {flow.capture.status === "COMPLETED"
                    ? "Payment captured"
                    : "Payment pending at PayPal"}
                </h2>
                <p className="panel__text">
                  {flow.capture.status === "COMPLETED"
                    ? "ConsentLedger confirmed the capture with PayPal."
                    : "PayPal has not finished processing this payment. It is not complete yet."}
                </p>
                <dl className="mandate__facts" style={{ color: "var(--text)" }}>
                  <dt>PayPal order</dt>
                  <dd className="mono">{flow.order.orderId}</dd>
                  {flow.capture.captureId !== undefined && (
                    <>
                      <dt>Capture</dt>
                      <dd className="mono">{flow.capture.captureId}</dd>
                    </>
                  )}
                  <dt>Status</dt>
                  <dd>{flow.capture.status}</dd>
                </dl>
                <div className="actions">
                  <button type="button" className="btn btn--primary" onClick={checkout.reset}>
                    Start another request
                  </button>
                </div>
              </section>
            )}

            {flow.stage === "denied" && (
              <FailurePanel
                failure={flow.failure}
                resume={flow}
                onReset={checkout.reset}
                resetLabel="Change the request"
              />
            )}

            {flow.stage === "expired" && (
              <FailurePanel
                failure={{
                  category: "expired",
                  code: "MANDATE_EXPIRED",
                  detail:
                    "This mandate passed its expiry time, so it can no longer be approved or paid.",
                  retryable: false,
                }}
                resume={flow}
                onReset={checkout.reset}
                resetLabel="Request a new proposal"
              />
            )}

            {flow.stage === "failed" && (
              <FailurePanel
                failure={flow.failure}
                resume={flow.resume}
                onRetry={() => void checkout.retry()}
                onReset={checkout.reset}
              />
            )}
          </div>

          <div className="wb-right">
            {proposal !== undefined ? (
              <MandateCard
                proposal={proposal}
                consent={"consent" in context ? context.consent : undefined}
                signature={signature}
                signingStep={context.stage === "signing" ? context.step : undefined}
                consentFailed={flow.stage === "failed" && flow.failure.category === "consent"}
                nowMs={nowMs}
                catalogLabel={catalogLabel(config)}
              />
            ) : (
              <section className="mandate mandate--empty" aria-labelledby="empty-mandate">
                <h2 id="empty-mandate" className="panel__title">
                  No mandate yet
                </h2>
                <p>
                  When the agent makes a proposal, the exact terms you would approve appear here on
                  paper: merchant, items, quantity, total, currency, policy status and expiry.
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="sr-only" role="status" aria-live="polite">
          {announcement(flow)}
        </div>
      </div>
    </main>
  );
}
