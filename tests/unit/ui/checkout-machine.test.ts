import { describe, expect, it } from "vitest";
import {
  initialState,
  reduce,
  type Event,
  type Flow,
  type MachineState,
} from "../../../src/ui/agent/checkout-machine.js";
import { proposalResponse, problem } from "../../ui/fixtures.js";

const view = (() => {
  const r = proposalResponse();
  return { mandate: r.mandate, rationale: r.proposal.rationale, evaluation: r.evaluation };
})();
const consent = { mandateHash: "h", credentialId: "c", verifiedAt: "t" };

function run(events: readonly Event[], from: MachineState = initialState): MachineState {
  return events.reduce(reduce, from);
}

const toReview: Event[] = [
  { type: "PROMPT_EDITED", prompt: "buy a keyboard" },
  { type: "PROPOSE_STARTED" },
  { type: "PROPOSAL_RECEIVED", proposal: view },
];
const toSigning: Event[] = [
  ...toReview,
  { type: "SIGN_STARTED" },
  { type: "SIGN_STEP", step: "verifying" },
];
const toConsented: Event[] = [...toSigning, { type: "CONSENT_VERIFIED", consent }];
const toCheckout: Event[] = [
  ...toConsented,
  { type: "ORDER_STARTED" },
  { type: "ORDER_CREATED", order: { orderId: "O-1" } },
];

const stage = (s: MachineState): Flow["stage"] => s.flow.stage;

describe("checkout state machine: happy path", () => {
  it("walks every mandatory stage in order to settled", () => {
    let s = initialState;
    const stages: string[] = [stage(s)];
    for (const event of [
      ...toCheckout,
      { type: "PAYPAL_APPROVED" } as const,
      { type: "CAPTURE_STARTED" } as const,
      { type: "CAPTURE_RESULT", capture: { status: "COMPLETED" } } as const,
    ]) {
      s = reduce(s, event);
      if (stages[stages.length - 1] !== stage(s)) stages.push(stage(s));
    }
    expect(stages).toEqual([
      "compose",
      "proposing",
      "review",
      "signing",
      "consented",
      "ordering",
      "checkout",
      "settled",
    ]);
  });
});

describe("checkout state machine: stages cannot be skipped", () => {
  it("ignores signing before a proposal exists", () => {
    expect(run([{ type: "SIGN_STARTED" }])).toBe(initialState);
  });

  it("ignores consent verification unless a verification step is in flight", () => {
    const s = run([...toReview, { type: "SIGN_STARTED" }]);
    expect(reduce(s, { type: "CONSENT_VERIFIED", consent })).toBe(s);
  });

  it("ignores order creation before consent is verified", () => {
    const s = run(toReview);
    expect(reduce(s, { type: "ORDER_CREATED", order: { orderId: "X" } })).toBe(s);
    expect(reduce(s, { type: "ORDER_STARTED" })).toBe(s);
  });

  it("requires PayPal buyer approval before capture can start", () => {
    const s = run(toCheckout);
    expect(reduce(s, { type: "CAPTURE_STARTED" })).toBe(s);
    expect(reduce(s, { type: "CAPTURE_RESULT", capture: { status: "COMPLETED" } })).toBe(s);
  });

  it("ignores a repeated start event (repeat clicks are no-ops)", () => {
    const proposing = run([{ type: "PROMPT_EDITED", prompt: "x" }, { type: "PROPOSE_STARTED" }]);
    expect(reduce(proposing, { type: "PROPOSE_STARTED" })).toBe(proposing);
    const signing = run([...toReview, { type: "SIGN_STARTED" }]);
    expect(reduce(signing, { type: "SIGN_STARTED" })).toBe(signing);
  });

  it("only expires a proposal that is awaiting review", () => {
    expect(stage(run([...toReview, { type: "EXPIRED" }]))).toBe("expired");
    const signing = run([...toReview, { type: "SIGN_STARTED" }]);
    expect(reduce(signing, { type: "EXPIRED" })).toBe(signing);
  });

  it("never lets a late failure overwrite a settled payment", () => {
    const settled = run([
      ...toCheckout,
      { type: "PAYPAL_APPROVED" },
      { type: "CAPTURE_STARTED" },
      { type: "CAPTURE_RESULT", capture: { status: "COMPLETED" } },
    ]);
    expect(
      reduce(settled, { type: "FAILED", failure: problem("provider", "INTERNAL", "x", true) }),
    ).toBe(settled);
  });
});

