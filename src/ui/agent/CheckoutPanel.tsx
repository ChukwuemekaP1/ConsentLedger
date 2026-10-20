"use client";

import { useEffect, useRef, useState } from "react";
import type { Flow } from "./checkout-machine.js";
import type { ClientConfig } from "./api-schemas.js";
import type { Failure } from "./failure.js";
import type { PayPalCheckoutPort } from "./paypal-v6.js";
import { formatMinorUnits } from "./format-money.js";

type CheckoutFlow = Extract<Flow, { stage: "checkout" }>;

export interface CheckoutPanelProps {
  readonly flow: CheckoutFlow;
  readonly config: ClientConfig | undefined;
  readonly configError: boolean;
  readonly paypal: PayPalCheckoutPort;
  readonly onApproved: () => void;
  readonly onCancelled: () => void;
  readonly onError: (failure: Failure) => void;
  readonly onSimulatedApproval: () => void;
}

/**
 * PayPal buyer approval. This is a different act from the ConsentLedger passkey step above it:
 * the passkey authorised the mandate; here PayPal asks the buyer to fund this order.
 */
export function CheckoutPanel(props: CheckoutPanelProps) {
  const { flow, config, paypal, onApproved, onCancelled, onError } = props;
  const slot = useRef<HTMLDivElement>(null);
  const [mounting, setMounting] = useState(false);
  const { terms } = flow.proposal.mandate;
  const amount = formatMinorUnits(terms.payment.amountMinor, terms.payment.currency);
  const ready = flow.step === "ready";
  const live = config?.settlementMode === "paypal";
  const orderId = flow.order.orderId;

  useEffect(() => {
    const container = slot.current;
    if (!ready || !live || container === null) return;
    if (config.clientId.length === 0) {
      onError({
        category: "provider",
        code: "PAYPAL_CLIENT_ID_MISSING",
        detail: "PayPal checkout is not configured on this server. No payment was taken.",
        retryable: false,
      });
      return;
    }
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setMounting(true);
    void paypal
      .mount({
        environment: config.environment,
        clientId: config.clientId,
        orderId,
        container,
        onApprove: onApproved,
        onCancel: onCancelled,
        onError,
      })
      .then((result) => {
        if (cancelled) {
          if (result.ok) result.dispose();
          return;
        }
        setMounting(false);
        if (result.ok) {
          dispose = result.dispose;
        } else {
          onError(result.failure);
        }
      });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [ready, live, config, orderId, paypal, onApproved, onCancelled, onError]);

  return (
    <section className="panel" aria-labelledby="checkout-heading">
      <h2 id="checkout-heading" className="panel__title">
        PayPal order created
      </h2>
      <p className="panel__text">
        <strong>Your passkey approval is recorded.</strong> Money has not moved. PayPal now asks
        you, as the buyer, to approve paying <strong>{amount}</strong> to {terms.payee.displayName}.
        This is separate from the ConsentLedger passkey step.
      </p>
      <p className="panel__text">
        PayPal order <span className="mono">{orderId}</span>
        {config?.environment === "sandbox" ? " (Sandbox)" : ""}
      </p>

      {flow.notice === "PAYPAL_CANCELLED" && (
        <p className="notice notice--amber" role="status">
          You closed PayPal without approving. Nothing was captured. You can open PayPal again.
        </p>
      )}

      {ready && live && (
        <div className="paypal-slot">
          {mounting && (
            <p className="progress" role="status">
              <span className="spinner" aria-hidden="true" /> Loading PayPal checkout…
            </p>
          )}
          <div ref={slot} />
        </div>
      )}

      {ready && !live && config !== undefined && (
        <div className="paypal-slot">
          <p className="badge badge--amber">Simulated settlement</p>
          <p className="panel__text">
            This server is not connected to PayPal. The button below only asks the server to settle
            against its built-in simulator; no PayPal buyer approval takes place and no real or
            Sandbox funds move.
          </p>
          <button type="button" className="btn btn--primary" onClick={props.onSimulatedApproval}>
            Settle with simulator
          </button>
        </div>
      )}

      {ready && config === undefined && (
        <p className="notice notice--amber" role="status">
          {props.configError
            ? "PayPal configuration could not be loaded. Reload the page to retry. No payment was taken."
            : "Loading PayPal configuration…"}
        </p>
      )}

      {flow.step === "approved" && (
        <p className="progress" role="status">
          <span className="spinner" aria-hidden="true" /> PayPal approval received. Waiting for
          ConsentLedger to capture the payment…
        </p>
      )}
      {flow.step === "capturing" && (
        <p className="progress" role="status">
          <span className="spinner" aria-hidden="true" /> Capturing payment. This is not complete
          until the server confirms it.
        </p>
      )}
    </section>
  );
}
