/**
 * Tests for BuildEvidenceBundle use case.
 */

import { describe, it, expect } from "vitest";
import { BuildEvidenceBundle } from "../../../src/application/usecases/build-evidence-bundle.js";
import { InMemoryLedgerRepo } from "../../../tests/fakes/in-memory-ledger-repo.js";
import { FixedClock } from "../../../tests/fakes/fixed-clock.js";
import { appendToChain } from "../../../src/domain/ledger/chain.js";
import { leafHash, buildTree, proveInclusion } from "../../../src/domain/ledger/merkle.js";
import type { Timestamp, Uuid } from "../../../src/domain/shared/clock.js";
import { createValidBundleFixture } from "../domain/evidence-fixture.js";

describe("Application: BuildEvidenceBundle use case", () => {
  it("builds an evidence bundle with events and Merkle inclusion proof", async () => {
    const clock = new FixedClock("2026-10-15T12:00:00.000Z" as Timestamp);
    const ledgerRepo = new InMemoryLedgerRepo();
    const correlationId = "d5f309b6-8575-4d6b-bd85-056345ec48f5";

    // Append 2 events
    const e1 = appendToChain(
      null,
      {
        correlationId,
        type: "PROPOSAL_CREATED",
        actor: { type: "system", id: "gateway" },
        payload: { test: 1 },
      },
      "00000000-0000-4000-8000-000000000001" as Uuid,
      "2026-10-15T11:00:00.000Z" as Timestamp,
    );
    if (!e1.ok) throw new Error("e1 append failed");
    await ledgerRepo.append(e1.value);

    const e2 = appendToChain(
      { hash: e1.value.hash, seq: 1 },
      {
        correlationId,
        type: "CONSENT_RECORDED",
        actor: { type: "system", id: "gateway" },
        payload: { test: 2 },
      },
      "00000000-0000-4000-8000-000000000002" as Uuid,
      "2026-10-15T11:05:00.000Z" as Timestamp,
    );
    if (!e2.ok) throw new Error("e2 append failed");
    await ledgerRepo.append(e2.value);

    const { bundle: fixtureBundle } = createValidBundleFixture();
    const useCase = new BuildEvidenceBundle(clock, ledgerRepo);

    const res = await useCase.execute({
      correlationId,
      authority: fixtureBundle.authority,
      principal: fixtureBundle.principal,
      mandates: fixtureBundle.mandates,
      merchants: fixtureBundle.merchants,
      paymentMandates: fixtureBundle.paymentMandates,
      providerSnapshots: fixtureBundle.provider?.snapshots,
      paypalOrderId: fixtureBundle.provider?.paypalOrderId,
      paypalCaptureIds: fixtureBundle.provider?.paypalCaptureIds,
      checkpoint: fixtureBundle.ledger.checkpoint,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.bundleVersion).toBe(1);
    expect(res.value.correlationId).toBe(correlationId);
    expect(res.value.ledger.events).toHaveLength(2);
    expect(res.value.ledger.checkpoint).toBeDefined();
    expect(res.value.ledger.inclusionProof).toBeDefined();
  });

  it("returns NO_EVENTS_FOUND error if correlation has zero events", async () => {
    const clock = new FixedClock("2026-10-15T12:00:00.000Z" as Timestamp);
    const ledgerRepo = new InMemoryLedgerRepo();
    const useCase = new BuildEvidenceBundle(clock, ledgerRepo);

    const { bundle } = createValidBundleFixture();
    const res = await useCase.execute({
      correlationId: "empty-corr-id",
      authority: bundle.authority,
      principal: bundle.principal,
      mandates: bundle.mandates,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe("NO_EVENTS_FOUND");
  });
});
