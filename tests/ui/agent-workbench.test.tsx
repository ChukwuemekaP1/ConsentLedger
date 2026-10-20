/**
 * Component tests for the Agent surface (React Testing Library on jsdom).
 *
 * The backend, WebAuthn and the PayPal SDK are faked here. These tests prove how the UI
 * reacts to server outcomes; they do not prove WebAuthn or PayPal behaviour. Real WebAuthn
 * is exercised separately in tests/e2e with a Chromium virtual authenticator.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentWorkbench } from "../../src/ui/agent/AgentWorkbench.js";
import type { AgentApi } from "../../src/ui/agent/api-client.js";
import type { PasskeyPort } from "../../src/ui/agent/passkeys.js";
import type { PayPalCheckoutPort } from "../../src/ui/agent/paypal-v6.js";
import {
  ASSERTION,
  EXPIRES_AT,
  MANDATE_HASH,
  MANDATE_ID,
  NOW,
  clientConfig,
  consentVerified,
  fail,
  makeApi,
  makePasskeys,
  makePayPal,
  ok,
  problem,
  proposalResponse,
} from "./fixtures.js";

interface Options {
  api?: Partial<AgentApi>;
  passkeys?: Partial<PasskeyPort>;
  now?: () => number;
  paypalMount?: PayPalCheckoutPort["mount"];
}

function setup(options: Options = {}) {
  const api = makeApi(options.api);
  const passkeys = makePasskeys(options.passkeys);
  const paypal = makePayPal();
  if (options.paypalMount) paypal.port.mount = options.paypalMount;
  const user = userEvent.setup();
  render(
    <AgentWorkbench
      api={api}
      passkeys={passkeys}
      paypal={paypal.port}
      now={options.now ?? (() => NOW)}
    />,
  );
  return { api, passkeys, paypal, user };
}

type Ctx = ReturnType<typeof setup>;

async function askAgent({ user }: Ctx, prompt = "buy a keyboard and keycaps") {
  await user.type(screen.getByLabelText("What should the agent buy?"), prompt);
  await user.click(screen.getByRole("button", { name: "Ask the agent" }));
}

async function reachReview(ctx: Ctx) {
  await askAgent(ctx);
  await screen.findByRole("button", { name: "Approve with passkey" });
}

async function reachCheckout(ctx: Ctx) {
  await reachReview(ctx);
  await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
  await screen.findByRole("heading", { name: "PayPal order created" });
}

describe("proposal and mandate display", () => {
  it("shows the server-issued mandate: merchant, items, quantity, total, currency, policy, expiry", async () => {
    const ctx = setup();
    await reachReview(ctx);

    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading", { name: "ShopX" })).toBeTruthy();
    expect(within(card).getByText("75% Mechanical Keyboard")).toBeTruthy();
    expect(within(card).getByText("SKU KB-75")).toBeTruthy();
    expect(within(card).getByTestId("mandate-total").textContent).toBe("$110.00 USD");
    expect(within(card).getByText("Policy: Allowed")).toBeTruthy();
    expect(within(card).getByRole("timer").textContent).toBe("15:00 left");
    expect(within(card).getByText(EXPIRES_AT)).toBeTruthy();
    expect(within(card).getByText(/“Buy a keyboard and keycaps”/)).toBeTruthy();
    expect(within(card).getByText("Unsigned")).toBeTruthy();
  });

  it("labels fixture-mode products as demo data and settlement as Sandbox", async () => {
    setup();
    expect(await screen.findByText("Demo data")).toBeTruthy();
    expect(screen.getByText("PayPal Sandbox")).toBeTruthy();
  });

  it("labels a live catalog differently and simulated settlement explicitly", async () => {
    setup({
      api: {
        getClientConfig: async () =>
          ok(clientConfig({ catalogMode: "channel3", settlementMode: "simulated" })),
      },
    });
    expect(await screen.findByText("Simulated settlement")).toBeTruthy();
    expect(screen.queryByText("Demo data")).toBeNull();
  });

  it("explains that no payment happens at the consent step", async () => {
    const ctx = setup();
    await reachReview(ctx);
    expect(screen.getByText(/No payment happens at this step/)).toBeTruthy();
  });

  it("warns when the line items do not add up to the signed total", async () => {
    const bad = proposalResponse();
    bad.mandate.terms.payment.amountMinor = 99999;
    const ctx = setup({ api: { propose: async () => ok(bad) } });
    await reachReview(ctx);
    expect(screen.getByRole("alert").textContent).toMatch(/do not add up/);
  });
});

describe("missing data and validation", () => {
  it("does not call the server when the request is empty and says what is missing", async () => {
    const ctx = setup();
    await ctx.user.click(screen.getByRole("button", { name: "Ask the agent" }));
    expect(
      (await screen.findByText("Describe what you want the agent to buy.")).getAttribute("role"),
    ).toBe("alert");
    expect(ctx.api.propose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("What should the agent buy?").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("requires a passkey name before registering", async () => {
    const ctx = setup();
    await ctx.user.click(screen.getByRole("button", { name: "Register passkey" }));
    expect(await screen.findByText(/Enter a name for this passkey/)).toBeTruthy();
    expect(ctx.api.requestRegistrationOptions).not.toHaveBeenCalled();
  });

  it("fills the request from an example chip", async () => {
    const ctx = setup();
    await ctx.user.click(screen.getByRole("button", { name: "Get $50 of cloud compute credits" }));
    expect((screen.getByLabelText("What should the agent buy?") as HTMLTextAreaElement).value).toBe(
      "Get $50 of cloud compute credits",
    );
  });
});

describe("loading and API errors", () => {
  it("shows a loading state while the agent works and disables repeat submission", async () => {
    let release: (() => void) | undefined;
    const ctx = setup({
      api: {
        propose: () =>
          new Promise((resolve) => {
            release = () => resolve(ok(proposalResponse()));
          }),
      },
    });
    await askAgent(ctx);
    expect(await screen.findByText(/Searching the catalog/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask the agent" })).toBeNull();
    await act(async () => release?.());
    await screen.findByRole("button", { name: "Approve with passkey" });
  });

  it("shows a network failure, then recovers on retry", async () => {
    const propose = vi
      .fn<AgentApi["propose"]>()
      .mockResolvedValueOnce(
        fail(problem("network", "NETWORK_ERROR", "Could not reach ConsentLedger.", true)),
      )
      .mockResolvedValueOnce(ok(proposalResponse()));
    const ctx = setup({ api: { propose } });
    await askAgent(ctx);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Connection problem/);
    expect(screen.getByText(/No consent was recorded and no payment was made/)).toBeTruthy();
    await ctx.user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Approve with passkey" });
    expect(propose).toHaveBeenCalledTimes(2);
  });

  it("sends the user to passkey registration when the session is missing", async () => {
    const propose = vi
      .fn<AgentApi["propose"]>()
      .mockResolvedValueOnce(fail(problem("auth", "UNAUTHENTICATED", "Authentication required")))
      .mockResolvedValueOnce(ok(proposalResponse()));
    const ctx = setup({ api: { propose } });
    await askAgent(ctx);
    expect((await screen.findByRole("heading", { name: "Sign-in required" })).tagName).toBe("H2");

    await ctx.user.type(screen.getByLabelText("Name for this passkey"), "Alex");
    await ctx.user.click(screen.getByRole("button", { name: "Register passkey" }));
    expect(await screen.findByText("Passkey registered")).toBeTruthy();
    expect(ctx.passkeys.register).toHaveBeenCalledTimes(1);
    expect(ctx.api.verifyRegistration).toHaveBeenCalledWith(expect.anything(), "Alex");

    // The prompt is preserved; the user asks again explicitly.
    await ctx.user.click(screen.getByRole("button", { name: "Ask the agent" }));
    await screen.findByRole("button", { name: "Approve with passkey" });
  });

  it("rejects a malformed server response instead of treating it as success", async () => {
    const ctx = setup({
      api: {
        propose: async () => fail(problem("unexpected", "MALFORMED_RESPONSE", "not trusted")),
      },
    });
    await askAgent(ctx);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Unexpected response/);
    expect(screen.queryByRole("button", { name: "Approve with passkey" })).toBeNull();
  });
});

describe("denial", () => {
  it("shows policy denial from the proposal step with reason codes and no retry", async () => {
    const ctx = setup({
      api: {
        propose: async () =>
          fail(
            problem("denied", "POLICY_DENIED", "Policy rejected this purchase.", false, [
              "TX_CAP_EXCEEDED",
            ]),
          ),
      },
    });
    await askAgent(ctx);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Not approved/);
    expect(within(alert).getByText("TX_CAP_EXCEEDED")).toBeTruthy();
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(alert).getByText(/Code: POLICY_DENIED/)).toBeTruthy();
  });

  it("shows a Gate denial from order creation and never loads PayPal checkout", async () => {
    const ctx = setup({
      api: {
        createOrder: async () =>
          fail(problem("denied", "POLICY_DRIFT", "Gate denied order execution: policy changed.")),
      },
    });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Gate denied order execution/);
    expect(within(alert).getByText(/Code: POLICY_DRIFT/)).toBeTruthy();
    expect(ctx.paypal.port.mount).not.toHaveBeenCalled();
  });
});

describe("passkey consent", () => {
  it("runs consent against the mandate, verifies on the server, then creates the order from its id only", async () => {
    const ctx = setup();
    await reachCheckout(ctx);

    expect(ctx.api.requestConsentOptions).toHaveBeenCalledWith(MANDATE_ID);
    expect(ctx.passkeys.authenticate).toHaveBeenCalledTimes(1);
    expect(ctx.api.verifyConsent).toHaveBeenCalledWith(MANDATE_ID, ASSERTION);
    expect(ctx.api.createOrder).toHaveBeenCalledTimes(1);
    expect(ctx.api.createOrder).toHaveBeenCalledWith(MANDATE_ID);

    // Consent is shown as server-verified and as distinct from PayPal approval.
    expect(screen.getByText("Signed with passkey")).toBeTruthy();
    expect(screen.getByText(/Money has not moved/)).toBeTruthy();
    expect(screen.getByText(/separate from the ConsentLedger passkey step/)).toBeTruthy();
    expect(ctx.api.captureOrder).not.toHaveBeenCalled();
  });

  it("does not claim consent while the server is still verifying", async () => {
    let release: (() => void) | undefined;
    const ctx = setup({
      api: {
        verifyConsent: () =>
          new Promise((resolve) => {
            release = () => resolve(ok(consentVerified()));
          }),
      },
    });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    expect(
      await screen.findByText(/ConsentLedger is verifying your signature/, {
        selector: "p.progress",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Signed with passkey")).toBeNull();
    expect(screen.getByText("Consent is not recorded until the server confirms it.")).toBeTruthy();
    expect(ctx.api.createOrder).not.toHaveBeenCalled();
    await act(async () => release?.());
    await screen.findByRole("heading", { name: "PayPal order created" });
  });

  it("handles a cancelled passkey prompt, records nothing, and lets the user retry", async () => {
    const authenticate = vi
      .fn<PasskeyPort["authenticate"]>()
      .mockResolvedValueOnce({
        ok: false,
        failure: problem("passkey", "PASSKEY_CANCELLED", "The passkey prompt was cancelled.", true),
      })
      .mockResolvedValueOnce({ ok: true, value: ASSERTION });
    const ctx = setup({ passkeys: { authenticate } });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Passkey not used/);
    expect(ctx.api.verifyConsent).not.toHaveBeenCalled();
    expect(ctx.api.createOrder).not.toHaveBeenCalled();
    // The mandate stays visible and unsigned so the user can still inspect the terms.
    expect(screen.getByText("Unsigned")).toBeTruthy();

    await ctx.user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "PayPal order created" });
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("reports an unsupported browser without contacting the server for options", async () => {
    const ctx = setup({ passkeys: { isSupported: () => false } });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/does not support passkeys/);
    expect(within(alert).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(ctx.api.requestConsentOptions).not.toHaveBeenCalled();
  });

  it("shows a failed assertion from the server as consent not recorded and breaks the seal", async () => {
    const ctx = setup({
      api: {
        verifyConsent: async () =>
          fail(problem("consent", "CONSENT_INVALID", "Assertion did not verify.", true)),
      },
    });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Consent not recorded/);
    expect(screen.getByRole("img", { name: /Seal broken/ })).toBeTruthy();
    expect(ctx.api.createOrder).not.toHaveBeenCalled();
  });

  it("refuses a consent response that names a different mandate hash", async () => {
    const ctx = setup({
      api: { verifyConsent: async () => ok(consentVerified({ mandateHash: `${MANDATE_HASH}ff` })) },
    });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/different mandate/);
    expect(ctx.api.createOrder).not.toHaveBeenCalled();
  });

  it("starts the passkey ceremony once when the approve button is clicked repeatedly", async () => {
    let release: (() => void) | undefined;
    const ctx = setup({
      passkeys: {
        authenticate: () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true, value: ASSERTION });
          }),
      },
    });
    await reachReview(ctx);
    const button = screen.getByRole("button", { name: "Approve with passkey" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(ctx.passkeys.authenticate).toHaveBeenCalledTimes(1));
    expect(ctx.api.requestConsentOptions).toHaveBeenCalledTimes(1);
    await act(async () => release?.());
    await screen.findByRole("heading", { name: "PayPal order created" });
    expect(ctx.api.verifyConsent).toHaveBeenCalledTimes(1);
    expect(ctx.api.createOrder).toHaveBeenCalledTimes(1);
  });

  it("submits the proposal request once when the form is submitted repeatedly", async () => {
    let release: (() => void) | undefined;
    const ctx = setup({
      api: {
        propose: () =>
          new Promise((resolve) => {
            release = () => resolve(ok(proposalResponse()));
          }),
      },
    });
    await ctx.user.type(screen.getByLabelText("What should the agent buy?"), "keyboard");
    const button = screen.getByRole("button", { name: "Ask the agent" });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => release?.());
    await screen.findByRole("button", { name: "Approve with passkey" });
    expect(ctx.api.propose).toHaveBeenCalledTimes(1);
  });
});

describe("expiry", () => {
  it("expires an unsigned mandate and blocks approval", async () => {
    let clock = NOW;
    const ctx = setup({ now: () => clock });
    await reachReview(ctx);
    clock = Date.parse(EXPIRES_AT) + 1000;
    const alert = await screen.findByRole("alert", {}, { timeout: 3000 });
    expect(alert.textContent).toMatch(/Mandate expired/);
    expect(screen.queryByRole("button", { name: "Approve with passkey" })).toBeNull();
    expect(ctx.passkeys.authenticate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Request a new proposal" })).toBeTruthy();
  });

  it("shows server-reported expiry during consent as expired, not as a generic error", async () => {
    const ctx = setup({
      api: {
        requestConsentOptions: async () =>
          fail(problem("expired", "MANDATE_EXPIRED", "Mandate has expired.")),
      },
    });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Mandate expired/);
    expect(ctx.passkeys.authenticate).not.toHaveBeenCalled();
  });
});

describe("provider errors and retry", () => {
  it("keeps consent recorded when order creation fails and retries only the order", async () => {
    const createOrder = vi
      .fn<AgentApi["createOrder"]>()
      .mockResolvedValueOnce(
        fail(problem("provider", "PROVIDER_ERROR", "PayPal is unavailable.", true)),
      )
      .mockResolvedValueOnce(
        ok({ orderId: "PAYPAL-ORDER-2", paymentMandateId: "pm", status: "CREATED" }),
      );
    const ctx = setup({ api: { createOrder } });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Payment provider problem/);
    expect(
      within(alert).getByText(/passkey approval was recorded, but no payment has been confirmed/),
    ).toBeTruthy();
    expect(screen.getByText("Signed with passkey")).toBeTruthy();

    await ctx.user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "PayPal order created" });
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(ctx.passkeys.authenticate).toHaveBeenCalledTimes(1);
    expect(ctx.api.verifyConsent).toHaveBeenCalledTimes(1);
  });
});

describe("PayPal checkout", () => {
  it("hands PayPal the server-issued order id and shows the order as not yet approved", async () => {
    const ctx = setup();
    await reachCheckout(ctx);
    await waitFor(() => expect(ctx.paypal.port.mount).toHaveBeenCalledTimes(1));
    expect(ctx.paypal.state.options).toMatchObject({
      environment: "sandbox",
      clientId: "sandbox-client-id",
      orderId: "PAYPAL-ORDER-1",
    });
    expect(screen.getByText("PAYPAL-ORDER-1")).toBeTruthy();
    expect(screen.queryByText("Payment captured")).toBeNull();
    expect(ctx.api.captureOrder).not.toHaveBeenCalled();
  });

  it("captures only after PayPal buyer approval and then reports success from the server", async () => {
    const ctx = setup();
    await reachCheckout(ctx);
    await waitFor(() => expect(ctx.paypal.state.options).toBeDefined());
    await act(async () => ctx.paypal.state.options?.onApprove());

    expect(await screen.findByRole("heading", { name: "Payment captured" })).toBeTruthy();
    expect(ctx.api.captureOrder).toHaveBeenCalledWith("PAYPAL-ORDER-1", MANDATE_ID);
    expect(screen.getByText("CAP-1")).toBeTruthy();
  });

  it("does not call a PENDING capture complete", async () => {
    const ctx = setup({
      api: { captureOrder: async () => ok({ orderId: "PAYPAL-ORDER-1", status: "PENDING" }) },
    });
    await reachCheckout(ctx);
    await waitFor(() => expect(ctx.paypal.state.options).toBeDefined());
    await act(async () => ctx.paypal.state.options?.onApprove());
    expect(await screen.findByRole("heading", { name: "Payment pending at PayPal" })).toBeTruthy();
    expect(screen.queryByText("Payment captured")).toBeNull();
  });

  it("captures once when PayPal reports approval several times", async () => {
    const ctx = setup();
    await reachCheckout(ctx);
    await waitFor(() => expect(ctx.paypal.state.options).toBeDefined());
    await act(async () => {
      ctx.paypal.state.options?.onApprove();
      ctx.paypal.state.options?.onApprove();
    });
    await screen.findByRole("heading", { name: "Payment captured" });
    expect(ctx.api.captureOrder).toHaveBeenCalledTimes(1);
  });

  it("treats a closed PayPal window as not approved and captures nothing", async () => {
    const ctx = setup();
    await reachCheckout(ctx);
    await waitFor(() => expect(ctx.paypal.state.options).toBeDefined());
    act(() => ctx.paypal.state.options?.onCancel());
    expect(await screen.findByText(/You closed PayPal without approving/)).toBeTruthy();
    expect(ctx.api.captureOrder).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Payment captured" })).toBeNull();
  });

  it("says capture status is unconfirmed after a capture error and retries only the capture", async () => {
    const captureOrder = vi
      .fn<AgentApi["captureOrder"]>()
      .mockResolvedValueOnce(
        fail(problem("provider", "PROVIDER_OUTCOME_UNKNOWN", "Outcome unknown.", true)),
      )
      .mockResolvedValueOnce(
        ok({ orderId: "PAYPAL-ORDER-1", captureId: "CAP-9", status: "COMPLETED" }),
      );
    const ctx = setup({ api: { captureOrder } });
    await reachCheckout(ctx);
    await waitFor(() => expect(ctx.paypal.state.options).toBeDefined());
    await act(async () => ctx.paypal.state.options?.onApprove());

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/Payment status is unconfirmed/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Payment captured" })).toBeNull();

    await ctx.user.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Payment captured" });
    expect(captureOrder).toHaveBeenCalledTimes(2);
    expect(ctx.api.createOrder).toHaveBeenCalledTimes(1);
  });

  it("shows a PayPal SDK failure as a provider problem and not as a payment", async () => {
    const ctx = setup({
      paypalMount: async () => ({
        ok: false,
        failure: problem(
          "provider",
          "PAYPAL_SDK_LOAD_FAILED",
          "PayPal's checkout script could not be loaded.",
          true,
        ),
      }),
    });
    await reachReview(ctx);
    await ctx.user.click(screen.getByRole("button", { name: "Approve with passkey" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Payment provider problem/);
    expect(within(alert).getByText(/Code: PAYPAL_SDK_LOAD_FAILED/)).toBeTruthy();
    expect(ctx.api.captureOrder).not.toHaveBeenCalled();
  });

  it("uses a clearly labelled simulator in simulated settlement mode", async () => {
    const ctx = setup({
      api: { getClientConfig: async () => ok(clientConfig({ settlementMode: "simulated" })) },
    });
    await reachCheckout(ctx);
    expect(await screen.findByRole("button", { name: "Settle with simulator" })).toBeTruthy();
    expect(screen.getAllByText("Simulated settlement").length).toBeGreaterThan(0);
    expect(ctx.paypal.port.mount).not.toHaveBeenCalled();
    await ctx.user.click(screen.getByRole("button", { name: "Settle with simulator" }));
    expect(await screen.findByRole("heading", { name: "Payment captured" })).toBeTruthy();
  });
});

describe("accessibility", () => {
  it("exposes progress, a polite live region and labelled controls", async () => {
    const ctx = setup();
    const rail = screen.getByRole("list", { name: "Progress" });
    expect(within(rail).getAllByRole("listitem")).toHaveLength(5);
    await reachReview(ctx);
    expect(rail.querySelector("[aria-current='step']")?.textContent).toMatch(/Review mandate/);
    const live = document.querySelector("[aria-live='polite']");
    expect(live?.textContent).toMatch(/Proposal ready/);
    expect(screen.getByRole("img", { name: /Seal incomplete: 2 of 3 checks passed/ })).toBeTruthy();
  });

  it("moves focus to the review heading when the proposal arrives", async () => {
    const ctx = setup();
    await reachReview(ctx);
    expect(document.activeElement?.textContent).toBe("Review, then approve with your passkey");
  });
});
