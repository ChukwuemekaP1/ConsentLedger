/**
 * Instrumented Payment Provider.
 *
 * Implements the PaymentProvider port for adversarial scenario tests.
 * Accurately tracks every order creation and capture call, guaranteeing
 * verifiable assertions of zero external provider capture calls (I-01).
 *
 * INVARIANTS: I-01 (No payment without Gate pass), I-02 (Amount equals signed terms).
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
} from "../ports/payment-provider.js";

export interface SeededOrder {
  readonly orderId: string;
  readonly status: OrderStatus;
  readonly requestId: string;
  readonly paymentMandateId: string;
  readonly amountValue: string;
  readonly currency: string;
  captureId?: string | undefined;
}

export class InstrumentedPaymentProvider implements PaymentProvider {
  public createdOrders: Map<string, SeededOrder> = new Map();
  public createOrderCalls: SettlementOrderRequest[] = [];
  public captureOrderCalls: CaptureOrderRequest[] = [];
  public getOrderCalls: string[] = [];
  public verifyWebhookCalls: VerifyWebhookRequest[] = [];
  private orderCounter: number = 1;

  public failNextCreateWith?: PaymentProviderError | undefined;
  public failNextCaptureWith?: PaymentProviderError | undefined;
  public nextCaptureStatus?: CaptureStatus | undefined;
  public nextVerifyResult: boolean = true;

  constructor(private readonly idPrefix: string = "ORDER-LAB") {}

  /**
   * Resets all call history and recorded orders.
   */
  reset(): void {
    this.createdOrders.clear();
    this.createOrderCalls = [];
    this.captureOrderCalls = [];
    this.getOrderCalls = [];
    this.verifyWebhookCalls = [];
    this.failNextCreateWith = undefined;
    this.failNextCaptureWith = undefined;
    this.nextCaptureStatus = undefined;
    this.nextVerifyResult = true;
  }

  /**
   * Pre-seeds an approved order for testing capture scenarios directly.
   */
  seedOrder(order: SeededOrder): void {
    this.createdOrders.set(order.orderId, { ...order });
  }

  /**
   * Returns total count of capture attempts received.
   */
  getCaptureCallCount(): number {
    return this.captureOrderCalls.length;
  }

  /**
   * Returns true if at least one capture attempt occurred.
   */
  hasCaptureAttempted(): boolean {
    return this.captureOrderCalls.length > 0;
  }

  /**
   * Assert that exactly zero capture calls were made.
   * Throws if an unauthorized capture request reached the provider.
   */
  assertZeroCaptureCalls(): void {
    if (this.captureOrderCalls.length > 0) {
      throw new Error(
        `Security assertion failed: Expected 0 capture calls, but received ${this.captureOrderCalls.length}. ` +
          `Order IDs captured: ${this.captureOrderCalls.map((c) => c.orderId).join(", ")}`,
      );
    }
  }

  async createOrder(
    request: SettlementOrderRequest,
  ): Promise<Result<SettlementOrderResult, PaymentProviderError>> {
    this.createOrderCalls.push(request);

    if (this.failNextCreateWith) {
      const error = this.failNextCreateWith;
      this.failNextCreateWith = undefined;
      return err(error);
    }

    // Check for idempotency replay with existing requestId
    for (const existing of this.createdOrders.values()) {
      if (existing.requestId === request.requestId) {
        return ok({
          orderId: existing.orderId,
          status: existing.status,
          links: [
            {
              href: `https://api.sandbox.paypal.com/v2/checkout/orders/${existing.orderId}`,
              rel: "self",
              method: "GET",
            },
          ],
        });
      }
    }

    const { paymentMandateTerms } = request.approval;
    const reqSuffix = request.requestId.replace(/-/g, "").slice(0, 8);
    const orderId = `${this.idPrefix}-${reqSuffix}-${this.orderCounter++}`;
    const amountValue = formatForProvider(paymentMandateTerms.payment as unknown as Money);

    const orderRecord: SeededOrder = {
      orderId,
      status: "CREATED",
      requestId: request.requestId,
      paymentMandateId: paymentMandateTerms.id,
      amountValue,
      currency: paymentMandateTerms.payment.currency,
    };

    this.createdOrders.set(orderId, orderRecord);

    return ok({
      orderId,
      status: "CREATED",
      links: [
        {
          href: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
          rel: "approve",
          method: "GET",
        },
      ],
    });
  }

  async getOrder(orderId: string): Promise<Result<SettlementOrderResult, PaymentProviderError>> {
    this.getOrderCalls.push(orderId);
    const existing = this.createdOrders.get(orderId);
    if (!existing) {
      return err({
        kind: "VALIDATION_FAILED",
        message: `Order ${orderId} not found`,
        status: 404,
      });
    }

    return ok({
      orderId: existing.orderId,
      status: existing.status,
      links: [],
    });
  }

  async captureOrder(
    request: CaptureOrderRequest,
  ): Promise<Result<CaptureOrderResult, PaymentProviderError>> {
    this.captureOrderCalls.push(request);

    if (this.failNextCaptureWith) {
      const error = this.failNextCaptureWith;
      this.failNextCaptureWith = undefined;
      return err(error);
    }

    const existing = this.createdOrders.get(request.orderId);
    if (!existing) {
      return err({
        kind: "VALIDATION_FAILED",
        message: `Order ${request.orderId} not found`,
        status: 404,
      });
    }

    const captureId = `CAPTURE-${request.orderId}`;
    const status: CaptureStatus = this.nextCaptureStatus ?? "COMPLETED";
    this.nextCaptureStatus = undefined;

    existing.captureId = captureId;
    if (status === "COMPLETED") {
      (existing as { status: OrderStatus }).status = "COMPLETED";
    }

    return ok({
      orderId: request.orderId,
      captureId,
      status,
      amount: {
        currency: existing.currency,
        value: existing.amountValue,
      },
    });
  }

  async verifyWebhookSignature(
    request: VerifyWebhookRequest,
  ): Promise<Result<VerifyWebhookResult, PaymentProviderError>> {
    this.verifyWebhookCalls.push(request);
    return ok({ verified: this.nextVerifyResult });
  }
}
