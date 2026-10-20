/**
 * Real PayPal Orders v2 REST client adapter.
 *
 * Implements PaymentProvider for PayPal Sandbox and Production environments.
 * Uses client-credentials token caching, mandatory PayPal-Request-Id idempotency,
 * and wire formatting via formatForProvider (I-02).
 *
 * Reference:
 *   - https://developer.paypal.com/api/orders/v2/
 *   - ARCHITECTURE.md §6
 *   - ADR-0006
 */

import { type Result, ok, err } from "../../domain/shared/result.js";
import type { Money } from "../../domain/money/money.js";
import { formatForProvider } from "../../domain/money/money.js";
import type {
  PaymentProvider,
  SettlementOrderRequest,
  SettlementOrderResult,
  CaptureOrderRequest,
  CaptureOrderResult,
  CaptureStatus,
  VerifyWebhookRequest,
  VerifyWebhookResult,
  PaymentProviderError,
  OrderStatus,
  OrderLink,
} from "../../application/ports/payment-provider.js";
import { childLogger } from "../logging/logger.js";

const log = childLogger({ requestId: "paypal-adapter" });

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

export interface PayPalAdapterOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly env?: "sandbox" | "live";
  readonly timeoutMs?: number;
  readonly baseUrl?: string;
}

export class PayPalAdapter implements PaymentProvider {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private tokenCache: TokenCache | null = null;

  constructor(options: PayPalAdapterOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.timeoutMs = options.timeoutMs ?? 10_000;

    if (options.baseUrl) {
      this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    } else {
      this.baseUrl =
        options.env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    }
  }

