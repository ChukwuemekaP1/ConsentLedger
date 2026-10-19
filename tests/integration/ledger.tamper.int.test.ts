/**
 * Integration test: ledger.tamper.int.test.ts
 *
 * Proves that if an attacker with privileged DB access bypasses triggers and
 * alters an event's payload, VerifyLedger detects the tamper as HASH_MISMATCH (I-04).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb } from "./test-db.js";
import { AppendLedgerEvent } from "../../src/application/usecases/append-ledger-event.js";
import { VerifyLedger } from "../../src/application/usecases/verify-ledger.js";
import { SystemClock } from "../../src/infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "../../src/infrastructure/clock/crypto-id-generator.js";

describe("ledger.tamper.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("detects payload tampering on stored ledger events", async () => {
    const correlationId = randomUUID();
    const appendUseCase = new AppendLedgerEvent(clock, idGen, testEnv.uow);
    const verifyUseCase = new VerifyLedger(testEnv.ledgerRepo);

    // Append 3 valid events
    for (let i = 1; i <= 3; i++) {
      const res = await appendUseCase.execute({
        correlationId,
        type: "PROPOSAL_CREATED",
        actor: { type: "agent", id: "agent-1" },
        payload: { validSeq: i, amountMinor: 1000 * i },
      });
      expect(res.ok).toBe(true);
    }

    // Verify pristine chain passes
    const initialVerify = await verifyUseCase.verifyCorrelation(correlationId);
    expect(initialVerify.ok).toBe(true);

    // Simulate an attacker with privileged table-owner access modifying a row
    // Temporarily bypass trigger to simulate malicious tampering
    await testEnv.db.execute(sql`ALTER TABLE ledger_events DISABLE TRIGGER USER;`);
    try {
      await testEnv.db.execute(sql`
        UPDATE ledger_events
        SET payload = '{"validSeq": 2, "amountMinor": 999999}'::jsonb
        WHERE correlation_id = ${correlationId} AND seq = 2;
      `);
    } finally {
      await testEnv.db.execute(sql`ALTER TABLE ledger_events ENABLE TRIGGER USER;`);
    }

    // Run verification on the tampered correlation
    const tamperedVerify = await verifyUseCase.verifyCorrelation(correlationId);
    expect(tamperedVerify.ok).toBe(false);
    if (tamperedVerify.ok) return;

    expect(tamperedVerify.error.brokenAtSeq).toBe(2);
    expect(tamperedVerify.error.reason).toBe("HASH_MISMATCH");
  });
});
