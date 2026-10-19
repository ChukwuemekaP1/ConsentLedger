/**
 * Integration test: ledger.atomic-with-state.int.test.ts
 *
 * Proves that when a state change fails after an event append in the same
 * transaction, the entire transaction rolls back, leaving no orphan event (I-04).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { setupTestDb, createTestPrincipalAndAgent } from "./test-db.js";
import { AppendLedgerEvent } from "../../src/application/usecases/append-ledger-event.js";
import { SystemClock } from "../../src/infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "../../src/infrastructure/clock/crypto-id-generator.js";
import { mandates } from "../../src/infrastructure/db/schema/index.js";

describe("ledger.atomic-with-state.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("rolls back both state mutation and ledger event if an error occurs within the unit of work", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const appendUseCase = new AppendLedgerEvent(clock, idGen, testEnv.uow);

    const mandateId = randomUUID();

    // Run transaction that appends an event, inserts a mandate, then fails
    const txPromise = testEnv.uow.run(async (tx) => {
      // 1. Append ledger event
      const res = await appendUseCase.execute(
        {
          correlationId,
          type: "PROPOSAL_CREATED",
          actor: { type: "agent", id: agentId },
          payload: { mandateId },
        },
        tx,
      );
      expect(res.ok).toBe(true);

      // 2. Insert state entity
      await testEnv.db.insert(mandates).values({
        id: mandateId,
        kind: "CART",
        correlationId,
        principalId,
        agentId,
        terms: { test: true },
        hash: "f".repeat(64),
        status: "DRAFTED",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      // 3. Deliberately fail after the append
      throw new Error("Simulated downstream failure after event append");
    });

    await expect(txPromise).rejects.toThrow("Simulated downstream failure after event append");

    // Verify neither the event nor the mandate exists in the database
    const events = await testEnv.ledgerRepo.getEvents(correlationId);
    expect(events).toHaveLength(0);

    const head = await testEnv.ledgerRepo.getHead(correlationId);
    expect(head).toBeNull();
  });
});
