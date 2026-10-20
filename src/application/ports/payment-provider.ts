/**
 * Payment Provider port.
 *
 * Defines the contract for initiating orders and querying order status with a payment gateway.
 * Crucially, order creation requires a verified GateApproval capability (I-01).
 *
 * ARCHITECTURE.md §6, §12.
 * INVARIANTS: I-01 (No payment without Gate pass), I-02 (Amount equals signed terms).
 */

import type { Result } from "../../domain/shared/result.js";
import type { GateApproval } from "../../domain/gate/types.js";

export interface SettlementOrderRequest {
  /** Branded GateApproval proving Gate evaluation passed. */
  readonly approval: GateApproval;
  /** Stored unique request ID for idempotency (PayPal-Request-Id). */
  readonly requestId: string;
}

export type OrderStatus =
  "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";

export interface OrderLink {
  readonly href: string;
  readonly rel: string;
  readonly method?: string;
}

export interface SettlementOrderResult {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly links?: readonly OrderLink[];
}

export interface CaptureOrderRequest {
  /** PayPal Order ID to capture. */
  readonly orderId: string;
  /** Stored unique capture request ID for idempotency (PayPal-Request-Id). */
  readonly captureRequestId: string;
}

export type CaptureStatus = "COMPLETED" | "PENDING" | "FAILED" | "DECLINED";

export interface CaptureOrderResult {
  readonly orderId: string;
  readonly captureId?: string | undefined;
  readonly status: CaptureStatus;
  readonly amount?:
    | {
        readonly currency: string;
        readonly value: string;
      }
    | undefined;
}

export interface VerifyWebhookRequest {
  readonly authAlgo: string;
  readonly certUrl: string;
  readonly transmissionId: string;
  readonly transmissionSig: string;
  readonly transmissionTime: string;
  readonly webhookId: string;
  readonly webhookEvent: Record<string, unknown>;
}

export interface VerifyWebhookResult {
  readonly verified: boolean;
}

export interface PaymentProviderError {
  readonly kind:
    | "AUTHENTICATION_FAILED"
    | "VALIDATION_FAILED"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "TIMEOUT"
    | "PROVIDER_ERROR";
  readonly message: string;
  readonly status?: number;
  readonly details?: unknown;
}

export interface PaymentProvider {
  /**
   * Create an authorized checkout order at the payment provider.
   * Must pass stored requestId for idempotency and GateApproval for verified terms.
   */
  createOrder(
    request: SettlementOrderRequest,
  ): Promise<Result<SettlementOrderResult, PaymentProviderError>>;

  /**
   * Fetch order status from the provider by provider order ID.
   */
  getOrder(orderId: string): Promise<Result<SettlementOrderResult, PaymentProviderError>>;

  /**
   * Capture an authorized/approved order at the payment provider.
   * Uses stored captureRequestId as PayPal-Request-Id.
   */
  captureOrder(
    request: CaptureOrderRequest,
  ): Promise<Result<CaptureOrderResult, PaymentProviderError>>;

  /**
   * Verify an incoming webhook event signature via PayPal's verify-webhook-signature API.
   */
  verifyWebhookSignature(
    request: VerifyWebhookRequest,
  ): Promise<Result<VerifyWebhookResult, PaymentProviderError>>;
}
