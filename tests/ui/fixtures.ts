/**
 * Test doubles for the Agent surface. These are component-level fakes: the backend,
 * WebAuthn and PayPal SDK are replaced, so tests using them prove UI behaviour only.
 */

import { vi } from "vitest";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { AgentApi, ApiResult } from "../../src/ui/agent/api-client.js";
import type {
  CaptureResponse,
  ClientConfig,
  ConsentVerifyResponse,
  OrderResponse,
  ProposalResponse,
} from "../../src/ui/agent/api-schemas.js";
import type { Failure } from "../../src/ui/agent/failure.js";
import type { PasskeyPort } from "../../src/ui/agent/passkeys.js";
import type { PayPalCheckoutPort, PayPalMountOptions } from "../../src/ui/agent/paypal-v6.js";

export const MANDATE_ID = "11111111-1111-4111-8111-111111111111";
export const MANDATE_HASH = "a3f9c0ffee0123456789abcdef0123456789abcdef0123456789abcdef01c21e";
export const NOW = Date.parse("2026-10-20T12:00:00.000Z");
export const EXPIRES_AT = "2026-10-20T12:15:00.000Z";

export function proposalResponse(): ProposalResponse {
  return {
    mandate: {
      terms: {
        v: 1,
        kind: "CART",
        id: MANDATE_ID,
        correlationId: "corr-1",
        principalId: "principal-1",
        agent: { id: "agent-1", model: "fake-llm" },
        payee: { merchantId: "shopx", displayName: "ShopX" },
        payment: { amountMinor: 11000, currency: "USD" },
        items: [
          {
            sku: "KB-75",
            description: "75% Mechanical Keyboard",
            quantity: 1,
            unitAmountMinor: 8500,
          },
          { sku: "KC-PBT", description: "PBT Keycap Set", quantity: 1, unitAmountMinor: 2500 },
        ],
        promptPlayback: "Buy a keyboard and keycaps",
        policy: { id: "policy-1", hash: "policyhash" },
        validity: { notBefore: "2026-10-20T11:59:00.000Z", expiresAt: EXPIRES_AT },
        nonce: "nonce-1",
      },
      hash: MANDATE_HASH,
      attestations: [{ role: "AUTHORITY", keyId: "authority-key-1", signature: "sig" }],
      status: "ISSUED",
    },
    proposal: { rationale: "Matches your request" },
    evaluation: { decision: "ALLOW", reasons: [] },
    products: [],
  };
}

export function clientConfig(overrides: Partial<ClientConfig> = {}): ClientConfig {
  return {
    clientId: "sandbox-client-id",
    currency: "USD",
    environment: "sandbox",
    settlementMode: "paypal",
    catalogMode: "fixture",
    ...overrides,
  };
}

export const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
export const fail = <T = never>(failure: Failure): ApiResult<T> => ({ ok: false, failure });

export const problem = (
  category: Failure["category"],
  code: string,
  detail: string,
  retryable = false,
  reasons?: readonly string[],
): Failure => ({
  category,
  code,
  detail,
  retryable,
  ...(reasons !== undefined ? { reasons } : {}),
});

const REQUEST_OPTIONS = {
  challenge: "challenge-bound-to-mandate-hash",
  rpId: "localhost",
  userVerification: "required",
} as unknown as PublicKeyCredentialRequestOptionsJSON;

const CREATION_OPTIONS = {
  challenge: "registration-challenge",
  rp: { name: "ConsentLedger", id: "localhost" },
  user: { id: "uid", name: "demo", displayName: "demo" },
  pubKeyCredParams: [],
} as unknown as PublicKeyCredentialCreationOptionsJSON;

export const ASSERTION = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key",
  response: {},
  clientExtensionResults: {},
} as unknown as AuthenticationResponseJSON;

export const REGISTRATION = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key",
  response: {},
  clientExtensionResults: {},
} as unknown as RegistrationResponseJSON;

export function consentVerified(
  overrides: Partial<ConsentVerifyResponse> = {},
): ConsentVerifyResponse {
  return {
    status: "ok",
    mandateId: MANDATE_ID,
    mandateHash: MANDATE_HASH,
    credentialId: "credential-abcdef123456",
    mandateStatus: "SIGNED",
    verifiedAt: "2026-10-20T12:00:05.000Z",
    ...overrides,
  };
}

export type FakeApi = { [K in keyof AgentApi]: ReturnType<typeof vi.fn<AgentApi[K]>> };

/** An API whose every endpoint succeeds. Tests override single methods to inject failures. */
export function makeApi(overrides: Partial<AgentApi> = {}): FakeApi {
  const base: AgentApi = {
    getClientConfig: async () => ok(clientConfig()),
    requestRegistrationOptions: async () => ok(CREATION_OPTIONS),
    verifyRegistration: async () => ok({ principalId: "principal-1", credentialId: "cred-1" }),
    propose: async () => ok(proposalResponse()),
    requestConsentOptions: async () => ok(REQUEST_OPTIONS),
    verifyConsent: async () => ok(consentVerified()),
    createOrder: async () =>
      ok<OrderResponse>({ orderId: "PAYPAL-ORDER-1", paymentMandateId: "pm-1", status: "CREATED" }),
    captureOrder: async () =>
      ok<CaptureResponse>({ orderId: "PAYPAL-ORDER-1", captureId: "CAP-1", status: "COMPLETED" }),
    searchProducts: async (q: string) => ok({ query: q, count: 0, products: [] }),
    ...overrides,
  };
  return {
    getClientConfig: vi.fn(base.getClientConfig),
    requestRegistrationOptions: vi.fn(base.requestRegistrationOptions),
    verifyRegistration: vi.fn(base.verifyRegistration),
    propose: vi.fn(base.propose),
    searchProducts: vi.fn(base.searchProducts),
    requestConsentOptions: vi.fn(base.requestConsentOptions),
    verifyConsent: vi.fn(base.verifyConsent),
    createOrder: vi.fn(base.createOrder),
    captureOrder: vi.fn(base.captureOrder),
  };
}

export function makePasskeys(overrides: Partial<PasskeyPort> = {}) {
  const base: PasskeyPort = {
    isSupported: () => true,
    register: async () => ({ ok: true, value: REGISTRATION }),
    authenticate: async () => ({ ok: true, value: ASSERTION }),
    ...overrides,
  };
  return {
    isSupported: vi.fn(base.isSupported),
    register: vi.fn(base.register),
    authenticate: vi.fn(base.authenticate),
  };
}

export function makePayPal() {
  const state: { options?: PayPalMountOptions; dispose: () => void } = {
    dispose: vi.fn(),
  };
  const port: PayPalCheckoutPort = {
    mount: vi.fn<PayPalCheckoutPort["mount"]>(async (options: PayPalMountOptions) => {
      state.options = options;
      return { ok: true as const, dispose: state.dispose };
    }),
  };
  return { port, state };
}
