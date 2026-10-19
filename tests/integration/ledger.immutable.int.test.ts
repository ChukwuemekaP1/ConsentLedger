/**
 * Integration test: ledger.immutable.int.test.ts
 *
 * Proves that database triggers prevent UPDATE, DELETE, and TRUNCATE on ledger_events (I-04).
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb } from "./test-db.js";
import { AppendLedgerEvent } from "../../src/application/usecases/append-ledger-event.js";
import { SystemClock } from "../../src/infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "../../src/infrastructure/clock/crypto-id-generator.js";

describe("ledger.immutable.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("blocks UPDATE on ledger_events via database trigger", async () => {
    const correlationId = randomUUID();
    const appendUseCase = new AppendLedgerEvent(clock, idGen, testEnv.uow);

    const appendRes = await appendUseCase.execute({
      correlationId,
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { immutable: true },
    });
    expect(appendRes.ok).toBe(true);

    // Attempt direct UPDATE
    await expect(
      testEnv.db.execute(sql`
        UPDATE ledger_events
        SET payload = '{"tampered": true}'::jsonb
        WHERE correlation_id = ${correlationId}
      `),
    ).rejects.toThrow(/ledger is append-only/i);
  });

  it("blocks DELETE on ledger_events via database trigger", async () => {
    const correlationId = randomUUID();
    const appendUseCase = new AppendLedgerEvent(clock, idGen, testEnv.uow);

    const appendRes = await appendUseCase.execute({
      correlationId,
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { deleteMe: false },
    });
    expect(appendRes.ok).toBe(true);

    // Attempt direct DELETE
    await expect(
      testEnv.db.execute(sql`
        DELETE FROM ledger_events
        WHERE correlation_id = ${correlationId}
      `),
    ).rejects.toThrow(/ledger is append-only/i);
  });

  it("blocks TRUNCATE on ledger_events via statement-level trigger", async () => {
    await expect(testEnv.db.execute(sql`TRUNCATE TABLE ledger_events`)).rejects.toThrow(
      /ledger is append-only.*TRUNCATE/i,
    );
  });
});
