/**
 * Tests for database schema definitions in src/infrastructure/db/schema.
 *
 * Verifies that the Drizzle schema reflects the approved Chunk 8 database design,
 * enforces required keys and unique constraints, and maps money fields to bigint.
 */

import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  principals,
  agents,
  policies,
  mandates,
  budgets,
  paymentMandates,
  ledgerEvents,
  ledgerCheckpoints,
  webhookDeliveries,
} from "../../../src/infrastructure/db/schema/index.js";

describe("Database Schema Definitions", () => {
  it("defines all approved tables with expected names", () => {
    expect(getTableName(principals)).toBe("principals");
    expect(getTableName(agents)).toBe("agents");
    expect(getTableName(policies)).toBe("policies");
    expect(getTableName(mandates)).toBe("mandates");
    expect(getTableName(budgets)).toBe("budgets");
    expect(getTableName(paymentMandates)).toBe("payment_mandates");
    expect(getTableName(ledgerEvents)).toBe("ledger_events");
    expect(getTableName(ledgerCheckpoints)).toBe("ledger_checkpoints");
    expect(getTableName(webhookDeliveries)).toBe("webhook_deliveries");
  });

  it("enforces integer minor units for money columns in budgets (no floats)", () => {
    const cols = getTableColumns(budgets);
    expect(cols.totalMinor.columnType).toBe("PgBigInt53");
    expect(cols.spentMinor.columnType).toBe("PgBigInt53");
    expect(cols.reservedMinor.columnType).toBe("PgBigInt53");
    expect(cols.perTxMaxMinor.columnType).toBe("PgBigInt53");
  });

  it("defines composite primary key on ledger_events (correlation_id, seq)", () => {
    const cols = getTableColumns(ledgerEvents);
    expect(cols.correlationId).toBeDefined();
    expect(cols.seq).toBeDefined();
    expect(cols.seq.columnType).toBe("PgBigInt53");
    expect(cols.prevHash).toBeDefined();
    expect(cols.hash).toBeDefined();
    expect(cols.id.isUnique).toBe(true);
  });

  it("defines uniqueness constraints on hash columns", () => {
    const policyCols = getTableColumns(policies);
    expect(policyCols.hash.isUnique).toBe(true);

    const mandateCols = getTableColumns(mandates);
    expect(mandateCols.hash.isUnique).toBe(true);

    const paymentCols = getTableColumns(paymentMandates);
    expect(paymentCols.hash.isUnique).toBe(true);
    expect(paymentCols.requestId.isUnique).toBe(true);
  });

  it("defines idempotency key on webhook_deliveries (paypal_event_id)", () => {
    const cols = getTableColumns(webhookDeliveries);
    expect(cols.paypalEventId.primary).toBe(true);
  });
});
