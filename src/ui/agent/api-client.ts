/**
 * HTTP client for the Agent surface.
 *
 * Thin wrappers over the existing /api/v1 routes. `fetch` is injected so tests
 * never touch the network. The client sends only identifiers and the
 * authenticator's own output: payment terms are never sent (AGENTS.md rule 2),
 * the server rebuilds the PayPal order from the stored, signed mandate (I-02).
 */

import { z } from "zod";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import {
  failureFromProblem,
  malformedResponseFailure,
  networkFailure,
  type Failure,
} from "./failure.js";
import {
  CaptureResponseSchema,
  ClientConfigSchema,
  ConsentVerifyResponseSchema,
  OrderResponseSchema,
  ProblemSchema,
  ProposalResponseSchema,
  RegistrationResponseSchema,
  ProductSearchResponseSchema,
  type CaptureResponse,
  type ClientConfig,
  type ConsentVerifyResponse,
  type OrderResponse,
  type ProposalResponse,
  type ProductSearchResponse,
} from "./api-schemas.js";
import type { PolicyDocument } from "../../domain/policy/policy.js";

export type ApiResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const fail = <T>(failure: Failure): ApiResult<T> => ({ ok: false, failure });

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function call<S extends z.ZodType>(
  fetchFn: FetchFn,
  path: string,
  init: RequestInit,
  schema: S,
): Promise<ApiResult<z.infer<S>>> {
  let response: Response;
  try {
    response = await fetchFn(path, {
      ...init,
      credentials: init.credentials ?? "same-origin",
    });
  } catch {
    return fail(networkFailure());
  }
  const body = await readJson(response);
  const requestId = response.headers.get("x-request-id") ?? undefined;

  if (!response.ok) {
    const problem = ProblemSchema.safeParse(body);
    if (!problem.success) {
      return fail(failureFromProblem({ status: response.status, requestId }));
    }
    return fail(
      failureFromProblem({
        status: response.status,
        code: problem.data.code,
        detail: problem.data.detail,
        reasons: problem.data.reasons,
        requestId,
      }),
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail(malformedResponseFailure());
  }
  return { ok: true, value: parsed.data };
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface AgentApi {
  getClientConfig(): Promise<ApiResult<ClientConfig>>;
  requestRegistrationOptions(
    displayName: string,
  ): Promise<ApiResult<PublicKeyCredentialCreationOptionsJSON>>;
  verifyRegistration(
    response: RegistrationResponseJSON,
    displayName: string,
  ): Promise<ApiResult<{ principalId: string; credentialId: string }>>;
  propose(prompt: string, policy?: PolicyDocument): Promise<ApiResult<ProposalResponse>>;
  searchProducts(query: string, limit?: number): Promise<ApiResult<ProductSearchResponse>>;
  requestConsentOptions(
    mandateId: string,
  ): Promise<ApiResult<PublicKeyCredentialRequestOptionsJSON>>;
  verifyConsent(
    mandateId: string,
    assertion: AuthenticationResponseJSON,
  ): Promise<ApiResult<ConsentVerifyResponse>>;
  createOrder(mandateId: string): Promise<ApiResult<OrderResponse>>;
  captureOrder(orderId: string, mandateId: string): Promise<ApiResult<CaptureResponse>>;
}

export function createAgentApi(fetchFn: FetchFn): AgentApi {
  // WebAuthn option objects are produced by the server and consumed verbatim by the
  // browser API; only the presence of a challenge is checked here.
  const optionsSchema = z.object({ challenge: z.string().min(1) }).passthrough();

  return {
    getClientConfig: () =>
      call(fetchFn, "/api/v1/paypal/client-config", { method: "GET" }, ClientConfigSchema),

    async requestRegistrationOptions(displayName) {
      const result = await call(
        fetchFn,
        "/api/v1/passkeys/registration/options",
        jsonPost({ displayName }),
        optionsSchema,
      );
      return result.ok
        ? { ok: true, value: result.value as unknown as PublicKeyCredentialCreationOptionsJSON }
        : result;
    },

    async verifyRegistration(response, displayName) {
      const result = await call(
        fetchFn,
        "/api/v1/passkeys/registration/verify",
        jsonPost({ displayName, response }),
        RegistrationResponseSchema,
      );
      return result.ok
        ? {
            ok: true,
            value: {
              principalId: result.value.principalId,
              credentialId: result.value.credentialId,
            },
          }
        : result;
    },

    propose: (prompt, policy) =>
      call(
        fetchFn,
        "/api/v1/proposals",
        jsonPost({ prompt, ...(policy !== undefined ? { policy } : {}) }),
        ProposalResponseSchema,
      ),

    searchProducts: (query, limit) =>
      call(
        fetchFn,
        `/api/v1/products/search?q=${encodeURIComponent(query)}${limit !== undefined ? `&limit=${limit}` : ""}`,
        { method: "GET" },
        ProductSearchResponseSchema,
      ),

    async requestConsentOptions(mandateId) {
      const result = await call(
        fetchFn,
        `/api/v1/mandates/${encodeURIComponent(mandateId)}/consent/options`,
        { method: "POST" },
        optionsSchema,
      );
      return result.ok
        ? { ok: true, value: result.value as unknown as PublicKeyCredentialRequestOptionsJSON }
        : result;
    },

    verifyConsent: (mandateId, assertion) =>
      call(
        fetchFn,
        `/api/v1/mandates/${encodeURIComponent(mandateId)}/consent/verify`,
        jsonPost({ assertion }),
        ConsentVerifyResponseSchema,
      ),

    createOrder: (mandateId) =>
      call(fetchFn, "/api/v1/orders", jsonPost({ mandateId }), OrderResponseSchema),

    captureOrder: (orderId, mandateId) =>
      call(
        fetchFn,
        `/api/v1/orders/${encodeURIComponent(orderId)}/capture`,
        jsonPost({ mandateId }),
        CaptureResponseSchema,
      ),
  };
}
