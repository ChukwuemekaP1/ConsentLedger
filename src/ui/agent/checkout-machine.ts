/**
 * Agent checkout state machine.
 *
 * A pure reducer. Each stage can be entered only from the stage before it, so the
 * browser cannot skip proposal review, passkey consent or order creation, and a
 * second event for a stage that has already advanced is ignored (repeat clicks
 * are no-ops). The machine only records what the server has told us; it never
 * decides authorization (policy, Gate and consent verification stay server-side).
 *
 * Stage order:
 *   compose -> proposing -> review -> signing -> consented -> ordering -> checkout -> settled
 * Side stages: registering, auth_required, denied, expired, failed.
 */

import type { Failure } from "./failure.js";
import type { ProposalResponse } from "./api-schemas.js";

export interface ProposalView {
  readonly mandate: ProposalResponse["mandate"];
  readonly rationale: string;
  readonly evaluation: ProposalResponse["evaluation"];
}

export interface ConsentView {
  readonly mandateHash: string;
  readonly credentialId: string;
  readonly verifiedAt: string;
}

export interface OrderView {
  readonly orderId: string;
}

export interface CaptureView {
  readonly status: string;
  readonly captureId?: string | undefined;
}

export type CeremonyStep = "options" | "prompt" | "verifying";

export type Flow =
  | { readonly stage: "compose"; readonly prompt: string; readonly notice?: "PASSKEY_REGISTERED" }
  | { readonly stage: "registering"; readonly step: CeremonyStep; readonly prompt: string }
  | { readonly stage: "auth_required"; readonly prompt: string }
  | { readonly stage: "proposing"; readonly prompt: string }
  | {
      readonly stage: "denied";
      readonly failure: Failure;
      readonly prompt: string;
      readonly proposal?: ProposalView;
    }
  | { readonly stage: "review"; readonly prompt: string; readonly proposal: ProposalView }
  | {
      readonly stage: "signing";
      readonly step: CeremonyStep;
      readonly prompt: string;
      readonly proposal: ProposalView;
    }
  | {
      /** The server verified the passkey assertion; no PayPal order exists yet. */
      readonly stage: "consented";
      readonly prompt: string;
      readonly proposal: ProposalView;
      readonly consent: ConsentView;
    }
  | {
      readonly stage: "ordering";
      readonly prompt: string;
      readonly proposal: ProposalView;
      readonly consent: ConsentView;
    }
  | {
      readonly stage: "checkout";
      readonly step: "ready" | "approved" | "capturing";
      readonly notice?: "PAYPAL_CANCELLED";
      readonly prompt: string;
      readonly proposal: ProposalView;
      readonly consent: ConsentView;
      readonly order: OrderView;
    }
  | {
      readonly stage: "settled";
      readonly prompt: string;
      readonly proposal: ProposalView;
      readonly consent: ConsentView;
      readonly order: OrderView;
      readonly capture: CaptureView;
    }
  | { readonly stage: "expired"; readonly prompt: string; readonly proposal: ProposalView }
  | {
      readonly stage: "failed";
      readonly failure: Failure;
      /** Stable stage to return to when the user chooses to retry. */
      readonly resume: Flow;
    };

export interface MachineState {
  readonly flow: Flow;
  readonly passkeyRegistered: boolean;
}

export type Event =
  | { readonly type: "PROMPT_EDITED"; readonly prompt: string }
  | { readonly type: "REGISTER_STARTED" }
  | { readonly type: "REGISTER_STEP"; readonly step: CeremonyStep }
  | { readonly type: "REGISTER_SUCCEEDED" }
  | { readonly type: "PROPOSE_STARTED" }
  | { readonly type: "PROPOSAL_RECEIVED"; readonly proposal: ProposalView }
  | { readonly type: "SIGN_STARTED" }
  | { readonly type: "SIGN_STEP"; readonly step: CeremonyStep }
  | { readonly type: "CONSENT_VERIFIED"; readonly consent: ConsentView }
  | { readonly type: "ORDER_STARTED" }
  | { readonly type: "ORDER_CREATED"; readonly order: OrderView }
  | { readonly type: "PAYPAL_APPROVED" }
  | { readonly type: "PAYPAL_CANCELLED" }
  | { readonly type: "CAPTURE_STARTED" }
  | { readonly type: "CAPTURE_RESULT"; readonly capture: CaptureView }
  | { readonly type: "EXPIRED" }
  | { readonly type: "FAILED"; readonly failure: Failure }
  | { readonly type: "RETRY" }
  | { readonly type: "RESET" };

export const initialState: MachineState = {
  flow: { stage: "compose", prompt: "" },
  passkeyRegistered: false,
};

function promptOf(flow: Flow): string {
  return flow.stage === "failed" ? promptOf(flow.resume) : flow.prompt;
}

export function proposalOf(flow: Flow): ProposalView | undefined {
  return "proposal" in flow ? flow.proposal : undefined;
}

