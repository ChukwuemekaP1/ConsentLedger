/**
 * PayPal JavaScript SDK v6 adapter (browser).
 *
 * Source: https://docs.paypal.ai/payments/methods/paypal/sdk/js/v6/paypal-checkout
 * Read: 2026-10-20. The v6 documented surface used here:
 *   - <script src="https://www.sandbox.paypal.com/web-sdk/v6/core"> (live: www.paypal.com)
 *   - window.paypal.createInstance({ clientId, components: ["paypal-payments"] })
 *   - sdkInstance.findEligibleMethods().isEligible("paypal")
 *   - sdkInstance.createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })
 *   - session.start({ presentationMode: "auto" }, createOrderPromise) where the promise
 *     resolves to { orderId }
 *   - <paypal-button> custom element
 *
 * The order is created by ConsentLedger's server from the stored, signed mandate
 * after passkey consent. This adapter only hands PayPal that server-issued order id;
 * it never builds an order, amount or currency. PayPal buyer approval is a separate
 * act from ConsentLedger passkey approval.
 */

import type { Failure } from "./failure.js";

export type PayPalEnvironment = "sandbox" | "live";

const SDK_URL: Record<PayPalEnvironment, string> = {
  sandbox: "https://www.sandbox.paypal.com/web-sdk/v6/core",
  live: "https://www.paypal.com/web-sdk/v6/core",
};

interface PayPalSession {
  start(
    options: { presentationMode: "auto" },
    createOrder: Promise<{ orderId: string }>,
  ): Promise<void>;
}

interface PayPalSdkInstance {
  findEligibleMethods(): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(callbacks: {
    onApprove: (data: { orderId?: string }) => void | Promise<void>;
    onCancel: (data?: unknown) => void;
    onError: (error: unknown) => void;
  }): PayPalSession | Promise<PayPalSession>;
}

interface PayPalNamespace {
  createInstance(options: {
    clientId: string;
    components: readonly string[];
  }): Promise<PayPalSdkInstance>;
}

function getNamespace(): PayPalNamespace | undefined {
  const candidate = (window as unknown as { paypal?: Partial<PayPalNamespace> }).paypal;
  return typeof candidate?.createInstance === "function"
    ? (candidate as PayPalNamespace)
    : undefined;
}

const scriptLoads = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scriptLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoads.delete(src);
      reject(new Error("PayPal SDK script failed to load"));
    };
    document.head.append(script);
  });
  scriptLoads.set(src, promise);
  return promise;
}

export interface PayPalMountOptions {
  readonly environment: PayPalEnvironment;
  readonly clientId: string;
  /** Order id returned by ConsentLedger's POST /api/v1/orders. */
  readonly orderId: string;
  readonly container: HTMLElement;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly onError: (failure: Failure) => void;
}

export type PayPalMountResult =
  | { readonly ok: true; readonly dispose: () => void }
  | { readonly ok: false; readonly failure: Failure };

export interface PayPalCheckoutPort {
  mount(options: PayPalMountOptions): Promise<PayPalMountResult>;
}

function providerFailure(code: string, detail: string, retryable: boolean): Failure {
  return { category: "provider", code, detail, retryable };
}

export const paypalV6: PayPalCheckoutPort = {
  async mount(options) {
    try {
      await loadScript(SDK_URL[options.environment]);
    } catch {
      return {
        ok: false,
        failure: providerFailure(
          "PAYPAL_SDK_LOAD_FAILED",
          "PayPal's checkout script could not be loaded. Check your connection or content blockers, then retry. No payment was taken.",
          true,
        ),
      };
    }

    const paypal = getNamespace();
    if (!paypal) {
      return {
        ok: false,
        failure: providerFailure(
          "PAYPAL_SDK_UNAVAILABLE",
          "PayPal's checkout SDK loaded but is not available. No payment was taken.",
          true,
        ),
      };
    }

    try {
      const sdkInstance = await paypal.createInstance({
        clientId: options.clientId,
        components: ["paypal-payments"],
      });
      const eligibility = await sdkInstance.findEligibleMethods();
      if (!eligibility.isEligible("paypal")) {
        return {
          ok: false,
          failure: providerFailure(
            "PAYPAL_NOT_ELIGIBLE",
            "PayPal checkout is not available for this buyer or region.",
            false,
          ),
        };
      }

      const session = await sdkInstance.createPayPalOneTimePaymentSession({
        onApprove: (data) => {
          // Capture only the order ConsentLedger created, never an id supplied by the page.
          if (data.orderId !== options.orderId) {
            options.onError(
              providerFailure(
                "PAYPAL_ORDER_MISMATCH",
                "PayPal approved an order that does not match the one ConsentLedger created. Nothing was captured.",
                false,
              ),
            );
            return;
          }
          options.onApprove();
        },
        onCancel: () => options.onCancel(),
        onError: () =>
          options.onError(
            providerFailure(
              "PAYPAL_CHECKOUT_ERROR",
              "PayPal reported an error during checkout. Nothing was captured.",
              true,
            ),
          ),
      });

      const button = document.createElement("paypal-button");
      button.setAttribute("aria-label", "Pay with PayPal");
      const onClick = (): void => {
        // Pass the promise without awaiting it so the browser keeps transient user activation.
        session
          .start({ presentationMode: "auto" }, Promise.resolve({ orderId: options.orderId }))
          .catch(() =>
            options.onError(
              providerFailure(
                "PAYPAL_CHECKOUT_ERROR",
                "PayPal checkout could not be opened. Nothing was captured.",
                true,
              ),
            ),
          );
      };
      button.addEventListener("click", onClick);
      options.container.append(button);

      return {
        ok: true,
        dispose: () => {
          button.removeEventListener("click", onClick);
          button.remove();
        },
      };
    } catch {
      return {
        ok: false,
        failure: providerFailure(
          "PAYPAL_SDK_INIT_FAILED",
          "PayPal checkout could not be initialised. No payment was taken.",
          true,
        ),
      };
    }
  },
};
