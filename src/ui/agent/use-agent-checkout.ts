"use client";

/**
 * Orchestrates the proposal -> consent -> order -> PayPal journey.
 *
 * All transitions go through the pure reducer in checkout-machine.ts. A synchronous
 * ref mirrors the latest state so two rapid clicks cannot both start an action:
 * the second sees the stage already advanced (or `inFlight` set) and returns.
 * Nothing here decides authorization; every outcome is whatever the server returned.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentApi } from "./api-client.js";
import type { PasskeyPort } from "./passkeys.js";
import {
  initialState,
  proposalOf,
  reduce,
  type CaptureView,
  type Event,
  type MachineState,
} from "./checkout-machine.js";
import type { Failure } from "./failure.js";
import { unsupportedPasskeyFailure } from "./passkeys.js";
import type { PolicyDocument } from "../../domain/policy/policy.js";

export const PROMPT_MAX_LENGTH = 500;
export const DISPLAY_NAME_MAX_LENGTH = 255;

export interface AgentCheckoutDeps {
  readonly api: AgentApi;
  readonly passkeys: PasskeyPort;
  readonly now: () => number;
}

export interface FieldErrors {
  readonly prompt?: string;
  readonly displayName?: string;
}

export interface AgentCheckout {
  readonly state: MachineState;
  readonly nowMs: number;
  readonly fieldErrors: FieldErrors;
  readonly setPrompt: (prompt: string) => void;
  readonly propose: (policy?: PolicyDocument, promptOverride?: string) => Promise<void>;
  readonly registerPasskey: (displayName: string) => Promise<void>;
  readonly signMandate: () => Promise<void>;
  readonly onPayPalApproved: () => Promise<void>;
  readonly onPayPalCancelled: () => void;
  readonly onPayPalError: (failure: Failure) => void;
  readonly simulateApproval: () => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly reset: () => void;
}

export function parseExpiry(expiresAt: string): number {
  const ms = Date.parse(expiresAt);
  // An unreadable expiry fails closed: treated as already expired.
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function useAgentCheckout(deps: AgentCheckoutDeps): AgentCheckout {
  const { api, passkeys, now } = deps;
  const [state, setState] = useState<MachineState>(initialState);
  const [nowMs, setNowMs] = useState<number>(() => now());
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const stateRef = useRef<MachineState>(initialState);
  const inFlight = useRef(false);
  const lastPolicy = useRef<PolicyDocument | undefined>(undefined);

  const send = useCallback((event: Event): void => {
    const next = reduce(stateRef.current, event);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  /** Runs `action` unless another action is already running. */
  const exclusive = useCallback(async (action: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await action();
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Expiry countdown. UX only: the server remains the authority on expiry.
  const stage = state.flow.stage;
  const expiresAt = proposalOf(state.flow)?.mandate.terms.validity.expiresAt;
  useEffect(() => {
    if (stage !== "review" && stage !== "signing" && stage !== "consented") return;
    const tick = (): void => {
      const current = now();
      setNowMs(current);
      if (
        stateRef.current.flow.stage === "review" &&
        expiresAt !== undefined &&
        current >= parseExpiry(expiresAt)
      ) {
        send({ type: "EXPIRED" });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [stage, expiresAt, now, send]);

  const setPrompt = useCallback(
    (prompt: string): void => {
      setFieldErrors(({ prompt: _cleared, ...rest }) => rest);
      send({ type: "PROMPT_EDITED", prompt });
    },
    [send],
  );

  const propose = useCallback(
    (policy?: PolicyDocument, promptOverride?: string) =>
      exclusive(async () => {
        const flow = stateRef.current.flow;
        if (flow.stage !== "compose") return;
        if (policy !== undefined) lastPolicy.current = policy;
        // A modal can submit a fully-formed request in the same tick it sets the prompt,
        // before React state has flushed; the override avoids proposing a stale prompt.
        const prompt = (promptOverride ?? flow.prompt).trim();
        if (prompt.length === 0) {
          setFieldErrors({ prompt: "Describe what you want the agent to buy." });
          return;
        }
        if (prompt.length > PROMPT_MAX_LENGTH) {
          setFieldErrors({ prompt: `Keep the request under ${PROMPT_MAX_LENGTH} characters.` });
          return;
        }
        setFieldErrors({});
        send({ type: "PROPOSE_STARTED" });
        const result = await api.propose(prompt, policy);
        if (!result.ok) {
          send({ type: "FAILED", failure: result.failure });
          return;
        }
        if (result.value.evaluation.decision !== "ALLOW") {
          send({
            type: "FAILED",
            failure: {
              category: "denied",
              code: "POLICY_DENIED",
              detail: "Policy did not allow this proposal.",
              reasons: result.value.evaluation.reasons,
              retryable: false,
            },
          });
          return;
        }
        send({
          type: "PROPOSAL_RECEIVED",
          proposal: {
            mandate: result.value.mandate,
            rationale: result.value.proposal.rationale,
            evaluation: result.value.evaluation,
            products: result.value.products,
          },
        });
      }),
    [api, exclusive, send],
  );

  const registerPasskey = useCallback(
    (displayName: string) =>
      exclusive(async () => {
        const flow = stateRef.current.flow;
        if (flow.stage !== "compose" && flow.stage !== "auth_required") return;
        const name = displayName.trim();
        if (name.length === 0) {
          setFieldErrors({
            displayName: "Enter a name for this passkey, for example your first name.",
          });
          return;
        }
        if (name.length > DISPLAY_NAME_MAX_LENGTH) {
          setFieldErrors({
            displayName: `Keep the name under ${DISPLAY_NAME_MAX_LENGTH} characters.`,
          });
          return;
        }
        if (!passkeys.isSupported()) {
          send({ type: "REGISTER_STARTED" });
          send({ type: "FAILED", failure: unsupportedPasskeyFailure() });
          return;
        }
        setFieldErrors({});
        send({ type: "REGISTER_STARTED" });
        const options = await api.requestRegistrationOptions(name);
        if (!options.ok) {
          send({ type: "FAILED", failure: options.failure });
          return;
        }
        send({ type: "REGISTER_STEP", step: "prompt" });
        const credential = await passkeys.register(options.value);
        if (!credential.ok) {
          send({ type: "FAILED", failure: credential.failure });
          return;
        }
        send({ type: "REGISTER_STEP", step: "verifying" });
        const verified = await api.verifyRegistration(credential.value, name);
        if (!verified.ok) {
          send({ type: "FAILED", failure: verified.failure });
          return;
        }
        send({ type: "REGISTER_SUCCEEDED" });
      }),
    [api, exclusive, passkeys, send],
  );

  const createOrder = useCallback(
    async (explicitMandateId?: string): Promise<void> => {
      const flow = stateRef.current.flow;
      const mandateId =
        explicitMandateId ??
        (flow.stage === "consented" ? flow.proposal.mandate.terms.id : undefined);
      if (!mandateId) return;
      send({ type: "ORDER_STARTED" });
      const result = await api.createOrder(mandateId);
      if (!result.ok) {
        send({ type: "FAILED", failure: result.failure });
        return;
      }
      send({ type: "ORDER_CREATED", order: { orderId: result.value.orderId } });
    },
    [api, send],
  );

  const signMandate = useCallback(
    () =>
      exclusive(async () => {
        const flow = stateRef.current.flow;
        if (flow.stage !== "review") return;
        const { terms, hash } = flow.proposal.mandate;
        if (now() >= parseExpiry(terms.validity.expiresAt)) {
          send({ type: "EXPIRED" });
          return;
        }
        if (!passkeys.isSupported()) {
          send({ type: "SIGN_STARTED" });
          send({ type: "FAILED", failure: unsupportedPasskeyFailure() });
          return;
        }
        send({ type: "SIGN_STARTED" });
        const options = await api.requestConsentOptions(terms.id);
        if (!options.ok) {
          send({ type: "FAILED", failure: options.failure });
          return;
        }
        send({ type: "SIGN_STEP", step: "prompt" });
        const assertion = await passkeys.authenticate(options.value);
        if (!assertion.ok) {
          send({ type: "FAILED", failure: assertion.failure });
          return;
        }
        send({ type: "SIGN_STEP", step: "verifying" });
        const verified = await api.verifyConsent(terms.id, assertion.value);
        if (!verified.ok) {
          send({ type: "FAILED", failure: verified.failure });
          return;
        }
        // Consistency check on the server's answer, not an authorization decision.
        if (verified.value.mandateHash !== hash || verified.value.mandateId !== terms.id) {
          send({
            type: "FAILED",
            failure: {
              category: "consent",
              code: "CONSENT_RESPONSE_MISMATCH",
              detail:
                "The server confirmed consent for a different mandate than the one shown. Nothing was approved.",
              retryable: false,
            },
          });
          return;
        }
        send({
          type: "CONSENT_VERIFIED",
          consent: {
            mandateHash: verified.value.mandateHash,
            credentialId: verified.value.credentialId,
            verifiedAt: verified.value.verifiedAt,
          },
        });
        await createOrder(terms.id);
      }),
    [api, createOrder, exclusive, now, passkeys, send],
  );

  const capture = useCallback(async (): Promise<void> => {
    const flow = stateRef.current.flow;
    if (flow.stage !== "checkout" || flow.step !== "approved") return;
    const { orderId } = flow.order;
    const mandateId = flow.proposal.mandate.terms.id;
    send({ type: "CAPTURE_STARTED" });
    const result = await api.captureOrder(orderId, mandateId);
    if (!result.ok) {
      send({ type: "FAILED", failure: result.failure });
      return;
    }
    const view: CaptureView = { status: result.value.status, captureId: result.value.captureId };
    if (view.status !== "COMPLETED" && view.status !== "PENDING") {
      send({
        type: "FAILED",
        failure: {
          category: "provider",
          code: "CAPTURE_NOT_COMPLETED",
          detail: `PayPal reported the capture as ${view.status}. No funds were taken by ConsentLedger.`,
          retryable: false,
        },
      });
      return;
    }
    send({ type: "CAPTURE_RESULT", capture: view });
  }, [api, send]);

  const onPayPalApproved = useCallback(
    () =>
      exclusive(async () => {
        if (stateRef.current.flow.stage !== "checkout" || stateRef.current.flow.step !== "ready") {
          return;
        }
        send({ type: "PAYPAL_APPROVED" });
        await capture();
      }),
    [capture, exclusive, send],
  );

  const onPayPalCancelled = useCallback((): void => send({ type: "PAYPAL_CANCELLED" }), [send]);
  const onPayPalError = useCallback(
    (failure: Failure): void => send({ type: "FAILED", failure }),
    [send],
  );

  const retry = useCallback(
    () =>
      exclusive(async () => {
        if (stateRef.current.flow.stage !== "failed" || !stateRef.current.flow.failure.retryable) {
          return;
        }
        send({ type: "RETRY" });
      }).then(async () => {
        // Re-run the action for the stage that was restored. Each action re-checks its own stage.
        const flow = stateRef.current.flow;
        switch (flow.stage) {
          case "compose":
            return propose(lastPolicy.current);
          case "review":
            return signMandate();
          case "consented":
            return exclusive(createOrder);
          case "checkout":
            return flow.step === "approved" ? exclusive(capture) : undefined;
          case "auth_required":
          case "registering":
          case "proposing":
          case "denied":
          case "signing":
          case "ordering":
          case "settled":
          case "expired":
          case "failed":
            return undefined;
          default: {
            const unreachable: never = flow;
            return unreachable;
          }
        }
      }),
    [capture, createOrder, exclusive, propose, send, signMandate],
  );

  const simulateApproval = onPayPalApproved;

  const reset = useCallback((): void => send({ type: "RESET" }), [send]);

  return {
    state,
    nowMs,
    fieldErrors,
    setPrompt,
    propose,
    registerPasskey,
    signMandate,
    onPayPalApproved,
    onPayPalCancelled,
    onPayPalError,
    simulateApproval,
    retry,
    reset,
  };
}
