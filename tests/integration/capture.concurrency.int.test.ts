/**
 * Integration test: capture.concurrency.int.test.ts
 *
 * Proves that concurrent capture attempts against the same payment mandate
 * are serialized via row-level locking (SELECT ... FOR UPDATE) in lockPaymentMandate
 * and duplicate concurrent captures cannot double-capture (ADR-0006).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { setupTestDb, createTestPrincipalAndAgent, createTestMandate } from "./test-db.js";
import { paymentMandates } from "../../src/infrastructure/db/schema/index.js";
import { PostgresPaymentMandateRepo } from "../../src/infrastructure/db/repositories/postgres-payment-mandate-repo.js";
import { sql } from "drizzle-orm";

describe("capture.concurrency.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("locks payment mandate row for update preventing race conditions", async () => {
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

    await testEnv.db.insert(paymentMandates).values({
      id: pmId,
      mandateId,
      correlationId,
      sequence: 1,
      terms: { amountMinor: 7500, currency: "USD" },
      hash: randomUUID().replace(/-/g, "").repeat(2),
      authoritySignature: "sig",
      status: "ORDER_CREATED",
      requestId: randomUUID(),
      paypalOrderId: orderId,
      createdAt: now,
    });

    const repo = new PostgresPaymentMandateRepo(testEnv.db);

    const capReqId = randomUUID();

    // Verify lockPaymentMandate executes successfully inside transaction
    await testEnv.db.transaction(async (tx) => {
      const txRepo = new PostgresPaymentMandateRepo(tx);
      await expect(txRepo.lockPaymentMandate(pmId)).resolves.not.toThrow();

      // Read inside lock
      const locked = await txRepo.findPaymentMandateById(pmId);
      expect(locked?.id).toBe(pmId);
      expect(locked?.status).toBe("ORDER_CREATED");

      // Update inside lock to CAPTURE_REQUESTED
      await txRepo.updatePaymentMandateStatus(pmId, {
        status: "CAPTURE_REQUESTED",
        captureRequestId: capReqId,
      });
    });

    // Check committed status
    const committed = await repo.findPaymentMandateById(pmId);
    expect(committed?.status).toBe("CAPTURE_REQUESTED");
    expect(committed?.captureRequestId).toBe(capReqId);
  }, 20000);

  it("prevents double transition to CAPTURE_REQUESTED under concurrent executions", async () => {
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

    await testEnv.db.insert(paymentMandates).values({
      id: pmId,
      mandateId,
      correlationId,
      sequence: 1,
      terms: { amountMinor: 5000, currency: "USD" },
      hash: randomUUID().replace(/-/g, "").repeat(2),
      authoritySignature: "sig",
      status: "ORDER_CREATED",
      requestId: randomUUID(),
      paypalOrderId: orderId,
      createdAt: now,
    });

    // Simulate two concurrent capture transactions attempting to reserve capture
    let winner: string | null = null;
    let conflictCount = 0;

    const attemptCaptureReservation = async (attemptId: string) => {
      return testEnv.db.transaction(async (tx) => {
        const txRepo = new PostgresPaymentMandateRepo(tx);
        await txRepo.lockPaymentMandate(pmId);

        const current = await txRepo.findPaymentMandateById(pmId);
        if (!current || current.status !== "ORDER_CREATED") {
          conflictCount++;
          return { ok: false, reason: "ALREADY_IN_PROGRESS_OR_COMPLETED" };
        }

        await txRepo.updatePaymentMandateStatus(pmId, {
          status: "CAPTURE_REQUESTED",
          captureRequestId: randomUUID(),
        });

        winner = attemptId;
        return { ok: true };
      });
    };

    const [res1, res2] = await Promise.all([
      attemptCaptureReservation("worker-1"),
      attemptCaptureReservation("worker-2"),
    ]);

    // Exactly one worker must succeed in reserving the capture
    const successes = [res1, res2].filter((r) => r.ok);
    expect(successes).toHaveLength(1);
    expect(conflictCount).toBe(1);
    expect(winner).not.toBeNull();
  }, 20000);
});
