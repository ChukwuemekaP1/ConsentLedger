/**
 * Integration test: lab.scenarios.int.test.ts
 *
 * Verifies the Phase 6B Security Lab and adversarial scenario execution
 * against real PostgreSQL storage, real schema triggers, and real transactions.
 *
 * ARCHITECTURE.md §5, §6
 * INVARIANTS: I-01, I-02, I-03, I-04, I-05, I-07, I-09.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { setupTestDb, createTestPrincipalAndAgent } from "./test-db.js";
import {
  SecurityLabRunner,
  InstrumentedPaymentProvider,
  generateDeterministicKeys,
  createStandardPolicy,
  LAB_PRINCIPAL_ID,
  LAB_AGENT_ID,
  type LabContext,
} from "../../src/application/lab/index.js";
import { PostgresMandateRepo } from "../../src/infrastructure/db/repositories/postgres-mandate-repo.js";
import { PostgresPaymentMandateRepo } from "../../src/infrastructure/db/repositories/postgres-payment-mandate-repo.js";
import { PostgresPasskeyRepo } from "../../src/infrastructure/db/repositories/postgres-passkey-repo.js";
import { PostgresLedgerRepo } from "../../src/infrastructure/db/repositories/postgres-ledger-repo.js";
import { PostgresUnitOfWork } from "../../src/infrastructure/db/unit-of-work.js";
import { AppendLedgerEvent } from "../../src/application/usecases/append-ledger-event.js";
import {
  policies,
  principals,
  agents,
  passkeyCredentials,
} from "../../src/infrastructure/db/schema/index.js";
import { SystemClock } from "../../src/infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "../../src/infrastructure/clock/crypto-id-generator.js";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

describe("Security Lab Integration (Real Postgres Storage & Ledger)", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;
  let labContext: LabContext;
  let runner: SecurityLabRunner;
  let paymentProvider: InstrumentedPaymentProvider;

  beforeAll(async () => {
    testEnv = await setupTestDb();

    // 1. Ensure required test principal and agent exist for standard fixtures
    const now = new Date().toISOString();
    await testEnv.db
      .insert(principals)
      .values({
        id: LAB_PRINCIPAL_ID,
        displayName: "Alice Lab Principal",
        createdAt: now,
      })
      .onConflictDoNothing();

    await testEnv.db
      .insert(agents)
      .values({
        id: LAB_AGENT_ID,
        name: "Shopping Agent",
        kind: "builtin-gemini",
        apiKeyHash: "0".repeat(64),
        createdAt: now,
      })
      .onConflictDoNothing();

    await testEnv.db
      .insert(passkeyCredentials)
      .values({
        id: randomUUID(),
        principalId: LAB_PRINCIPAL_ID,
        credentialId: "cred-lab-alice",
        publicKey:
          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfakePublicKeyForLabIntegrationTesting000000000000000000000000000000000000000000000000==",
        counter: 0,
        createdAt: now,
      })
      .onConflictDoNothing();

    // 2. Seed standard lab policy in Postgres
    const { policy, policyHash } = createStandardPolicy();
    await testEnv.db
      .insert(policies)
      .values({
        id: policy.id,
        version: policy.version,
        content: policy,
        hash: policyHash,
        active: true,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [policies.id, policies.version],
        set: {
          content: policy,
          hash: policyHash,
          active: true,
        },
      });

    // 3. Initialize Postgres repository adapters
    const mandateRepo = new PostgresMandateRepo(testEnv.db);
    const paymentMandateRepo = new PostgresPaymentMandateRepo(testEnv.db);
    const passkeyRepo = new PostgresPasskeyRepo(testEnv.db);
    const ledgerRepo = new PostgresLedgerRepo(testEnv.db);
    const uow = new PostgresUnitOfWork(testEnv.db);

    const clock = new SystemClock();
    const idGenerator = new CryptoIdGenerator();

    const appendLedgerEvent = new AppendLedgerEvent(clock, idGenerator, uow);
    paymentProvider = new InstrumentedPaymentProvider(
      `ORDER-INT-${crypto.randomUUID().slice(0, 8)}`,
    );

    const keys = generateDeterministicKeys();

    labContext = {
      clock,
      idGenerator,
      mandateRepo,
      paymentMandateRepo,
      ledgerRepo,
      paymentProvider,
      trustedKeys: keys.trustedKeys,
      authorityKeyPair: keys.authorityKeyPair,
      merchantKeyPair: keys.merchantKeyPair,
      passkeyRepo,
      unitOfWork: uow,
      appendLedgerEvent,
    };

    runner = new SecurityLabRunner();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("executes control valid purchase through real Postgres transactions with 1 capture call", async () => {
    const result = await runner.runScenario("control-valid-purchase", labContext);
    expect(result.runStatus).toBe("PASSED");
    expect(result.decision).toBe("ALLOWED");
    expect(result.captureCallCount).toBe(1);

    // Verify stored mandate transitioned to SETTLED in Postgres
    const mandateId = result.evidenceReferences?.find((r) => r.type === "MANDATE")?.id;
    expect(mandateId).toBeDefined();
    if (!mandateId) throw new Error("mandateId missing");

    const storedMandate = await labContext.mandateRepo.findMandateById(mandateId);
    expect(storedMandate).not.toBeNull();
    expect(storedMandate?.status).toBe("SETTLED");
  });

  it("blocks amount tampering attack in real Postgres and persists ATTACK_SIMULATED ledger event", async () => {
    paymentProvider.reset();

    const result = await runner.runScenario("amount-manipulation", labContext);

    expect(result.runStatus).toBe("PASSED");
    expect(result.decision).toBe("BLOCKED");
    expect(result.reasonCode).toBe("TERMS_MISMATCH");
    expect(result.captureCallCount).toBe(0);
    expect(() => paymentProvider.assertZeroCaptureCalls()).not.toThrow();

    // Verify that ATTACK_SIMULATED event was persisted in PostgreSQL ledger_events table
    const mandateId = result.evidenceReferences?.find((r) => r.type === "MANDATE")?.id;
    expect(mandateId).toBeDefined();
    if (!mandateId) throw new Error("mandateId missing");

    const storedMandate = await labContext.mandateRepo.findMandateById(mandateId);
    const correlationId = storedMandate?.terms.correlationId;
    expect(correlationId).toBeDefined();
    if (!correlationId || !labContext.ledgerRepo)
      throw new Error("missing correlationId or ledgerRepo");

    const ledgerEvents = await labContext.ledgerRepo.getEvents(correlationId);
    const attackEvent = ledgerEvents.find((e) => e.type === "ATTACK_SIMULATED");

    expect(attackEvent).toBeDefined();
    expect(attackEvent?.payload).toHaveProperty("scenarioId", "amount-manipulation");
    expect(attackEvent?.payload).toHaveProperty("actualDecision", "BLOCKED");
    expect(attackEvent?.payload).toHaveProperty("runStatus", "PASSED");
  });

  it("blocks merchant substitution attack with zero provider calls (I-02)", async () => {
    paymentProvider.reset();

    const result = await runner.runScenario("merchant-substitution", labContext);

    expect(result.runStatus).toBe("PASSED");
    expect(result.decision).toBe("BLOCKED");
    expect(result.reasonCode).toBe("TERMS_MISMATCH");
    expect(result.captureCallCount).toBe(0);
    expect(() => paymentProvider.assertZeroCaptureCalls()).not.toThrow();
  });

  it("blocks replay attack and prevents double capture in real database (I-04)", async () => {
    paymentProvider.reset();

    const result = await runner.runScenario("reuse-consumed-approval", labContext);

    expect(result.runStatus).toBe("PASSED");
    expect(result.decision).toBe("BLOCKED");
    expect(result.reasonCode).toBe("REPLAY_DETECTED");
    expect(result.captureCallCount).toBe(0); // Zero second capture calls
  });
});
