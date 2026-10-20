/**
 * In-memory test double for PaymentProvider.
 *
 * Simulates PayPal Orders v2 for unit tests and local development.
 * Allows simulating network errors, rate limits, and custom responses.
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
} from "../../application/ports/payment-provider.js";

export class FakePaymentProvider implements PaymentProvider {
  public createdOrders: Map<
    string,
    {
      orderId: string;
      status: OrderStatus;
      requestId: string;
      paymentMandateId: string;
      amountValue: string;
      currency: string;
      captureId?: string;
    }
  > = new Map();

  public calls: SettlementOrderRequest[] = [];
  public captureCalls: CaptureOrderRequest[] = [];
  public verifyWebhookCalls: VerifyWebhookRequest[] = [];
  public failNextWith?: PaymentProviderError | undefined;
  public failNextCaptureWith?: PaymentProviderError | undefined;
  public failNextVerifyWith?: PaymentProviderError | undefined;
  public nextCaptureStatus?: CaptureStatus | undefined;
  public nextVerifyResult: boolean = true;

  constructor(private readonly idPrefix: string = "ORDER-FAKE") {}

  async createOrder(
    request: SettlementOrderRequest,
  ): Promise<Result<SettlementOrderResult, PaymentProviderError>> {
    this.calls.push(request);

    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = undefined;
      return err(error);
    }

    // Check if an order was already created with this requestId (idempotency simulation)
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
    const orderId = `${this.idPrefix}-${this.createdOrders.size + 1}`;
    const amountValue = formatForProvider(paymentMandateTerms.payment as unknown as Money);

    const orderRecord = {
      orderId,
      status: "CREATED" as OrderStatus,
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
    this.captureCalls.push(request);

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
      existing.status = "COMPLETED";
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

    if (this.failNextVerifyWith) {
      const error = this.failNextVerifyWith;
      this.failNextVerifyWith = undefined;
      return err(error);
    }

    return ok({ verified: this.nextVerifyResult });
  }
}