  /**
   * Obtain an OAuth2 Bearer token using client_credentials grant.
   * Caches token in-memory until 60 seconds before expiration.
   */
  async getAccessToken(): Promise<Result<string, PaymentProviderError>> {
    const nowMs = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAtMs > nowMs + 60_000) {
      return ok(this.tokenCache.accessToken);
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const tokenUrl = `${this.baseUrl}/v1/oauth2/token`;

    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        log.error(
          { status: response.status, statusText: response.statusText },
          "PayPal OAuth2 token request failed",
        );
        if (response.status === 401 || response.status === 403) {
          return err({
            kind: "AUTHENTICATION_FAILED",
            message: "Invalid PayPal client credentials",
            status: response.status,
          });
        }
        if (response.status === 429) {
          return err({
            kind: "RATE_LIMITED",
            message: "PayPal OAuth2 rate limit reached",
            status: response.status,
          });
        }
        return err({
          kind: "PROVIDER_ERROR",
          message: `PayPal token endpoint returned ${response.status}: ${errorText}`,
          status: response.status,
        });
      }

      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!data.access_token || typeof data.expires_in !== "number") {
        return err({
          kind: "PROVIDER_ERROR",
          message: "Malformed token response from PayPal",
        });
      }

      this.tokenCache = {
        accessToken: data.access_token,
        expiresAtMs: nowMs + data.expires_in * 1000,
      };

      return ok(data.access_token);
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      log.error({ error: e instanceof Error ? e.message : String(e) }, "PayPal OAuth2 fetch error");
      return err({
        kind: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: e instanceof Error ? e.message : "Network error fetching PayPal token",
      });
    }
  }

  /**
   * Create an Order in PayPal Orders v2.
   * Uses stored requestId as PayPal-Request-Id for idempotency.
   * Converts minor units via formatForProvider (I-02).
   */
  async createOrder(
    request: SettlementOrderRequest,
  ): Promise<Result<SettlementOrderResult, PaymentProviderError>> {
    const tokenResult = await this.getAccessToken();
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const { paymentMandateTerms } = request.approval;
    const wireValue = formatForProvider(paymentMandateTerms.payment as unknown as Money);

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: paymentMandateTerms.id,
          custom_id: paymentMandateTerms.id,
          amount: {
            currency_code: paymentMandateTerms.payment.currency,
            value: wireValue,
          },
        },
      ],
    };

    const ordersUrl = `${this.baseUrl}/v2/checkout/orders`;

    try {
      const response = await fetch(ordersUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenResult.value}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": request.requestId,
          Prefer: "return=representation",
        },
        body: JSON.stringify(orderPayload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const responseBody = await response.text();
      let parsedBody: {
        id?: string;
        status?: string;
        links?: Array<{ href: string; rel: string; method?: string }>;
        message?: string;
        name?: string;
        details?: unknown;
      } = {};

      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        // Body was not JSON
      }

      // 201 Created is the standard response; 200 OK is returned on idempotent replay
      if (response.status === 201 || response.status === 200) {
        if (!parsedBody.id || !parsedBody.status) {
          return err({
            kind: "PROVIDER_ERROR",
            message: "PayPal response missing order ID or status",
            details: parsedBody,
          });
        }

        return ok({
          orderId: parsedBody.id,
          status: parsedBody.status as OrderStatus,
          links: (parsedBody.links ?? []).map((l) => ({
            href: l.href,
            rel: l.rel,
            method: l.method,
          })) as readonly OrderLink[],
        });
      }

      // Map error codes
      if (response.status === 400 || response.status === 422) {
        return err({
          kind: "VALIDATION_FAILED",
          message: parsedBody.message ?? "PayPal order validation failed",
          status: response.status,
          details: parsedBody.details ?? parsedBody,
        });
      }

      if (response.status === 401 || response.status === 403) {
        return err({
          kind: "AUTHENTICATION_FAILED",
          message: parsedBody.message ?? "PayPal authorization failed",
          status: response.status,
        });
      }

      if (response.status === 429) {
        return err({
          kind: "RATE_LIMITED",
          message: "PayPal rate limit exceeded",
          status: response.status,
        });
      }

      return err({
        kind: "PROVIDER_ERROR",
        message: parsedBody.message ?? `PayPal returned HTTP ${response.status}`,
        status: response.status,
        details: parsedBody,
      });
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      log.error(
        { error: e instanceof Error ? e.message : String(e) },
        "PayPal create order exception",
      );
      return err({
        kind: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: e instanceof Error ? e.message : "Network error contacting PayPal",
      });
    }
  }

  /**
   * Fetch an existing Order by ID.
   */
  async getOrder(orderId: string): Promise<Result<SettlementOrderResult, PaymentProviderError>> {
    const tokenResult = await this.getAccessToken();
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const orderUrl = `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`;

    try {
      const response = await fetch(orderUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${tokenResult.value}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return err({
          kind: "PROVIDER_ERROR",
          message: `PayPal getOrder failed with ${response.status}: ${text}`,
          status: response.status,
        });
      }

      const data = (await response.json()) as {
        id?: string;
        status?: string;
        links?: Array<{ href: string; rel: string; method?: string }>;
      };

      if (!data.id || !data.status) {
        return err({
          kind: "PROVIDER_ERROR",
          message: "PayPal order missing id or status",
        });
      }

      return ok({
        orderId: data.id,
        status: data.status as OrderStatus,
        links: data.links as readonly OrderLink[],
      });
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return err({
        kind: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: e instanceof Error ? e.message : "Error contacting PayPal",
      });
    }
  }

  /**
   * Capture an approved order at PayPal Orders v2.
   * Passes captureRequestId as PayPal-Request-Id header for idempotency.
   */
  async captureOrder(
    request: CaptureOrderRequest,
  ): Promise<Result<CaptureOrderResult, PaymentProviderError>> {
    const tokenResult = await this.getAccessToken();
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const captureUrl = `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(request.orderId)}/capture`;

    try {
      const response = await fetch(captureUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenResult.value}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": request.captureRequestId,
          Prefer: "return=representation",
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const responseBody = await response.text();
      let parsedBody: {
        id?: string;
        status?: string;
        purchase_units?: Array<{
          payments?: {
            captures?: Array<{
              id?: string;
              status?: string;
              amount?: { currency_code?: string; value?: string };
            }>;
          };
        }>;
        message?: string;
        details?: unknown;
      } = {};

      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        // Not JSON
      }

      if (response.status === 201 || response.status === 200) {
        const capture = parsedBody.purchase_units?.[0]?.payments?.captures?.[0];
        const captureId = capture?.id ?? parsedBody.id;
        const captureStatus = (capture?.status ??
          parsedBody.status ??
          "COMPLETED") as CaptureStatus;

        return ok({
          orderId: parsedBody.id ?? request.orderId,
          captureId,
          status: captureStatus,
          amount: capture?.amount
            ? {
                currency: capture.amount.currency_code ?? "",
                value: capture.amount.value ?? "",
              }
            : undefined,
        });
      }

      if (response.status === 400 || response.status === 422) {
        return err({
          kind: "VALIDATION_FAILED",
          message: parsedBody.message ?? "PayPal capture validation failed",
          status: response.status,
          details: parsedBody.details ?? parsedBody,
        });
      }

      if (response.status === 401 || response.status === 403) {
        return err({
          kind: "AUTHENTICATION_FAILED",
          message: parsedBody.message ?? "PayPal capture authorization failed",
          status: response.status,
        });
      }

      if (response.status === 429) {
        return err({
          kind: "RATE_LIMITED",
          message: "PayPal rate limit exceeded during capture",
          status: response.status,
        });
      }

      return err({
        kind: "PROVIDER_ERROR",
        message: parsedBody.message ?? `PayPal capture returned HTTP ${response.status}`,
        status: response.status,
        details: parsedBody,
      });
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      log.error(
        { error: e instanceof Error ? e.message : String(e) },
        "PayPal capture order exception",
      );
      return err({
        kind: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        message: e instanceof Error ? e.message : "Network error contacting PayPal capture",
      });
    }
  }

  /**
   * Verify an incoming webhook event signature via PayPal's verify-webhook-signature API.
   * https://developer.paypal.com/api/rest/webhooks/rest/#verify-webhook-signature
   */
  async verifyWebhookSignature(
    request: VerifyWebhookRequest,
  ): Promise<Result<VerifyWebhookResult, PaymentProviderError>> {
    const tokenResult = await this.getAccessToken();
    if (!tokenResult.ok) {
      return tokenResult;
    }

    const verifyUrl = `${this.baseUrl}/v1/notifications/verify-webhook-signature`;

    try {
      const response = await fetch(verifyUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenResult.value}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: request.authAlgo,
          cert_url: request.certUrl,
          transmission_id: request.transmissionId,
          transmission_sig: request.transmissionSig,
          transmission_time: request.transmissionTime,
          webhook_id: request.webhookId,
          webhook_event: request.webhookEvent,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const responseBody = await response.text();
      let parsedBody: {
        verification_status?: string;
        message?: string;
        name?: string;
      } = {};

      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        // Not JSON
      }

      if (response.ok) {
        const isSuccess = parsedBody.verification_status === "SUCCESS";
        return ok({ verified: isSuccess });
      }

      if (response.status === 400 || response.status === 422) {
        return err({
          kind: "VALIDATION_FAILED",
          message: parsedBody.message ?? "PayPal webhook verification validation error",
          status: response.status,
          details: parsedBody,
        });
      }

      if (response.status === 401 || response.status === 403) {
        return err({
          kind: "AUTHENTICATION_FAILED",
          message: parsedBody.message ?? "PayPal authorization failed during webhook verification",
          status: response.status,
        });
      }

      return err({
        kind: "PROVIDER_ERROR",
        message:
          parsedBody.message ?? `PayPal verify-webhook-signature returned HTTP ${response.status}`,
        status: response.status,
        details: parsedBody,
      });
    } catch (e) {
      const isTimeout =
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      log.error(
        { error: e instanceof Error ? e.message : String(e) },
        "PayPal verify webhook exception",
      );
      return err({
        kind: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        message:
          e instanceof Error ? e.message : "Network error contacting PayPal webhook verification",
      });
    }
  }
}
