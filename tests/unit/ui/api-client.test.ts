import { describe, expect, it, vi } from "vitest";
import { createAgentApi, type FetchFn } from "../../../src/ui/agent/api-client.js";
import { MANDATE_HASH, MANDATE_ID, proposalResponse } from "../../ui/fixtures.js";

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "req-1" },
    ...init,
  });

const problemResponse = (status: number, body: object): Response =>
  json(body, {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": "req-9" },
  });

function apiWith(fetchFn: FetchFn) {
  return createAgentApi(fetchFn);
}

describe("agent API client: requests", () => {
  it("creates an order from the mandate id alone, never from payment terms (I-02)", async () => {
    const fetchFn = vi.fn<FetchFn>(async () =>
      json({ orderId: "O-1", paymentMandateId: "pm", status: "CREATED" }, { status: 201 }),
    );
    const result = await apiWith(fetchFn).createOrder(MANDATE_ID);

    expect(result).toEqual({
      ok: true,
      value: { orderId: "O-1", paymentMandateId: "pm", status: "CREATED" },
    });
    const [path, init] = fetchFn.mock.calls[0] ?? [];
    expect(path).toBe("/api/v1/orders");
    expect(JSON.parse(String(init?.body))).toEqual({ mandateId: MANDATE_ID });
  });

  it("requests consent options and posts the assertion for the same mandate id", async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(json({ challenge: "abc", rpId: "localhost" }))
      .mockResolvedValueOnce(
        json({
          status: "ok",
          mandateId: MANDATE_ID,
          mandateHash: MANDATE_HASH,
          credentialId: "c",
          mandateStatus: "SIGNED",
          verifiedAt: "t",
        }),
      );
    const api = apiWith(fetchFn);
    const options = await api.requestConsentOptions(MANDATE_ID);
    expect(options.ok && options.value.challenge).toBe("abc");
    const verified = await api.verifyConsent(MANDATE_ID, { id: "x" } as never);
    expect(verified.ok).toBe(true);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`/api/v1/mandates/${MANDATE_ID}/consent/options`);
    expect(fetchFn.mock.calls[1]?.[0]).toBe(`/api/v1/mandates/${MANDATE_ID}/consent/verify`);
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toEqual({
      assertion: { id: "x" },
    });
  });

  it("url-encodes identifiers placed in the path", async () => {
    const fetchFn = vi.fn<FetchFn>(async () => json({ orderId: "a/b", status: "COMPLETED" }));
    await apiWith(fetchFn).captureOrder("a/b ?x", MANDATE_ID);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("/api/v1/orders/a%2Fb%20%3Fx/capture");
  });
});

describe("agent API client: responses are parsed, not cast", () => {
  it("parses a valid proposal response", async () => {
    const result = await apiWith(async () => json(proposalResponse(), { status: 201 })).propose(
      "keyboard",
    );
    expect(result.ok && result.value.mandate.terms.payee.displayName).toBe("ShopX");
  });

  it("treats a 200 with an unexpected body as a failure, not success (I-11)", async () => {
    const result = await apiWith(async () => json({ unexpected: true })).createOrder(MANDATE_ID);
    expect(result).toMatchObject({ ok: false, failure: { code: "MALFORMED_RESPONSE" } });
  });

  it("rejects a proposal whose mandate terms do not match the schema", async () => {
    const bad = proposalResponse();
    const response = {
      ...bad,
      mandate: { ...bad.mandate, terms: { ...bad.mandate.terms, kind: "INTENT" } },
    };
    const result = await apiWith(async () => json(response, { status: 201 })).propose("x");
    expect(result.ok).toBe(false);
  });

  it("treats consent options without a challenge as unusable", async () => {
    const result = await apiWith(async () => json({ rpId: "localhost" })).requestConsentOptions(
      MANDATE_ID,
    );
    expect(result).toMatchObject({ ok: false, failure: { code: "MALFORMED_RESPONSE" } });
  });
});

describe("agent API client: errors", () => {
  it("maps problem+json to a named failure and keeps the request id", async () => {
    const result = await apiWith(async () =>
      problemResponse(403, { code: "CONSENT_INVALID", detail: "challenge mismatch", status: 403 }),
    ).verifyConsent(MANDATE_ID, {} as never);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        category: "consent",
        code: "CONSENT_INVALID",
        requestId: "req-9",
        retryable: true,
      },
    });
  });

  it("maps the proposals policy-denied problem (no code field) to a denial with reasons", async () => {
    const result = await apiWith(async () =>
      problemResponse(422, {
        title: "Policy Denied",
        detail: "denied",
        reasons: ["TX_CAP_EXCEEDED"],
      }),
    ).propose("big purchase");
    expect(result).toMatchObject({
      ok: false,
      failure: { category: "denied", reasons: ["TX_CAP_EXCEEDED"] },
    });
  });

  it("reports a network error as retryable", async () => {
    const result = await apiWith(async () => {
      throw new TypeError("Failed to fetch");
    }).propose("x");
    expect(result).toMatchObject({ ok: false, failure: { category: "network", retryable: true } });
  });

  it("handles a non-JSON error body", async () => {
    const result = await apiWith(
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
    ).propose("x");
    expect(result).toMatchObject({ ok: false, failure: { category: "provider", retryable: true } });
  });
});
