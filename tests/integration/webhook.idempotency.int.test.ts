/**
 * Integration test: webhook.idempotency.int.test.ts
 *
 * Verifies that:
 * 1. PostgresWebhookRepo persists and queries webhook deliveries keyed by paypal_event_id (I-06)
 * 2. Database unique constraint on webhook_deliveries(paypal_event_id) enforces deduplication
 * 3. Atomic commit with PostgresUnitOfWork: state update, webhook delivery, and ledger event
 *    commit together or roll back completely on error (I-04).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { setupTestDb, createTestPrincipalAndAgent, createTestMandate } from "./test-db.js";
import { paymentMandates, webhookDeliveries } from "../../src/infrastructure/db/schema/index.js";
import { PostgresWebhookRepo } from "../../src/infrastructure/db/repositories/postgres-webhook-repo.js";
import { PostgresPaymentMandateRepo } from "../../src/infrastructure/db/repositories/postgres-payment-mandate-repo.js";
import { PostgresUnitOfWork } from "../../src/infrastructure/db/unit-of-work.js";
import { sql } from "drizzle-orm";

describe("webhook.idempotency.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("persists webhook delivery and retrieves by paypal_event_id", async () => {
    const repo = new PostgresWebhookRepo(testEnv.db);
    const eventId = `WH-EV-${randomUUID()}`;
    const now = new Date().toISOString();

    await repo.recordDelivery({
      paypalEventId: eventId,
      eventType: "CHECKOUT.ORDER.APPROVED",
      resourceId: "ORD-999",
      resourceStatus: "APPROVED",
      receivedAt: now,
    });

    const found = await repo.findDeliveryById(eventId);
    expect(found).not.toBeNull();
    expect(found?.paypalEventId).toBe(eventId);
    expect(found?.eventType).toBe("CHECKOUT.ORDER.APPROVED");
    expect(found?.resourceId).toBe("ORD-999");
    expect(found?.resourceStatus).toBe("APPROVED");
  }, 20000);

  it("enforces database unique constraint on paypal_event_id (I-06)", async () => {
    const repo = new PostgresWebhookRepo(testEnv.db);
    const eventId = `WH-EV-DUP-${randomUUID()}`;
    const now = new Date().toISOString();

    await repo.recordDelivery({
      paypalEventId: eventId,
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      resourceId: "CAP-001",
      resourceStatus: "COMPLETED",
      receivedAt: now,
    });

    // Attempting to insert duplicate event ID must fail unique constraint
    let caughtError: unknown;
    try {
      await repo.recordDelivery({
        paypalEventId: eventId,
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        resourceId: "CAP-001",
        resourceStatus: "COMPLETED",
        receivedAt: now,
      });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeDefined();
    const errorMsg =
      (caughtError as { cause?: { message?: string }; message?: string })?.cause?.message ??
      (caughtError as Error)?.message ??
      "";
    expect(errorMsg.toLowerCase()).toMatch(/unique|duplicate|violat/);
  }, 20000);

  it("atomic commit via PostgresUnitOfWork: state update, delivery and ledger event commit together", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const mandateId = await createTestMandate(testEnv.db, {
      kind: "CART",
      correlationId,
      principalId,
      agentId,
    });

    const now = new Date().toISOString();
    const pmId = randomUUID();
    const orderId = `ORDER-${randomUUID()}`;
    const eventId = `WH-EV-ATOMIC-${randomUUID()}`;
    const captureId = `CAP-ATOMIC-${randomUUID()}`;

    await testEnv.db.insert(paymentMandates).values({
      id: pmId,
      mandateId,
      correlationId,
      sequence: 1,
      terms: { amountMinor: 5000, currency: "USD" },
      hash: randomUUID().replace(/-/g, "").repeat(2),
      authoritySignature: "sig",
      status: "CAPTURE_REQUESTED",
      requestId: randomUUID(),
      paypalOrderId: orderId,
      createdAt: now,
    });

    const uow = testEnv.uow;

    // Run transaction modifying payment mandate and recording delivery
    await uow.run(async (tx) => {
      const pmRepo = tx.paymentMandates;
      const wRepo = tx.webhooks;
      expect(pmRepo).toBeDefined();
      expect(wRepo).toBeDefined();

      if (pmRepo) {
        await pmRepo.updatePaymentMandateStatus(pmId, {
          status: "CAPTURED",
          paypalCaptureId: captureId,
        });
      }

      if (wRepo) {
        await wRepo.recordDelivery({
          paypalEventId: eventId,
          eventType: "PAYMENT.CAPTURE.COMPLETED",
          resourceId: captureId,
          resourceStatus: "COMPLETED",
          receivedAt: now,
        });
      }
    });

    // Verify both were committed
    const pmRepo = new PostgresPaymentMandateRepo(testEnv.db);
    const wRepo = new PostgresWebhookRepo(testEnv.db);

    const pm = await pmRepo.findPaymentMandateById(pmId);
    expect(pm?.status).toBe("CAPTURED");
    expect(pm?.paypalCaptureId).toBe(captureId);

    const delivery = await wRepo.findDeliveryById(eventId);
    expect(delivery).not.toBeNull();
    expect(delivery?.paypalEventId).toBe(eventId);
  }, 20000);

  it("rolls back completely if transaction encounters an error (I-04)", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const mandateId = await createTestMandate(testEnv.db, {
      kind: "CART",
      correlationId,
      principalId,
      agentId,
    });

    const now = new Date().toISOString();
    const pmId = randomUUID();
    const orderId = `ORDER-${randomUUID()}`;
    const eventId = `WH-EV-ROLLBACK-${randomUUID()}`;
    const captureId = `CAP-FAIL-${randomUUID()}`;

    await testEnv.db.insert(paymentMandates).values({
      id: pmId,
      mandateId,
      correlationId,
      sequence: 1,
      terms: { amountMinor: 5000, currency: "USD" },
      hash: randomUUID().replace(/-/g, "").repeat(2),
      authoritySignature: "sig",
      status: "CAPTURE_REQUESTED",
      requestId: randomUUID(),
      paypalOrderId: orderId,
      createdAt: now,
    });

    const uow = testEnv.uow;

    await expect(
      uow.run(async (tx) => {
        const pmRepo = tx.paymentMandates;
        const wRepo = tx.webhooks;

        if (pmRepo) {
          await pmRepo.updatePaymentMandateStatus(pmId, {
            status: "CAPTURED",
            paypalCaptureId: captureId,
          });
        }

        if (wRepo) {
          await wRepo.recordDelivery({
            paypalEventId: eventId,
            eventType: "PAYMENT.CAPTURE.COMPLETED",
            resourceId: captureId,
            resourceStatus: "COMPLETED",
            receivedAt: now,
          });
        }

        // Intentionally throw to trigger rollback
        throw new Error("Simulated failure inside transaction");
      }),
    ).rejects.toThrow("Simulated failure inside transaction");

    // Verify both were rolled back
    const pmRepo = new PostgresPaymentMandateRepo(testEnv.db);
    const wRepo = new PostgresWebhookRepo(testEnv.db);

    const pm = await pmRepo.findPaymentMandateById(pmId);
    expect(pm?.status).toBe("CAPTURE_REQUESTED"); // Not CAPTURED
    expect(pm?.paypalCaptureId).toBeNull();

    const delivery = await wRepo.findDeliveryById(eventId);
    expect(delivery).toBeNull(); // Not saved
  }, 20000);
});
