/**
 * ProcessWebhookUseCase — Phase 5C: PayPal Webhooks and Payment Reconciliation.
 *
 * Implements verified, durable, and idempotent webhook processing (I-04, I-06, ADR-0006).
 *
 * Key rules:
 * 1. Authenticity verification before processing or state changes (I-01).
 * 2. Deduplication via webhook_deliveries keyed by PayPal event ID (I-06).
 * 3. Atomic state changes and ledger evidence commitment (I-04).
 * 4. Safe event ordering: old approvals/pending events cannot overwrite terminal CAPTURED state.
 * 5. Amount and currency terms verified against authoritative stored payment mandate (I-02).
 * 6. Fail closed on missing webhook configuration or verification failures (I-11).
 *
 * ARCHITECTURE.md §6, §9, §12.
 */

import { type Result, ok, err } from "../../domain/shared/result.js";
import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import type { PaymentProvider, VerifyWebhookRequest } from "../ports/payment-provider.js";
import type { WebhookRepo } from "../ports/webhook-repo.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type { PaymentMandateRepo, PaymentMandateStatus } from "../ports/payment-mandate-repo.js";
import type { UnitOfWork, TxContext } from "../ports/unit-of-work.js";
import type { AppendLedgerEvent } from "./append-ledger-event.js";
import { formatForProvider } from "../../domain/money/money.js";
import { minorUnits } from "../../domain/money/minor-units.js";

export interface ProcessWebhookInput {
  readonly authAlgo: string;
  readonly certUrl: string;
  readonly transmissionId: string;
  readonly transmissionSig: string;
  readonly transmissionTime: string;
  readonly rawBody: Record<string, unknown>;
}

export interface ProcessWebhookOutput {
  readonly eventId: string;
  readonly eventType: string;
  readonly status: "PROCESSED" | "DUPLICATE_IGNORED" | "IGNORED";
  readonly details?: string | undefined;
}

export type ProcessWebhookError =
  | { readonly kind: "WEBHOOK_CONFIG_MISSING"; readonly message: string }
  | { readonly kind: "WEBHOOK_SIGNATURE_INVALID"; readonly message: string }
  | { readonly kind: "MALFORMED_EVENT"; readonly message: string }
  | { readonly kind: "ORDER_NOT_FOUND"; readonly message: string }
  | { readonly kind: "TERMS_MISMATCH"; readonly message: string }
  | { readonly kind: "PROVIDER_ERROR"; readonly message: string; readonly details?: unknown }
  | { readonly kind: "PERSISTENCE_FAILED"; readonly message: string };

