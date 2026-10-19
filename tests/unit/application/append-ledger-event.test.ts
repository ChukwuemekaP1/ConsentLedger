/**
 * Unit tests for AppendLedgerEvent use case.
 *
 * Verifies that the use case:
 * 1. Correctly calculates seq and prevHash starting from 1 with ZERO_HASH.
 * 2. Chains successive events monotonically.
 * 3. Locks correlation before reading head and writing.
 * 4. Fails cleanly when given non-canonical payloads without mutating state.
 * 5. Respects external transaction contexts for atomic multi-step operations.
 */

import { describe, expect, it } from "vitest";
import { AppendLedgerEvent } from "../../../src/application/usecases/append-ledger-event.js";
import { InMemoryLedgerRepo, FakeUnitOfWork } from "../../fakes/in-memory-ledger-repo.js";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import { ZERO_HASH } from "../../../src/domain/crypto/hash.js";
import type { LedgerEventDraft } from "../../../src/domain/ledger/index.js";

describe("AppendLedgerEvent Use Case", () => {
  const clock = new FixedClock("2026-10-20T10:00:00.000Z");
  const idGen = new SequentialIdGenerator("evt");

  it("appends the first event to a new correlation with seq=1 and ZERO_HASH", async () => {
    const repo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(repo);
    const useCase = new AppendLedgerEvent(clock, idGen, uow);

    const draft: LedgerEventDraft = {
      correlationId: "corr-100",
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { prompt: "Test spend", amountMinor: 5000 },
    };

    const result = await useCase.execute(draft);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.seq).toBe(1);
    expect(result.value.prevHash).toBe(ZERO_HASH);
    expect(result.value.correlationId).toBe("corr-100");
    expect(result.value.createdAt).toBe("2026-10-20T10:00:00.000Z");
    expect(repo.events).toHaveLength(1);
    expect(repo.lockedCorrelations).toContain("corr-100");
  });

  it("chains subsequent events with incremented seq and matching prevHash", async () => {
    const repo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(repo);
    const useCase = new AppendLedgerEvent(clock, idGen, uow);

    const draft1: LedgerEventDraft = {
      correlationId: "corr-200",
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { step: 1 },
    };
    const res1 = await useCase.execute(draft1);
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;

    const draft2: LedgerEventDraft = {
      correlationId: "corr-200",
      type: "MANDATE_ISSUED",
      actor: { type: "system", id: "gateway" },
      payload: { step: 2 },
    };
    const res2 = await useCase.execute(draft2);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;

    expect(res2.value.seq).toBe(2);
    expect(res2.value.prevHash).toBe(res1.value.hash);
    expect(repo.events).toHaveLength(2);
  });

  it("rejects non-canonical payloads without mutating the ledger", async () => {
    const repo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(repo);
    const useCase = new AppendLedgerEvent(clock, idGen, uow);

    const draft: LedgerEventDraft = {
      correlationId: "corr-300",
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { invalidFloat: 12.345 },
    };

    const result = await useCase.execute(draft);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("PAYLOAD_NOT_CANONICAL");
    expect(repo.events).toHaveLength(0);
  });

  it("executes within caller-provided transaction context", async () => {
    const repo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(repo);
    const useCase = new AppendLedgerEvent(clock, idGen, uow);

    let executedInTx = false;

    await uow.run(async (tx) => {
      const draft: LedgerEventDraft = {
        correlationId: "corr-400",
        type: "PROPOSAL_CREATED",
        actor: { type: "agent", id: "agent-1" },
        payload: { atomic: true },
      };
      const result = await useCase.execute(draft, tx);
      expect(result.ok).toBe(true);
      executedInTx = true;
    });

    expect(executedInTx).toBe(true);
    expect(repo.events).toHaveLength(1);
    expect(repo.lockedCorrelations).toContain("corr-400");
  });
});
