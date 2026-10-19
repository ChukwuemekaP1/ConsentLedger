/**
 * Integration test: cart.single-use.int.test.ts
 *
 * Proves that a CART mandate yields at most one payment mandate (I-03).
 * Sequence > 1 is rejected by the trigger, and sequence = 1 is unique per mandate.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { setupTestDb, createTestPrincipalAndAgent, createTestMandate } from "./test-db.js";
import { paymentMandates } from "../../src/infrastructure/db/schema/index.js";

describe("cart.single-use.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("permits sequence = 1 on CART mandate but rejects sequence > 1 via database trigger (I-03)", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const mandateId = await createTestMandate(testEnv.db, {
      kind: "CART",
      correlationId,
      principalId,
      agentId,
    });

    const now = new Date().toISOString();

    // 1. First execution: sequence = 1 succeeds
    await testEnv.db.insert(paymentMandates).values({
      id: randomUUID(),
      mandateId,
      correlationId,
      sequence: 1,
      terms: { amountMinor: 5000, currency: "USD" },
      hash: "1".repeat(64),
      authoritySignature: "sig1",
      status: "AUTHORIZED",
      requestId: randomUUID(),
      createdAt: now,
    });

    // 2. Second execution attempt: sequence = 2 is rejected by enforce_cart_single_use trigger
    await expect(
      testEnv.db.insert(paymentMandates).values({
        id: randomUUID(),
        mandateId,
        correlationId,
        sequence: 2,
        terms: { amountMinor: 5000, currency: "USD" },
        hash: "2".repeat(64),
        authoritySignature: "sig2",
        status: "AUTHORIZED",
        requestId: randomUUID(),
        createdAt: now,
      }),
    ).rejects.toThrow(/cart mandates allow sequence = 1 only/i);
  });

  it("rejects duplicate sequence = 1 via unique constraint", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const mandateId = await createTestMandate(testEnv.db, {
      kind: "CART",
      correlationId,
      principalId,
      agentId,
    });

    const now = new Date().toISOString();

    await testEnv.db.insert(paymentMandates).values({
      id: randomUUID(),
      mandateId,
      correlationId,
      sequence: 1,
      terms: { amountMinor: 5000 },
      hash: "3".repeat(64),
      authoritySignature: "sig3",
      status: "AUTHORIZED",
      requestId: randomUUID(),
      createdAt: now,
    });

    // Attempt duplicate sequence = 1 on same mandate
    await expect(
      testEnv.db.insert(paymentMandates).values({
        id: randomUUID(),
        mandateId,
        correlationId,
        sequence: 1,
        terms: { amountMinor: 5000 },
        hash: "4".repeat(64),
        authoritySignature: "sig4",
        status: "AUTHORIZED",
        requestId: randomUUID(),
        createdAt: now,
      }),
    ).rejects.toThrow(/payment_mandates_mandate_seq_idx/i);
  });
});
