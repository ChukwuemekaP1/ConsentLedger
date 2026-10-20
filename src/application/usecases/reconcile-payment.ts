/**
 * ReconcilePaymentUseCase — Phase 5C: Payment Reconciliation.
 *
 * Reconciles pending, timeout, or unknown capture outcomes by fetching authoritative
 * state from PayPal and updating local mandate and ledger state atomically (I-04, I-11).
 *
 * ARCHITECTURE.md §6, §12.
 */

import { type Result, ok, err } from "../../domain/shared/result.js";
import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import type { PaymentProvider, OrderStatus } from "../ports/payment-provider.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type { PaymentMandateRepo, PaymentMandateStatus } from "../ports/payment-mandate-repo.js";
import type { UnitOfWork, TxContext } from "../ports/unit-of-work.js";
import type { AppendLedgerEvent } from "./append-ledger-event.js";

export interface ReconcilePaymentInput {
  readonly orderId: string;
}

export interface ReconcilePaymentOutput {
  readonly orderId: string;
  readonly status: PaymentMandateStatus | OrderStatus;
  readonly reconciled: boolean;
  readonly details: string;
}

export type ReconcilePaymentError =
  | { readonly kind: "ORDER_NOT_FOUND"; readonly message: string }
  | { readonly kind: "MANDATE_NOT_FOUND"; readonly message: string }
  | { readonly kind: "PROVIDER_ERROR"; readonly message: string; readonly details?: unknown }
  | { readonly kind: "PERSISTENCE_FAILED"; readonly message: string };

export class ReconcilePaymentUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly mandateRepo: MandateRepo,
    private readonly paymentMandateRepo: PaymentMandateRepo,
    private readonly paymentProvider: PaymentProvider,
    private readonly unitOfWork?: UnitOfWork | undefined,
    private readonly appendLedgerEvent?: AppendLedgerEvent | undefined,
  ) {}

  async execute(
    input: ReconcilePaymentInput,
  ): Promise<Result<ReconcilePaymentOutput, ReconcilePaymentError>> {
    const now = this.clock.now();

    // 1. Authoritative lookup of local payment mandate
    const pm = await this.paymentMandateRepo.findPaymentMandateByOrderId(input.orderId);
    if (!pm) {
      return err({
        kind: "ORDER_NOT_FOUND",
        message: `No payment mandate found for PayPal order ${input.orderId}`,
      });
    }

    const mandate = await this.mandateRepo.findMandateById(pm.mandateId);
    if (!mandate) {
      return err({
        kind: "MANDATE_NOT_FOUND",
        message: `Mandate ${pm.mandateId} not found`,
      });
    }

    // 2. Terminal State Check: if already CAPTURED, no reconciliation needed
    if (pm.status === "CAPTURED") {
      return ok({
        orderId: input.orderId,
        status: "CAPTURED",
        reconciled: true,
        details: "Payment is already marked CAPTURED",
      });
    }

    // 3. Query PayPal authoritative state
    const orderResult = await this.paymentProvider.getOrder(input.orderId);
    if (!orderResult.ok) {
      return err({
        kind: "PROVIDER_ERROR",
        message: `Failed to query PayPal order status: ${orderResult.error.message}`,
        details: orderResult.error.details,
      });
    }

    const providerStatus = orderResult.value.status;

    // 4. Handle provider statuses
    if (providerStatus === "COMPLETED") {
      // PayPal confirms the order was settled
      const executeTx = async (txCtx?: TxContext) => {
        const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;
        const mRepo = txCtx?.mandates ?? this.mandateRepo;

        await pmRepo.updatePaymentMandateStatus(pm.id, {
          status: "CAPTURED",
        });

        await mRepo.updateMandateStatus(pm.mandateId, "SETTLED");

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: pm.correlationId,
              type: "RECONCILED_OK",
              actor: { type: "system", id: "reconciler" },
              payload: {
                orderId: input.orderId,
                paymentMandateId: pm.id,
                providerStatus: "COMPLETED",
                localStatus: "CAPTURED",
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
          message: `Failed to commit reconciliation outcome: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      return ok({
        orderId: input.orderId,
        status: "CAPTURED",
        reconciled: true,
        details: "Payment successfully reconciled as CAPTURED from PayPal COMPLETED",
      });
    }

    if (providerStatus === "VOIDED") {
      const executeTx = async (txCtx?: TxContext) => {
        const pmRepo = txCtx?.paymentMandates ?? this.paymentMandateRepo;
        const mRepo = txCtx?.mandates ?? this.mandateRepo;

        await pmRepo.updatePaymentMandateStatus(pm.id, {
          status: "FAILED",
        });

        await mRepo.updateMandateStatus(pm.mandateId, "FAILED");

        if (this.appendLedgerEvent) {
          await this.appendLedgerEvent.execute(
            {
              correlationId: pm.correlationId,
              type: "RECONCILED_MISMATCH",
              actor: { type: "system", id: "reconciler" },
              payload: {
                orderId: input.orderId,
                paymentMandateId: pm.id,
                providerStatus: "VOIDED",
                localStatus: "FAILED",
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
          message: `Failed to commit reconciliation outcome: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      return ok({
        orderId: input.orderId,
        status: "FAILED",
        reconciled: true,
        details: "Payment reconciled as FAILED from PayPal VOIDED",
      });
    }

    // If APPROVED, order is ready for capture
    if (providerStatus === "APPROVED") {
      return ok({
        orderId: input.orderId,
        status: "APPROVED" as PaymentMandateStatus,
        reconciled: true,
        details: "PayPal order is APPROVED by buyer, awaiting capture",
      });
    }

    return ok({
      orderId: input.orderId,
      status: providerStatus,
      reconciled: true,
      details: `PayPal order status is ${providerStatus}`,
    });
  }
}
