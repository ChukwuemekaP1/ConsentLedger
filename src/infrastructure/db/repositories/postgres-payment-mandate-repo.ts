/**
 * Postgres implementation of PaymentMandateRepo.
 *
 * Persists and queries payment mandates using Drizzle ORM.
 * ARCHITECTURE.md §4.1, §6, §12.
 */

import { eq, count, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { paymentMandates } from "../schema/payment-mandates.js";
import type {
  PaymentMandateRepo,
  StoredPaymentMandateRecord,
  PaymentMandateStatus,
} from "../../../application/ports/payment-mandate-repo.js";
import type { PaymentMandateTerms } from "../../../domain/mandate/types.js";

export class PostgresPaymentMandateRepo implements PaymentMandateRepo {
  constructor(private readonly db: Database) {}

  async findPaymentMandateById(id: string): Promise<StoredPaymentMandateRecord | null> {
    const rows = await this.db
      .select()
      .from(paymentMandates)
      .where(eq(paymentMandates.id, id))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return this.mapRow(row);
  }

  async findPaymentMandateByMandateId(
    mandateId: string,
  ): Promise<StoredPaymentMandateRecord | null> {
    const rows = await this.db
      .select()
      .from(paymentMandates)
      .where(eq(paymentMandates.mandateId, mandateId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return this.mapRow(row);
  }

  async findPaymentMandateByOrderId(orderId: string): Promise<StoredPaymentMandateRecord | null> {
    const rows = await this.db
      .select()
      .from(paymentMandates)
      .where(eq(paymentMandates.paypalOrderId, orderId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return this.mapRow(row);
  }

  async countByMandateId(mandateId: string): Promise<number> {
    const res = await this.db
      .select({ value: count() })
      .from(paymentMandates)
      .where(eq(paymentMandates.mandateId, mandateId));

    return res[0]?.value ?? 0;
  }

  async lockPaymentMandate(id: string): Promise<void> {
    await this.db.execute(sql`SELECT id FROM payment_mandates WHERE id = ${id} FOR UPDATE;`);
  }

  async insertPaymentMandate(record: {
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
  }): Promise<StoredPaymentMandateRecord> {
    const rows = await this.db
      .insert(paymentMandates)
      .values({
        id: record.id,
        mandateId: record.mandateId,
        correlationId: record.correlationId,
        sequence: record.sequence,
        terms: record.terms,
        hash: record.hash,
        authoritySignature: record.authoritySignature,
        status: record.status,
        requestId: record.requestId,
        createdAt: record.createdAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error(`Failed to insert payment mandate ${record.id}`);
    }

    return this.mapRow(row);
  }

  async updatePaymentMandateStatus(
    id: string,
    update: {
      readonly status: PaymentMandateStatus;
      readonly paypalOrderId?: string;
      readonly captureRequestId?: string;
      readonly paypalCaptureId?: string;
    },
  ): Promise<void> {
    await this.db
      .update(paymentMandates)
      .set({
        status: update.status,
        ...(update.paypalOrderId !== undefined ? { paypalOrderId: update.paypalOrderId } : {}),
        ...(update.captureRequestId !== undefined
          ? { captureRequestId: update.captureRequestId }
          : {}),
        ...(update.paypalCaptureId !== undefined
          ? { paypalCaptureId: update.paypalCaptureId }
          : {}),
      })
      .where(eq(paymentMandates.id, id));
  }

  private mapRow(row: typeof paymentMandates.$inferSelect): StoredPaymentMandateRecord {
    return {
      id: row.id,
      mandateId: row.mandateId,
      correlationId: row.correlationId,
      sequence: row.sequence,
      terms: row.terms as PaymentMandateTerms,
      hash: row.hash,
      authoritySignature: row.authoritySignature,
      status: row.status as PaymentMandateStatus,
      requestId: row.requestId,
      captureRequestId: row.captureRequestId,
      paypalOrderId: row.paypalOrderId,
      paypalCaptureId: row.paypalCaptureId,
      createdAt: row.createdAt,
    };
  }
}