describe("checkout state machine: failures", () => {
  it("routes an unauthenticated response to auth_required keeping the prompt", () => {
    const s = run([
      { type: "PROMPT_EDITED", prompt: "keyboard" },
      { type: "PROPOSE_STARTED" },
      { type: "FAILED", failure: problem("auth", "UNAUTHENTICATED", "no session") },
    ]);
    expect(s.flow).toEqual({ stage: "auth_required", prompt: "keyboard" });
  });

  it("routes a denial to a terminal denied stage that is not retryable", () => {
    const s = run([
      ...toConsented,
      { type: "ORDER_STARTED" },
      { type: "FAILED", failure: problem("denied", "POLICY_DRIFT", "policy changed") },
    ]);
    expect(stage(s)).toBe("denied");
    expect(reduce(s, { type: "RETRY" })).toBe(s);
  });

  it("routes an expiry response to expired with the proposal still visible", () => {
    const s = run([
      ...toSigning,
      { type: "FAILED", failure: problem("expired", "MANDATE_EXPIRED", "expired") },
    ]);
    expect(s.flow.stage).toBe("expired");
  });

  it("returns a cancelled passkey prompt to review so the user can retry", () => {
    const failed = run([
      ...toReview,
      { type: "SIGN_STARTED" },
      { type: "FAILED", failure: problem("passkey", "PASSKEY_CANCELLED", "cancelled", true) },
    ]);
    expect(stage(failed)).toBe("failed");
    expect(stage(reduce(failed, { type: "RETRY" }))).toBe("review");
  });

  it("resumes at consented (not at an earlier stage) when order creation fails", () => {
    const failed = run([
      ...toConsented,
      { type: "ORDER_STARTED" },
      { type: "FAILED", failure: problem("provider", "PROVIDER_ERROR", "down", true) },
    ]);
    const resumed = reduce(failed, { type: "RETRY" });
    expect(stage(resumed)).toBe("consented");
  });

  it("resumes at approved when capture fails, so the buyer is not asked to approve twice", () => {
    const failed = run([
      ...toCheckout,
      { type: "PAYPAL_APPROVED" },
      { type: "CAPTURE_STARTED" },
      { type: "FAILED", failure: problem("provider", "PROVIDER_ERROR", "down", true) },
    ]);
    const resumed = reduce(failed, { type: "RETRY" });
    expect(resumed.flow).toMatchObject({ stage: "checkout", step: "approved" });
  });

  it("records a closed PayPal window without approving", () => {
    const s = run([...toCheckout, { type: "PAYPAL_CANCELLED" }]);
    expect(s.flow).toMatchObject({ stage: "checkout", step: "ready", notice: "PAYPAL_CANCELLED" });
  });

  it("does not retry a non-retryable failure", () => {
    const failed = run([
      ...toReview,
      { type: "SIGN_STARTED" },
      { type: "FAILED", failure: problem("passkey", "PASSKEY_UNSUPPORTED", "no", false) },
    ]);
    expect(reduce(failed, { type: "RETRY" })).toBe(failed);
  });
});

describe("checkout state machine: passkey registration", () => {
  it("marks the passkey registered only after a registration actually succeeds", () => {
    expect(reduce(initialState, { type: "REGISTER_SUCCEEDED" })).toBe(initialState);
    const s = run([
      { type: "REGISTER_STARTED" },
      { type: "REGISTER_STEP", step: "verifying" },
      { type: "REGISTER_SUCCEEDED" },
    ]);
    expect(s.passkeyRegistered).toBe(true);
    expect(s.flow).toMatchObject({ stage: "compose", notice: "PASSKEY_REGISTERED" });
  });

  it("returns to the registration form after a failed registration", () => {
    const failed = run([
      { type: "REGISTER_STARTED" },
      { type: "FAILED", failure: problem("passkey", "PASSKEY_CANCELLED", "c", true) },
    ]);
    expect(stage(reduce(failed, { type: "RETRY" }))).toBe("auth_required");
    expect(failed.passkeyRegistered).toBe(false);
  });
});
