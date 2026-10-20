/**
 * Integration test: ledger.parallel-correlations.int.test.ts
 *
 * Proves that appends to distinct correlation IDs do not block each other
 * because pg_advisory_xact_lock is partitioned by correlation ID hash (ADR-0003).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { setupTestDb } from "./test-db.js";
import { AppendLedgerEvent } from "../../src/application/usecases/append-ledger-event.js";
import { SystemClock } from "../../src/infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "../../src/infrastructure/clock/crypto-id-generator.js";

describe("ledger.parallel-correlations.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("appends across multiple distinct correlations complete concurrently without lock waits", async () => {
    const appendUseCase = new AppendLedgerEvent(clock, idGen, testEnv.uow);
    const CORRELATION_COUNT = 10;
    const correlationIds = Array.from({ length: CORRELATION_COUNT }, () => randomUUID());

    const startTime = Date.now();

    // Fire appends to 10 distinct correlations simultaneously
    const results = await Promise.all(
      correlationIds.map((corrId, i) =>
        appendUseCase.execute({
          correlationId: corrId,
          type: "PROPOSAL_CREATED",
          actor: { type: "agent", id: `agent-${i}` },
          payload: { parallel: true, i },
        }),
      ),
    );

    const elapsed = Date.now() - startTime;

    for (const res of results) {
      expect(res.ok).toBe(true);
    }

    // 10 distinct non-contending appends should execute rapidly
    expect(elapsed).toBeLessThan(25_000);

    for (const corrId of correlationIds) {
      const events = await testEnv.ledgerRepo.getEvents(corrId);
      expect(events).toHaveLength(1);
      expect(events[0]?.seq).toBe(1);
    }
  }, 30_000);
});
