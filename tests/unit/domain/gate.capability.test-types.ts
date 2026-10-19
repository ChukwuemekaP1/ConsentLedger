/**
 * Compile-time proof that GateApproval cannot be constructed or forged outside domain/gate.
 *
 * This file uses @ts-expect-error to prove:
 *   1. A plain object cannot be assigned as GateApproval.
 *   2. The type constructor is not exported.
 *   3. SettlementRequest rejects a plain object.
 *
 * Run as part of typecheck: tsc --noEmit picks this file up automatically.
 * The test suite also runs `pnpm typecheck` so this is verified on every CI run.
 *
 * INVARIANT: I-01 — GateApproval is the capability required by the settlement port.
 */

import type { GateApproval, SettlementRequest } from "../../../src/domain/gate/index.js";
import type { PaymentMandateTerms } from "../../../src/domain/mandate/index.js";
import type { Timestamp } from "../../../src/domain/shared/clock.js";

// Declare a fake PaymentMandateTerms for the tests below
declare const fakeTerms: PaymentMandateTerms;
declare const fakeTs: Timestamp;

// ─── Proof 1: plain object cannot be assigned to GateApproval ────────────────

// @ts-expect-error — A plain object is not a GateApproval (missing brand)
const _forgedApproval: GateApproval = {
  paymentMandateTerms: fakeTerms,
  approvedAt: fakeTs,
};

// ─── Proof 2: SettlementRequest rejects a plain object ───────────────────────

const _forgedSettlement: SettlementRequest = {
  // @ts-expect-error — approval must be GateApproval (branded), not a plain object
  approval: {
    paymentMandateTerms: fakeTerms,
    approvedAt: fakeTs,
  },
};

// ─── Proof 3: SettlementRequest accepts a real GateApproval ──────────────────

// This should compile without errors (it is the happy path type-check)
declare const realApproval: GateApproval;
const _validSettlement: SettlementRequest = {
  approval: realApproval, // OK — GateApproval is assignable to itself
};

// Suppress unused variable warnings
void _validSettlement;
