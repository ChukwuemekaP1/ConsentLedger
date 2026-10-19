/**
 * Integration test: ledger.concurrency.int.test.ts
 *
 * Proves that 50 concurrent appends to the same correlation ID are safely
 * serialized by pg_advisory_xact_lock, producing a contiguous unbroken chain (I-04).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { setupTestDb } from "./test-db.js";
import { AppendLedgerEvent } from "../../src/application/usecases/append-ledger-event.js";
import { VerifyLedger } from "../../src/application/usecases/verify-ledger.js";
import { SystemClock } from "../../src/infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "../../src/infrastructure/clock/crypto-id-generator.js";

describe("ledger.concurrency.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("50 concurrent appends to one correlation produce a contiguous valid chain", async () => {
    const correlationId = randomUUID();
    const appendUseCase = new AppendLedgerEvent(clock, idGen, testEnv.uow);
    const verifyUseCase = new VerifyLedger(testEnv.ledgerRepo);

    const CONCURRENCY_COUNT = 50;

    // Launch 50 simultaneous append promises
    const promises = Array.from({ length: CONCURRENCY_COUNT }, (_, i) =>
      appendUseCase.execute({
        correlationId,
        type: "PROPOSAL_CREATED",
        actor: { type: "agent", id: `agent-${i}` },
        payload: { itemIndex: i, tag: "concurrent-test" },
      }),
    );

    const results = await Promise.all(promises);

    // Every append must succeed
    for (const res of results) {
      expect(res.ok).toBe(true);
    }

    // Verify chain integrity in domain
    const verifyResult = await verifyUseCase.verifyCorrelation(correlationId);
    expect(verifyResult.ok).toBe(true);
    if (!verifyResult.ok) return;

    expect(verifyResult.value.length).toBe(CONCURRENCY_COUNT);

    // Verify all sequence numbers from 1 to 50 are present with no gaps or duplicates
    const events = await testEnv.ledgerRepo.getEvents(correlationId);
    expect(events).toHaveLength(CONCURRENCY_COUNT);

    const seqs = events.map((e) => e.seq);
    const expectedSeqs = Array.from({ length: CONCURRENCY_COUNT }, (_, i) => i + 1);
    expect(seqs).toEqual(expectedSeqs);
  }, 40_000);
});
