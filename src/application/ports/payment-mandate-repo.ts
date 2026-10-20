/**
 * Payment Mandate repository port.
 *
 * Persists and queries derived payment mandates, gateway signatures,
 * provider request IDs and order IDs.
 *
 * ARCHITECTURE.md §4.1, §6, §12.
 */

import type { PaymentMandateTerms } from "../../domain/mandate/types.js";

export type PaymentMandateStatus =
  "AUTHORIZED" | "ORDER_CREATED" | "CAPTURE_REQUESTED" | "CAPTURED" | "FAILED" | "UNKNOWN";

export interface StoredPaymentMandateRecord {
  readonly id: string;
  readonly mandateId: string;
  readonly correlationId: string;
  readonly sequence: number;
  readonly terms: PaymentMandateTerms;
  readonly hash: string;
  readonly authoritySignature: string;
  readonly status: PaymentMandateStatus;
  readonly requestId: string;
  readonly captureRequestId?: string | null;
  readonly paypalOrderId?: string | null;
  readonly paypalCaptureId?: string | null;
  readonly createdAt: string;
}

export interface PaymentMandateRepo {
  findPaymentMandateById(id: string): Promise<StoredPaymentMandateRecord | null>;
  findPaymentMandateByMandateId(mandateId: string): Promise<StoredPaymentMandateRecord | null>;
  findPaymentMandateByOrderId(orderId: string): Promise<StoredPaymentMandateRecord | null>;
  countByMandateId(mandateId: string): Promise<number>;
  lockPaymentMandate(id: string): Promise<void>;

  insertPaymentMandate(record: {
    readonly id: string;
    readonly mandateId: string;
    readonly correlationId: string;
    readonly sequence: number;
    readonly terms: PaymentMandateTerms;
    readonly hash: string;
    readonly authoritySignature: string;
    readonly status: PaymentMandateStatus;
    readonly requestId: string;
    readonly createdAt: string;
  }): Promise<StoredPaymentMandateRecord>;

  updatePaymentMandateStatus(
    id: string,
    update: {
      readonly status: PaymentMandateStatus;
      readonly paypalOrderId?: string | undefined;
      readonly captureRequestId?: string | undefined;
      readonly paypalCaptureId?: string | undefined;
    },
  ): Promise<void>;
}