/** Where a failure is shown, derived from what the user was doing and what the server said. */
function failFrom(flow: Flow, failure: Failure): Flow {
  switch (failure.category) {
    case "auth":
      return { stage: "auth_required", prompt: promptOf(flow) };
    case "expired": {
      const proposal = proposalOf(flow);
      return proposal !== undefined
        ? { stage: "expired", prompt: promptOf(flow), proposal }
        : { stage: "failed", failure, resume: resumeTarget(flow) };
    }
    case "denied": {
      const proposal = proposalOf(flow);
      return {
        stage: "denied",
        failure,
        prompt: promptOf(flow),
        ...(proposal !== undefined ? { proposal } : {}),
      };
    }
    case "passkey":
    case "consent":
    case "provider":
    case "network":
    case "validation":
    case "unexpected":
      return { stage: "failed", failure, resume: resumeTarget(flow) };
    default: {
      const unreachable: never = failure.category;
      return unreachable;
    }
  }
}

/** The stable stage that a retry returns to (never a transient in-flight stage). */
function resumeTarget(flow: Flow): Flow {
  switch (flow.stage) {
    case "registering":
      return { stage: "auth_required", prompt: flow.prompt };
    case "proposing":
      return { stage: "compose", prompt: flow.prompt };
    case "signing":
      return { stage: "review", prompt: flow.prompt, proposal: flow.proposal };
    case "ordering":
      return { ...flow, stage: "consented" };
    case "checkout":
      return flow.step === "capturing" ? { ...flow, step: "approved" } : flow;
    case "consented":
    case "compose":
    case "auth_required":
    case "denied":
    case "review":
    case "settled":
    case "expired":
    case "failed":
      return flow;
    default: {
      const unreachable: never = flow;
      return unreachable;
    }
  }
}

function transition(flow: Flow, event: Event): Flow {
  switch (event.type) {
    case "PROMPT_EDITED":
      return flow.stage === "compose" || flow.stage === "auth_required"
        ? { stage: "compose", prompt: event.prompt }
        : flow;
    case "REGISTER_STARTED":
      return flow.stage === "compose" || flow.stage === "auth_required"
        ? { stage: "registering", step: "options", prompt: flow.prompt }
        : flow;
    case "REGISTER_STEP":
      return flow.stage === "registering" ? { ...flow, step: event.step } : flow;
    case "REGISTER_SUCCEEDED":
      return flow.stage === "registering"
        ? { stage: "compose", prompt: flow.prompt, notice: "PASSKEY_REGISTERED" }
        : flow;
    case "PROPOSE_STARTED":
      return flow.stage === "compose" ? { stage: "proposing", prompt: flow.prompt } : flow;
    case "PROPOSAL_RECEIVED":
      return flow.stage === "proposing"
        ? { stage: "review", prompt: flow.prompt, proposal: event.proposal }
        : flow;
    case "SIGN_STARTED":
      return flow.stage === "review"
        ? { stage: "signing", step: "options", prompt: flow.prompt, proposal: flow.proposal }
        : flow;
    case "SIGN_STEP":
      return flow.stage === "signing" ? { ...flow, step: event.step } : flow;
    case "CONSENT_VERIFIED":
      return flow.stage === "signing" && flow.step === "verifying"
        ? {
            stage: "consented",
            prompt: flow.prompt,
            proposal: flow.proposal,
            consent: event.consent,
          }
        : flow;
    case "ORDER_STARTED":
      return flow.stage === "consented" ? { ...flow, stage: "ordering" } : flow;
    case "ORDER_CREATED":
      return flow.stage === "ordering"
        ? {
            stage: "checkout",
            step: "ready",
            prompt: flow.prompt,
            proposal: flow.proposal,
            consent: flow.consent,
            order: event.order,
          }
        : flow;
    case "PAYPAL_APPROVED":
      return flow.stage === "checkout" && flow.step === "ready"
        ? { ...withoutNotice(flow), step: "approved" }
        : flow;
    case "PAYPAL_CANCELLED":
      return flow.stage === "checkout" && flow.step === "ready"
        ? { ...flow, notice: "PAYPAL_CANCELLED" }
        : flow;
    case "CAPTURE_STARTED":
      return flow.stage === "checkout" && flow.step === "approved"
        ? { ...flow, step: "capturing" }
        : flow;
    case "CAPTURE_RESULT":
      return flow.stage === "checkout" && flow.step === "capturing"
        ? {
            stage: "settled",
            prompt: flow.prompt,
            proposal: flow.proposal,
            consent: flow.consent,
            order: flow.order,
            capture: event.capture,
          }
        : flow;
    case "EXPIRED":
      return flow.stage === "review"
        ? { stage: "expired", prompt: flow.prompt, proposal: flow.proposal }
        : flow;
    case "FAILED":
      return flow.stage === "failed" || flow.stage === "settled"
        ? flow
        : failFrom(flow, event.failure);
    case "RETRY":
      return flow.stage === "failed" && flow.failure.retryable ? flow.resume : flow;
    case "RESET":
      return { stage: "compose", prompt: promptOf(flow) };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

function withoutNotice<T extends { readonly notice?: unknown }>(value: T): Omit<T, "notice"> {
  const { notice: _notice, ...rest } = value;
  return rest;
}

export function reduce(state: MachineState, event: Event): MachineState {
  const flow = transition(state.flow, event);
  const passkeyRegistered =
    state.passkeyRegistered || (event.type === "REGISTER_SUCCEEDED" && flow !== state.flow);
  if (flow === state.flow && passkeyRegistered === state.passkeyRegistered) {
    return state;
  }
  return { flow, passkeyRegistered };
}
