/**
 * Integration test: budget.check-constraint.int.test.ts
 *
 * Proves that database CHECK constraints enforce budget invariants (I-03):
 * 1. spent_minor + reserved_minor <= total_minor
 * 2. spent_minor, reserved_minor, and total_minor >= 0
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, createTestPrincipalAndAgent, createTestMandate } from "./test-db.js";
import { budgets } from "../../src/infrastructure/db/schema/index.js";

describe("budget.check-constraint.int.test", () => {
  let testEnv: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    testEnv = await setupTestDb();
  });

  afterAll(async () => {
    await testEnv?.close();
  });

  it("rejects budget allocation where spent + reserved exceeds total (I-03)", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const mandateId = await createTestMandate(testEnv.db, {
      kind: "INTENT",
      correlationId,
      principalId,
      agentId,
    });

    const now = new Date().toISOString();

    // 1. Initial valid budget setup
    await testEnv.db.insert(budgets).values({
      mandateId,
      totalMinor: 10000,
      spentMinor: 0,
      reservedMinor: 0,
      txCount: 0,
      maxTransactions: 5,
      perTxMaxMinor: 5000,
      updatedAt: now,
    });

    // 2. Attempt overspending: reserved 6000 + spent 5000 = 11000 > 10000
    await expect(
      testEnv.db.execute(sql`
        UPDATE budgets
        SET spent_minor = 5000, reserved_minor = 6000
        WHERE mandate_id = ${mandateId};
      `),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as { cause?: { message?: string }; message?: string };
      return /budget_limit_check/i.test(e?.cause?.message || e?.message || "");
    });
  });

  it("rejects negative money values in budgets", async () => {
    const correlationId = randomUUID();
    const { principalId, agentId } = await createTestPrincipalAndAgent(testEnv.db);
    const mandateId = await createTestMandate(testEnv.db, {
      kind: "INTENT",
      correlationId,
      principalId,
      agentId,
    });

    const now = new Date().toISOString();

    // Attempt negative total_minor
    await expect(
      testEnv.db.insert(budgets).values({
        mandateId,
        totalMinor: -500,
        spentMinor: 0,
        reservedMinor: 0,
        txCount: 0,
        maxTransactions: 5,
        perTxMaxMinor: 500,
        updatedAt: now,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      const e = err as { cause?: { message?: string; constraint?: string }; message?: string };
      return /budget_total_non_negative|budget_limit_check/i.test(
        e?.cause?.message || e?.cause?.constraint || e?.message || "",
      );
    });
  });
});