export class ProcessWebhookUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly webhookRepo: WebhookRepo,
    private readonly mandateRepo: MandateRepo,
    private readonly paymentMandateRepo: PaymentMandateRepo,
    private readonly paymentProvider: PaymentProvider,
    private readonly webhookId?: string | undefined,
    private readonly unitOfWork?: UnitOfWork | undefined,
    private readonly appendLedgerEvent?: AppendLedgerEvent | undefined,
  ) {}

  async execute(
    input: ProcessWebhookInput,
  ): Promise<Result<ProcessWebhookOutput, ProcessWebhookError>> {
    const now = this.clock.now();

    // 1. Verify Webhook ID configuration
    if (!this.webhookId) {
      return err({
        kind: "WEBHOOK_CONFIG_MISSING",
        message: "Server is not configured with a PayPal Webhook ID",
      });
    }

    // 2. Parse basic event envelope
    const event = input.rawBody;
    const eventId = typeof event["id"] === "string" ? event["id"] : null;
    const eventType = typeof event["event_type"] === "string" ? event["event_type"] : null;
    const resource =
      event["resource"] && typeof event["resource"] === "object"
        ? (event["resource"] as Record<string, unknown>)
        : null;

    if (!eventId || !eventType || !resource) {
      return err({
        kind: "MALFORMED_EVENT",
        message: "Webhook event missing id, event_type, or resource",
      });
    }

    // 3. Deduplication Check (Idempotency — I-06)
    const existingDelivery = await this.webhookRepo.findDeliveryById(eventId);
    if (existingDelivery) {
      return ok({
        eventId,
        eventType,
        status: "DUPLICATE_IGNORED",
        details: "Event already recorded in webhook_deliveries",
      });
    }

    // 4. Verify Webhook Signature Authenticity
    const verifyResult = await this.paymentProvider.verifyWebhookSignature({
      authAlgo: input.authAlgo,
      certUrl: input.certUrl,
      transmissionId: input.transmissionId,
      transmissionSig: input.transmissionSig,
      transmissionTime: input.transmissionTime,
      webhookId: this.webhookId,
      webhookEvent: input.rawBody,
    });

    if (!verifyResult.ok) {
      return err({
        kind: "PROVIDER_ERROR",
        message: `Failed to verify webhook signature: ${verifyResult.error.message}`,
        details: verifyResult.error.details,
      });
    }

    if (!verifyResult.value.verified) {
      return err({
        kind: "WEBHOOK_SIGNATURE_INVALID",
        message: "PayPal rejected webhook signature",
      });
    }

    // 5. Process Verified Event by Type
    switch (eventType) {
      case "CHECKOUT.ORDER.APPROVED":
        return this.handleOrderApproved(eventId, eventType, resource, now);

      case "PAYMENT.CAPTURE.COMPLETED":
        return this.handleCaptureCompleted(eventId, eventType, resource, now);

      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.DECLINED":
        return this.handleCaptureFailed(eventId, eventType, resource, now);

      case "PAYMENT.CAPTURE.PENDING":
        return this.handleCapturePending(eventId, eventType, resource, now);

      default:
        // Ignore unhandled lifecycle events safely while recording delivery
        await this.webhookRepo.recordDelivery({
          paypalEventId: eventId,
          eventType,
          resourceId: typeof resource["id"] === "string" ? resource["id"] : "unknown",
          resourceStatus: typeof resource["status"] === "string" ? resource["status"] : null,
          receivedAt: now,
        });

        return ok({
          eventId,
          eventType,
          status: "IGNORED",
          details: `Event type ${eventType} is not tracked in current checkout lifecycle`,
        });
    }
  }

  /**
   * Handle CHECKOUT.ORDER.APPROVED
   */
  private async handleOrderApproved(
    eventId: string,
    eventType: string,
    resource: Record<string, unknown>,
    now: string,
  ): Promise<Result<ProcessWebhookOutput, ProcessWebhookError>> {
    const orderId = typeof resource["id"] === "string" ? resource["id"] : null;
    if (!orderId) {
      return err({
        kind: "MALFORMED_EVENT",
        message: "CHECKOUT.ORDER.APPROVED resource missing id",
      });
    }

    const pm = await this.paymentMandateRepo.findPaymentMandateByOrderId(orderId);
    if (!pm) {
      // Record delivery so PayPal does not indefinitely retry an unknown order
      await this.webhookRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: orderId,
        resourceStatus: typeof resource["status"] === "string" ? resource["status"] : null,
        receivedAt: now,
      });
      return err({
        kind: "ORDER_NOT_FOUND",
        message: `No payment mandate found for order ${orderId}`,
      });
    }

    const executeTx = async (txCtx?: TxContext) => {
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;
      const wRepo = txCtx?.webhooks ?? this.webhookRepo;

      // Safe event ordering: do not overwrite terminal states
      if (pm.status === "ORDER_CREATED") {
        await pmRepo.updatePaymentMandateStatus(pm.id, {
          status: "APPROVED" as PaymentMandateStatus,
        });
      }

      await wRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: orderId,
        resourceStatus: typeof resource["status"] === "string" ? resource["status"] : null,
        receivedAt: now,
      });

      if (this.appendLedgerEvent) {
        await this.appendLedgerEvent.execute(
          {
            correlationId: pm.correlationId,
            type: "WEBHOOK_RECEIVED",
            actor: { type: "provider", id: "paypal" },
            payload: {
              eventId,
              eventType,
              orderId,
              status: "APPROVED",
            },
          },
          txCtx,
        );
      }
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx(tx));
      } else {
        await executeTx();
      }
    } catch (e) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to persist order approved webhook: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    return ok({
      eventId,
      eventType,
      status: "PROCESSED",
      details: `Order ${orderId} approved recorded`,
    });
  }

  /**
   * Handle PAYMENT.CAPTURE.COMPLETED
   */
  private async handleCaptureCompleted(
    eventId: string,
    eventType: string,
    resource: Record<string, unknown>,
    now: string,
  ): Promise<Result<ProcessWebhookOutput, ProcessWebhookError>> {
    const captureId = typeof resource["id"] === "string" ? resource["id"] : null;
    const orderId = this.extractOrderIdFromCapture(resource);

    if (!captureId) {
      return err({
        kind: "MALFORMED_EVENT",
        message: "PAYMENT.CAPTURE.COMPLETED missing capture id",
      });
    }

    // Look up by order ID if available, or by existing capture ID
    let pm = orderId ? await this.paymentMandateRepo.findPaymentMandateByOrderId(orderId) : null;

    if (!pm) {
      // Record delivery and reject
      await this.webhookRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: captureId,
        resourceStatus: "COMPLETED",
        receivedAt: now,
      });
      return err({
        kind: "ORDER_NOT_FOUND",
        message: `No payment mandate found matching capture ${captureId} / order ${orderId}`,
      });
    }

    // Verify expected terms: amount and currency
    const amountObj = resource["amount"] as { currency_code?: string; value?: string } | undefined;
    if (amountObj?.currency_code && amountObj.value) {
      const mu = minorUnits(pm.terms.payment.amountMinor);
      const expectedAmount = mu.ok
        ? formatForProvider({
            amountMinor: mu.value,
            currency: pm.terms.payment.currency,
          })
        : String(pm.terms.payment.amountMinor);
      if (
        amountObj.currency_code !== pm.terms.payment.currency ||
        amountObj.value !== expectedAmount
      ) {
        return err({
          kind: "TERMS_MISMATCH",
          message: `Capture amount ${amountObj.currency_code} ${amountObj.value} does not match mandate ${pm.terms.payment.currency} ${expectedAmount}`,
        });
      }
    }

    const executeTx = async (txCtx?: TxContext) => {
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;
      const mRepo = txCtx?.mandates ?? this.mandateRepo;
      const wRepo = txCtx?.webhooks ?? this.webhookRepo;

      // Safe event ordering: if not already CAPTURED, update
      if (pm.status !== "CAPTURED") {
        await pmRepo.updatePaymentMandateStatus(pm.id, {
          status: "CAPTURED",
          paypalCaptureId: captureId,
        });

        await mRepo.updateMandateStatus(pm.mandateId, "SETTLED");

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: pm.correlationId,
              type: "CAPTURE_COMPLETED",
              actor: { type: "provider", id: "paypal" },
              payload: {
                eventId,
                eventType,
                orderId: pm.paypalOrderId,
                captureId,
                status: "COMPLETED",
              },
            },
            txCtx,
          );
        }
      }

      await wRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: captureId,
        resourceStatus: "COMPLETED",
        receivedAt: now,
      });
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx(tx));
      } else {
        await executeTx();
      }
    } catch (e) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to commit capture completed webhook: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    return ok({
      eventId,
      eventType,
      status: "PROCESSED",
      details: `Capture ${captureId} completed`,
    });
  }

  /**
   * Handle PAYMENT.CAPTURE.DENIED / DECLINED
   */
  private async handleCaptureFailed(
    eventId: string,
    eventType: string,
    resource: Record<string, unknown>,
    now: string,
  ): Promise<Result<ProcessWebhookOutput, ProcessWebhookError>> {
    const captureId = typeof resource["id"] === "string" ? resource["id"] : null;
    const orderId = this.extractOrderIdFromCapture(resource);

    let pm = orderId ? await this.paymentMandateRepo.findPaymentMandateByOrderId(orderId) : null;

    if (!pm) {
      await this.webhookRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: captureId ?? "unknown",
        resourceStatus: "FAILED",
        receivedAt: now,
      });
      return err({
        kind: "ORDER_NOT_FOUND",
        message: `No payment mandate found for failed capture ${captureId}`,
      });
    }

    const executeTx = async (txCtx?: TxContext) => {
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;
      const mRepo = txCtx?.mandates ?? this.mandateRepo;
      const wRepo = txCtx?.webhooks ?? this.webhookRepo;

      // Safe ordering: do not overwrite terminal CAPTURED
      if (pm.status !== "CAPTURED") {
        await pmRepo.updatePaymentMandateStatus(pm.id, {
          status: "FAILED",
          paypalCaptureId: captureId ?? undefined,
        });

        await mRepo.updateMandateStatus(pm.mandateId, "FAILED");

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: pm.correlationId,
              type: "PROVIDER_ERROR",
              actor: { type: "provider", id: "paypal" },
              payload: {
                eventId,
                eventType,
                orderId: pm.paypalOrderId,
                captureId,
                status: "FAILED",
                error: "Capture denied by provider",
              },
            },
            txCtx,
          );
        }
      }

      await wRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: captureId ?? "unknown",
        resourceStatus: "FAILED",
        receivedAt: now,
      });
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx(tx));
      } else {
        await executeTx();
      }
    } catch (e) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to commit capture failed webhook: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    return ok({
      eventId,
      eventType,
      status: "PROCESSED",
      details: `Capture ${captureId} denied recorded`,
    });
  }

  /**
   * Handle PAYMENT.CAPTURE.PENDING
   */
  private async handleCapturePending(
    eventId: string,
    eventType: string,
    resource: Record<string, unknown>,
    now: string,
  ): Promise<Result<ProcessWebhookOutput, ProcessWebhookError>> {
    const captureId = typeof resource["id"] === "string" ? resource["id"] : null;
    const orderId = this.extractOrderIdFromCapture(resource);

    let pm = orderId ? await this.paymentMandateRepo.findPaymentMandateByOrderId(orderId) : null;

    if (!pm) {
      await this.webhookRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: captureId ?? "unknown",
        resourceStatus: "PENDING",
        receivedAt: now,
      });
      return err({
        kind: "ORDER_NOT_FOUND",
        message: `No payment mandate found for pending capture ${captureId}`,
      });
    }

    const executeTx = async (txCtx?: TxContext) => {
      const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;
      const wRepo = txCtx?.webhooks ?? this.webhookRepo;

      // Safe ordering: do not overwrite terminal CAPTURED or FAILED
      if (pm.status !== "CAPTURED" && pm.status !== "FAILED") {
        await pmRepo.updatePaymentMandateStatus(pm.id, {
          status: "UNKNOWN",
          paypalCaptureId: captureId ?? undefined,
        });

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: pm.correlationId,
              type: "PROVIDER_OUTCOME_UNKNOWN",
              actor: { type: "provider", id: "paypal" },
              payload: {
                eventId,
                eventType,
                orderId: pm.paypalOrderId,
                captureId,
                status: "PENDING",
                message: "Capture status is pending manual/risk review",
              },
            },
            txCtx,
          );
        }
      }

      await wRepo.recordDelivery({
        paypalEventId: eventId,
        eventType,
        resourceId: captureId ?? "unknown",
        resourceStatus: "PENDING",
        receivedAt: now,
      });
    };

    try {
      if (this.unitOfWork) {
        await this.unitOfWork.run(async (tx) => executeTx(tx));
      } else {
        await executeTx();
      }
    } catch (e) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to commit capture pending webhook: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    return ok({
      eventId,
      eventType,
      status: "PROCESSED",
      details: `Capture ${captureId} marked as UNKNOWN (pending review)`,
    });
  }

  /**
   * Helper to extract orderId from PayPal capture resource
   */
  private extractOrderIdFromCapture(resource: Record<string, unknown>): string | null {
    // 1. Check supplementary_data.related_ids.order_id
    const supp = resource["supplementary_data"] as Record<string, unknown> | undefined;
    const related = supp?.["related_ids"] as Record<string, unknown> | undefined;
    if (typeof related?.["order_id"] === "string") {
      return related["order_id"];
    }

    // 2. Check custom_id
    if (typeof resource["custom_id"] === "string") {
      return resource["custom_id"];
    }

    return null;
  }
}
