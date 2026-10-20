/**
 * Unit tests for PayPalAdapter.
 *
 * Verifies OAuth2 token fetching and caching, Orders v2 order creation,
 * idempotency header (PayPal-Request-Id), formatForProvider wire formatting (I-02),
 * and error mapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PayPalAdapter } from "../../../../src/infrastructure/paypal/paypal-adapter.js";
import type { GateApproval } from "../../../../src/domain/gate/types.js";
import type { PaymentMandateTerms } from "../../../../src/domain/mandate/types.js";
import type { Timestamp } from "../../../../src/domain/shared/clock.js";

describe("PayPalAdapter", () => {
  let mockFetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    mockFetch.mockRestore();
    vi.restoreAllMocks();
  });

  const fakeApproval = {
    paymentMandateTerms: {
      v: 1,
      kind: "PAYMENT",
      id: "pm-1234",
      correlationId: "corr-1234",
      parent: { mandateId: "mand-1234", hash: "a".repeat(64), kind: "CART" },
      modality: "HP",
      sequence: 1,
      payee: { merchantId: "merchant-1" },
      payment: { amountMinor: 8500, currency: "USD" },
      agentId: "agent-1",
      createdAt: "2026-10-20T10:00:00.000Z",
    } as unknown as PaymentMandateTerms,
    approvedAt: "2026-10-20T10:00:00.000Z" as Timestamp,
  } as unknown as GateApproval;

  it("fetches and caches OAuth2 token until expiration", async () => {
    // 1. Mock token response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "test-token-123",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    });

    const adapter = new PayPalAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const token1 = await adapter.getAccessToken();
    expect(token1.ok).toBe(true);
    if (!token1.ok) return;
    expect(token1.value).toBe("test-token-123");

    // Second call should reuse cached token without calling fetch again
    const token2 = await adapter.getAccessToken();
    expect(token2.ok).toBe(true);
    if (!token2.ok) return;
    expect(token2.value).toBe("test-token-123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const tokenCall = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(tokenCall[0]).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect((tokenCall[1].headers as Record<string, string>).Authorization).toContain("Basic ");
  });

  it("handles OAuth2 authentication failure (401)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid client credentials",
    });

    const adapter = new PayPalAdapter({
      clientId: "bad-id",
      clientSecret: "bad-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const result = await adapter.getAccessToken();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("AUTHENTICATION_FAILED");
  });

  it("creates order with PayPal-Request-Id and formatted amount (I-02)", async () => {
    // Mock token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-token",
        expires_in: 3600,
      }),
    });

    // Mock create order
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      text: async () =>
        JSON.stringify({
          id: "ORDER-999",
          status: "CREATED",
          links: [
            {
              href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-999",
              rel: "approve",
              method: "GET",
            },
          ],
        }),
    });

    const adapter = new PayPalAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const result = await adapter.createOrder({
      approval: fakeApproval,
      requestId: "req-unique-uuid-1234",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orderId).toBe("ORDER-999");
    expect(result.value.status).toBe("CREATED");

    // Verify order call payload and headers
    const orderCall = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(orderCall[0]).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const headers = orderCall[1].headers as Record<string, string>;
    expect(headers["PayPal-Request-Id"]).toBe("req-unique-uuid-1234");
    expect(headers["Authorization"]).toBe("Bearer mock-token");

    const payload = JSON.parse(orderCall[1].body as string);
    expect(payload.intent).toBe("CAPTURE");
    expect(payload.purchase_units[0].reference_id).toBe("pm-1234");
    expect(payload.purchase_units[0].custom_id).toBe("pm-1234");
    // $85.00 -> 8500 minor units -> "85.00" string via formatForProvider
    expect(payload.purchase_units[0].amount.value).toBe("85.00");
    expect(payload.purchase_units[0].amount.currency_code).toBe("USD");
  });

  it("accepts HTTP 200 as idempotent success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-token",
        expires_in: 3600,
      }),
    });

    // PayPal returns 200 on repeated requests with same PayPal-Request-Id
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "ORDER-EXISTING",
          status: "CREATED",
        }),
    });

    const adapter = new PayPalAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const result = await adapter.createOrder({
      approval: fakeApproval,
      requestId: "req-existing-1234",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orderId).toBe("ORDER-EXISTING");
  });

  it("maps 422 Unprocessable Entity to VALIDATION_FAILED", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-token",
        expires_in: 3600,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          name: "UNPROCESSABLE_ENTITY",
          message: "The requested action could not be performed",
          details: [{ issue: "CURRENCY_NOT_SUPPORTED" }],
        }),
    });

    const adapter = new PayPalAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const result = await adapter.createOrder({
      approval: fakeApproval,
      requestId: "req-invalid",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("VALIDATION_FAILED");
  });

  it("maps 429 to RATE_LIMITED", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-token",
        expires_in: 3600,
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded",
    });

    const adapter = new PayPalAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const result = await adapter.createOrder({
      approval: fakeApproval,
      requestId: "req-rate",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("RATE_LIMITED");
  });

  it("maps network fetch error to NETWORK_ERROR", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-token",
        expires_in: 3600,
      }),
    });

    mockFetch.mockRejectedValueOnce(new Error("Connection reset by peer"));

    const adapter = new PayPalAdapter({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      baseUrl: "https://api-m.sandbox.paypal.com",
    });

    const result = await adapter.createOrder({
      approval: fakeApproval,
      requestId: "req-fail",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("NETWORK_ERROR");
  });

  describe("captureOrder", () => {
    it("successfully captures order and returns COMPLETED status with capture details", async () => {
      // Mock token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "mock-token",
          expires_in: 3600,
        }),
      });

      // Mock capture response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            id: "ORDER-12345",
            status: "COMPLETED",
            purchase_units: [
              {
                reference_id: "default",
                payments: {
                  captures: [
                    {
                      id: "CAPTURE-9999",
                      status: "COMPLETED",
                      amount: { currency_code: "USD", value: "85.00" },
                    },
                  ],
                },
              },
            ],
          }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.captureOrder({
        orderId: "ORDER-12345",
        captureRequestId: "cap-req-001",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("COMPLETED");
      expect(result.value.captureId).toBe("CAPTURE-9999");
      expect(result.value.orderId).toBe("ORDER-12345");

      // Verify headers
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const captureCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(captureCall[0]).toBe(
        "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-12345/capture",
      );
      const headers = captureCall[1].headers as Record<string, string>;
      expect(headers["PayPal-Request-Id"]).toBe("cap-req-001");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Authorization).toBe("Bearer mock-token");
    });

    it("returns PENDING status when PayPal capture is pending review", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: "ORDER-12345",
            status: "PROCESSING",
            purchase_units: [
              {
                payments: {
                  captures: [{ id: "CAP-PENDING", status: "PENDING" }],
                },
              },
            ],
          }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.captureOrder({
        orderId: "ORDER-12345",
        captureRequestId: "cap-req-002",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("PENDING");
      expect(result.value.captureId).toBe("CAP-PENDING");
    });

    it("maps 422 UNPROCESSABLE_ENTITY to VALIDATION_FAILED", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            name: "UNPROCESSABLE_ENTITY",
            message: "Order already captured",
            details: [{ issue: "ORDER_ALREADY_CAPTURED" }],
          }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.captureOrder({
        orderId: "ORDER-12345",
        captureRequestId: "cap-req-003",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("VALIDATION_FAILED");
    });

    it("maps 429 to RATE_LIMITED", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.captureOrder({
        orderId: "ORDER-12345",
        captureRequestId: "cap-req-004",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("RATE_LIMITED");
    });

    it("maps network fetch failure to NETWORK_ERROR", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockRejectedValueOnce(new Error("ETIMEDOUT: Connection timed out"));

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.captureOrder({
        orderId: "ORDER-12345",
        captureRequestId: "cap-req-005",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("NETWORK_ERROR");
    });
  });

  describe("verifyWebhookSignature", () => {
    const fakeWebhookRequest = {
      authAlgo: "SHA256withRSA",
      certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123",
      transmissionId: "trans-abc-123",
      transmissionSig: "sig-base64-xyz",
      transmissionTime: "2026-10-20T10:00:00Z",
      webhookId: "WH-123456789",
      webhookEvent: {
        id: "WH-EV-001",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: { id: "CAP-001", status: "COMPLETED" },
      },
    };

    it("returns verified: true when PayPal returns verification_status: SUCCESS", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ verification_status: "SUCCESS" }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.verifyWebhookSignature(fakeWebhookRequest);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.verified).toBe(true);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const verifyCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(verifyCall[0]).toBe(
        "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature",
      );
      const parsedReqBody = JSON.parse(verifyCall[1].body as string);
      expect(parsedReqBody.auth_algo).toBe("SHA256withRSA");
      expect(parsedReqBody.webhook_id).toBe("WH-123456789");
      expect(parsedReqBody.webhook_event.id).toBe("WH-EV-001");
    });

    it("returns verified: false when PayPal returns verification_status: FAILURE", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ verification_status: "FAILURE" }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.verifyWebhookSignature(fakeWebhookRequest);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.verified).toBe(false);
    });

    it("maps 400 validation error to VALIDATION_FAILED", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            name: "VALIDATION_ERROR",
            message: "Invalid transmission signature",
          }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.verifyWebhookSignature(fakeWebhookRequest);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("VALIDATION_FAILED");
    });

    it("maps 401/403 to AUTHENTICATION_FAILED", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ message: "Invalid OAuth token" }),
      });

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.verifyWebhookSignature(fakeWebhookRequest);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("AUTHENTICATION_FAILED");
    });

    it("maps fetch timeout to TIMEOUT", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "mock-token", expires_in: 3600 }),
      });

      const timeoutError = new Error("The operation was aborted");
      timeoutError.name = "TimeoutError";
      mockFetch.mockRejectedValueOnce(timeoutError);

      const adapter = new PayPalAdapter({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        baseUrl: "https://api-m.sandbox.paypal.com",
      });

      const result = await adapter.verifyWebhookSignature(fakeWebhookRequest);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("TIMEOUT");
    });
  });
});
