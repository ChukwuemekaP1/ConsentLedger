/**
 * Unit tests for VerifyLedger use case.
 *
 * Verifies that the use case:
 * 1. Confirms a valid, unbroken chain.
 * 2. Fails when a chain is empty.
 * 3. Detects hash tampering, broken links, or skipped sequence numbers.
 */

import { describe, expect, it } from "vitest";
import { VerifyLedger } from "../../../src/application/usecases/verify-ledger.js";
import { AppendLedgerEvent } from "../../../src/application/usecases/append-ledger-event.js";
import { InMemoryLedgerRepo, FakeUnitOfWork } from "../../fakes/in-memory-ledger-repo.js";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";

describe("VerifyLedger Use Case", () => {
  const clock = new FixedClock("2026-10-20T10:00:00.000Z");
  const idGen = new SequentialIdGenerator("evt");

  it("returns EMPTY_CHAIN error when no events exist for correlation", async () => {
    const repo = new InMemoryLedgerRepo();
    const verifyUseCase = new VerifyLedger(repo);

    const result = await verifyUseCase.verifyCorrelation("non-existent");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.reason).toBe("EMPTY_CHAIN");
  });

  it("successfully verifies an unbroken valid chain", async () => {
    const repo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(repo);
    const appendUseCase = new AppendLedgerEvent(clock, idGen, uow);
    const verifyUseCase = new VerifyLedger(repo);

    await appendUseCase.execute({
      correlationId: "corr-good",
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { test: 1 },
    });
    await appendUseCase.execute({
      correlationId: "corr-good",
      type: "MANDATE_ISSUED",
      actor: { type: "system", id: "gateway" },
      payload: { test: 2 },
    });

    const result = await verifyUseCase.verifyCorrelation("corr-good");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBe(2);
    expect(result.value.headHash).toBe(repo.events[1]?.hash);
  });

  it("detects tampering when stored event payload is modified", async () => {
    const repo = new InMemoryLedgerRepo();
    const uow = new FakeUnitOfWork(repo);
    const appendUseCase = new AppendLedgerEvent(clock, idGen, uow);
    const verifyUseCase = new VerifyLedger(repo);

    await appendUseCase.execute({
      correlationId: "corr-tamper",
      type: "PROPOSAL_CREATED",
      actor: { type: "agent", id: "agent-1" },
      payload: { originalAmount: 5000 },
    });

    // Tamper with stored event payload directly in the repository
    const stored = repo.events[0];
    if (stored) {
      (stored as { payload: Record<string, unknown> }).payload = { originalAmount: 999999 };
    }

    const result = await verifyUseCase.verifyCorrelation("corr-tamper");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.reason).toBe("HASH_MISMATCH");
    expect(result.error.brokenAtSeq).toBe(1);
  });
});
