/**
 * Postgres implementation of DashboardQueryPort.
 *
 * Implements authoritative queries for business overview, budget tracking,
 * ledger event timelines, and blocked attempts history.
 *
 * ARCHITECTURE.md §3, §8, §12
 * INVARIANTS: I-02, I-03, I-04, I-10, I-11.
 */

import { eq, desc, inArray, and } from "drizzle-orm";
import type { Database } from "../client.js";
import { mandates } from "../schema/mandates.js";
import { paymentMandates } from "../schema/payment-mandates.js";
import { ledgerEvents } from "../schema/ledger-events.js";
import { policies } from "../schema/policies.js";
import { principals } from "../schema/principals.js";
import type {
  DashboardQueryPort,
  DashboardOverviewView,
  DashboardTimelineEvent,
  BlockedAttemptRecord,
} from "../../../application/ports/dashboard-query-port.js";

/**
 * Illustrative policy for the fictional Northstar Studio demo. Served ONLY when the
 * caller explicitly asks for the demo workspace; never merged with a real principal.
 */
export const NORTHSTAR_DEMO_POLICY = {
  workspaceId: "demo-northstar",
  displayName: "Northstar Studio (Demo Workspace)",
  monthlyBudgetMinor: 50000, // $500.00
  perTxCapMinor: 10000, // $100.00
  currency: "USD",
} as const;

export class PostgresDashboardQuery implements DashboardQueryPort {
  constructor(private readonly db?: Database | undefined) {}

  // A missing database is an error, never an empty workspace (I-11): the UI must not
  // render a query failure as a zero balance.
  private requireDb(): Database {
    if (!this.db) {
      throw new Error("DATABASE_URL is not configured; dashboard data is unavailable");
    }
    return this.db;
  }

  async getOverview(
    principalId: string,
    isDemoRequested: boolean = false,
  ): Promise<DashboardOverviewView> {
    if (isDemoRequested) {
      return this.getNorthstarDemoOverview();
    }
    const db = this.requireDb();

    const principalRows = await db
      .select()
      .from(principals)
      .where(eq(principals.id, principalId))
      .limit(1);
    const displayName = principalRows[0]?.displayName ?? `Workspace ${principalId.slice(0, 8)}`;

    const perTxCapMinor = await this.activePerTxCap(db);
    const currency = "USD";

    const userMandates = await db
      .select({ id: mandates.id })
      .from(mandates)
      .where(eq(mandates.principalId, principalId));
    const mandateIds = userMandates.map((m) => m.id);

    const pmRows =
      mandateIds.length === 0
        ? []
        : await db
            .select()
            .from(paymentMandates)
            .where(inArray(paymentMandates.mandateId, mandateIds));

    let spentMinor = 0;
    let pendingMinor = 0;
    let unknownMinor = 0;
    let capturedCount = 0;
    let pendingCount = 0;
    let unknownCount = 0;

    for (const pm of pmRows) {
      const amount = (pm.terms as { amountMinor?: unknown } | null)?.amountMinor;
      // A row without an integer amount cannot be summed honestly; count it as UNKNOWN.
      if (typeof amount !== "number" || !Number.isInteger(amount)) {
        unknownCount++;
        continue;
      }
      switch (pm.status) {
        case "CAPTURED":
          spentMinor += amount;
          capturedCount++;
          break;
        case "AUTHORIZED":
        case "ORDER_CREATED":
        case "CAPTURE_REQUESTED":
          pendingMinor += amount;
          pendingCount++;
          break;
        case "UNKNOWN":
          unknownMinor += amount;
          unknownCount++;
          break;
        default:
          // FAILED and any unrecognised status do not move money.
          break;
      }
    }

    const blocked = await this.getBlockedAttempts(principalId, false);
    const blockedRequestValueMinor = blocked.reduce((acc, b) => acc + b.attemptedAmountMinor, 0);
    const amountAboveLimitMinor = blocked.reduce((acc, b) => acc + b.amountAboveLimitMinor, 0);
    const realizedSavingsMinor = blocked.reduce((acc, b) => acc + b.realizedSavingsMinor, 0);

    return {
      workspace: { id: principalId, displayName, isDemo: false },
      budget: {
        currency,
        // No per-workspace monthly budget is persisted yet (budgets are per intent
        // mandate). Reporting null is honest; inventing a number is not.
        monthlyBudgetMinor: null,
        spentMinor,
        pendingMinor,
        unknownMinor,
        remainingMinor: null,
        perTxCapMinor,
      },
      metrics: {
        currency,
        blockedRequestValueMinor,
        amountAboveLimitMinor,
        realizedSavingsMinor,
        savingsRationale:
          realizedSavingsMinor > 0
            ? "Realized savings counts only replays of an already-consumed approval that the Gate blocked. Rejected proposals are reported as blocked value, not savings."
            : "No blocked attempt put already-approved funds at risk, so realized savings is zero. Blocked value is shown separately.",
      },
      activitySummary: {
        totalTransactions: capturedCount + pendingCount + unknownCount + blocked.length,
        capturedCount,
        pendingCount,
        unknownCount,
        blockedCount: blocked.length,
      },
    };
  }

  private async activePerTxCap(db: Database): Promise<number | null> {
    const rows = await db
      .select({ content: policies.content })
      .from(policies)
      .where(eq(policies.active, true))
      .orderBy(desc(policies.version))
      .limit(1);
    const cap = (rows[0]?.content as { rules?: { maxPerTxMinor?: unknown } } | undefined)?.rules
      ?.maxPerTxMinor;
    return typeof cap === "number" && Number.isInteger(cap) ? cap : null;
  }

  async getTimeline(
    principalId: string,
    isDemoRequested: boolean = false,
  ): Promise<readonly DashboardTimelineEvent[]> {
    if (isDemoRequested || principalId === NORTHSTAR_DEMO_POLICY.workspaceId) {
      return this.getNorthstarDemoTimeline();
    }
    const db = this.requireDb();

    // 1. Fetch user mandates
    const userMandates = await db
      .select()
      .from(mandates)
      .where(eq(mandates.principalId, principalId));

    if (userMandates.length === 0) {
      return [];
    }

    const correlationIds = Array.from(new Set(userMandates.map((m) => m.correlationId)));

    // 2. Fetch ledger events for these correlations
    const events = await db
      .select()
      .from(ledgerEvents)
      .where(inArray(ledgerEvents.correlationId, correlationIds))
      .orderBy(desc(ledgerEvents.createdAt), desc(ledgerEvents.seq));

    return events.map((ev) => {
      const type = ev.type;
      let lifecycleState: "pending" | "captured" | "failed" | "unknown" = "pending";

      if (type === "CAPTURE_COMPLETED" || type === "PAYMENT_CAPTURED" || type === "RECONCILED_OK") {
        lifecycleState = "captured";
      } else if (
        type === "POLICY_DENIED" ||
        type === "EXECUTION_DENIED" ||
        type === "PROVIDER_ERROR" ||
        type === "RECONCILED_MISMATCH"
      ) {
        lifecycleState = "failed";
      } else if (type === "PROVIDER_OUTCOME_UNKNOWN") {
        lifecycleState = "unknown";
      }

      return {
        id: ev.id,
        correlationId: ev.correlationId,
        seq: Number(ev.seq),
        type: ev.type,
        actor: {
          type: ev.actorType,
          id: ev.actorId,
        },
        payload:
          typeof ev.payload === "object" && ev.payload !== null
            ? (ev.payload as Record<string, unknown>)
            : {},
        prevHash: ev.prevHash,
        hash: ev.hash,
        createdAt: ev.createdAt,
        lifecycleState,
        evidenceRef: {
          type: ev.type,
          id: ev.id,
          hash: ev.hash,
        },
      };
    });
  }

  async getBlockedAttempts(
    principalId: string,
    isDemoRequested: boolean = false,
  ): Promise<readonly BlockedAttemptRecord[]> {
    if (isDemoRequested || principalId === NORTHSTAR_DEMO_POLICY.workspaceId) {
      return this.getNorthstarDemoBlockedAttempts();
    }
    const db = this.requireDb();

    // 1. Fetch user mandates
    const userMandates = await db
      .select()
      .from(mandates)
      .where(eq(mandates.principalId, principalId));

    if (userMandates.length === 0) {
      return [];
    }

    const correlationIds = Array.from(new Set(userMandates.map((m) => m.correlationId)));

    // 2. Query ledger events of blocked / denial types
    const denialEvents = await db
      .select()
      .from(ledgerEvents)
      .where(
        and(
          inArray(ledgerEvents.correlationId, correlationIds),
          inArray(ledgerEvents.type, ["POLICY_DENIED", "EXECUTION_DENIED"]),
        ),
      )
      .orderBy(desc(ledgerEvents.createdAt));

    return denialEvents.map((ev) => {
      const payload =
        typeof ev.payload === "object" && ev.payload !== null
          ? (ev.payload as Record<string, unknown>)
          : {};
      const terms = (payload.terms as Record<string, unknown> | undefined) ?? {};
      const payment = (terms.payment as Record<string, unknown> | undefined) ?? {};
      const payee = (terms.payee as Record<string, unknown> | undefined) ?? {};

      const attemptedAmountMinor =
        Number(payment.amountMinor) || Number(payload.attemptedAmountMinor) || 0;
      const currency = String(payment.currency ?? payload.currency ?? "USD");
      const policyLimitMinor = 10000; // $100.00
      const amountAboveLimitMinor = Math.max(0, attemptedAmountMinor - policyLimitMinor);

      const reasons = Array.isArray(payload.reasons) ? payload.reasons : undefined;
      const denialCode = String(payload.reasonCode ?? (reasons && reasons[0]) ?? ev.type);
      const isReplay = denialCode === "REPLAY_DETECTED" || denialCode === "REUSE_CONSUMED_APPROVAL";

      // Realized savings is ONLY non-zero when active authorized tokens/in-flight money was saved
      const realizedSavingsMinor = isReplay ? attemptedAmountMinor : 0;

      return {
        id: ev.id,
        correlationId: ev.correlationId,
        createdAt: ev.createdAt,
        merchantId: String(payee.merchantId ?? "unknown-merchant"),
        merchantDisplayName: String(payee.displayName ?? "Merchant"),
        attemptedAmountMinor,
        currency,
        policyLimitMinor,
        amountAboveLimitMinor,
        denialCode,
        denialReason: String(
          payload.message ?? payload.detail ?? `Gate blocked execution: ${denialCode}`,
        ),
        stage: ev.type === "POLICY_DENIED" ? ("POLICY" as const) : ("GATE" as const),
        realizedSavingsMinor,
        savingsRationale: isReplay
          ? "Prevented duplicate capture of previously settled authorization token."
          : undefined,
      };
    });
  }

  // ─── Northstar Studio Demo Fixtures (docs/DESIGN.md & Phase 7B Prompt) ──────

  private getNorthstarDemoOverview(): DashboardOverviewView {
    return {
      workspace: {
        id: NORTHSTAR_DEMO_POLICY.workspaceId,
        displayName: NORTHSTAR_DEMO_POLICY.displayName,
        isDemo: true,
      },
      budget: {
        currency: NORTHSTAR_DEMO_POLICY.currency,
        monthlyBudgetMinor: NORTHSTAR_DEMO_POLICY.monthlyBudgetMinor, // $500.00
        spentMinor: 8500, // $85.00 keyboard purchase
        pendingMinor: 0,
        remainingMinor: 41500, // $415.00 remaining
        perTxCapMinor: NORTHSTAR_DEMO_POLICY.perTxCapMinor, // $100.00 cap
      },
      metrics: {
        currency: NORTHSTAR_DEMO_POLICY.currency,
        blockedRequestValueMinor: 93500, // $935.00 attempted blocked
        amountAboveLimitMinor: 75000, // $750.00 above $100 cap for $850 item
        realizedSavingsMinor: 8500, // $85.00 defensible savings from replay block
        savingsRationale:
          "Realized savings ($85.00) reflects a blocked duplicate settlement attempt on a consumed approval token. The unapproved $850.00 request was blocked at policy evaluation before authorization, so it is accurately reported as blocked value rather than realized savings.",
      },
      activitySummary: {
        totalTransactions: 3,
        capturedCount: 1,
        pendingCount: 0,
        blockedCount: 2,
      },
    };
  }

  private getNorthstarDemoTimeline(): readonly DashboardTimelineEvent[] {
    const correlationId = "d5f309b6-8575-4d6b-bd85-056345ec48f5";
    return [
      {
        id: "evt-005",
        correlationId,
        seq: 5,
        type: "CAPTURE_COMPLETED",
        actor: { type: "provider", id: "paypal" },
        payload: {
          paypalOrderId: "7PY54930JJ383230F",
          paypalCaptureId: "9CP28419AK283411A",
          amountMinor: 8500,
          currency: "USD",
          status: "COMPLETED",
        },
        prevHash: "921a84f31627bca5e3962bca9810f631a012b3c4d5e6f7a8b9c0d1e2f3a4b5c6",
        hash: "a4f912c3e4b5a6c7d8e9f01234567890abcdef1234567890abcdef1234567890",
        createdAt: "2026-10-20T19:15:30.000Z",
        lifecycleState: "captured",
        evidenceRef: {
          type: "PAYPAL_CAPTURE",
          id: "9CP28419AK283411A",
          hash: "a4f912c3e4b5a6c7d8e9f01234567890abcdef1234567890abcdef1234567890",
        },
      },
      {
        id: "evt-004",
        correlationId,
        seq: 4,
        type: "PAYPAL_ORDER_CREATED",
        actor: { type: "provider", id: "paypal" },
        payload: {
          paypalOrderId: "7PY54930JJ383230F",
          amountMinor: 8500,
          currency: "USD",
          status: "CREATED",
        },
        prevHash: "812b73e20516ab94d2851ab9870fe5209f01a2b3c4d5e6f7a8b9c0d1e2f3a4b5",
        hash: "921a84f31627bca5e3962bca9810f631a012b3c4d5e6f7a8b9c0d1e2f3a4b5c6",
        createdAt: "2026-10-20T19:15:10.000Z",
        lifecycleState: "pending",
        evidenceRef: {
          type: "PAYPAL_ORDER",
          id: "7PY54930JJ383230F",
        },
      },
      {
        id: "evt-003",
        correlationId,
        seq: 3,
        type: "EXECUTION_AUTHORIZED",
        actor: { type: "system", id: "gate" },
        payload: {
          decision: "ALLOW",
          mandateHash: "46f88ec85be9b1582239e4e2079069d272d93eef1ec4eeec80beab9d80cb2b11",
          amountMinor: 8500,
          currency: "USD",
        },
        prevHash: "701a62d194059a83c17409a8760ed41f8e9091a2b3c4d5e6f7a8b9c0d1e2f3a4",
        hash: "812b73e20516ab94d2851ab9870fe5209f01a2b3c4d5e6f7a8b9c0d1e2f3a4b5",
        createdAt: "2026-10-20T19:14:55.000Z",
        lifecycleState: "pending",
      },
      {
        id: "evt-002",
        correlationId,
        seq: 2,
        type: "CONSENT_RECORDED",
        actor: { type: "principal", id: "demo-northstar-user" },
        payload: {
          credentialId: "cred-northstar-passkey",
          mandateHash: "46f88ec85be9b1582239e4e2079069d272d93eef1ec4eeec80beab9d80cb2b11",
          userPresence: true,
          userVerification: true,
        },
        prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
        hash: "701a62d194059a83c17409a8760ed41f8e9091a2b3c4d5e6f7a8b9c0d1e2f3a4",
        createdAt: "2026-10-20T19:14:40.000Z",
        lifecycleState: "pending",
        evidenceRef: {
          type: "CONSENT",
          hash: "46f88ec85be9b1582239e4e2079069d272d93eef1ec4eeec80beab9d80cb2b11",
        },
      },
      {
        id: "evt-001",
        correlationId,
        seq: 1,
        type: "MANDATE_ISSUED",
        actor: { type: "system", id: "authority" },
        payload: {
          mandateId: "m-northstar-001",
          merchant: "Keychron Official",
          item: "75% Mechanical Keyboard",
          amountMinor: 8500,
          currency: "USD",
        },
        prevHash: "0000000000000000000000000000000000000000000000000000000000000000",
        hash: "6f0b51c083f48972b063f897650dc30e7d8f8091a2b3c4d5e6f7a8b9c0d1e2f3",
        createdAt: "2026-10-20T19:14:20.000Z",
        lifecycleState: "pending",
        evidenceRef: {
          type: "MANDATE",
          id: "m-northstar-001",
        },
      },
    ];
  }

  private getNorthstarDemoBlockedAttempts(): readonly BlockedAttemptRecord[] {
    return [
      {
        id: "blk-001",
        correlationId: "e8a109b6-8575-4d6b-bd85-056345ec9999",
        createdAt: "2026-10-20T19:18:00.000Z",
        merchantId: "gpu-direct",
        merchantDisplayName: "Silicon Express",
        attemptedAmountMinor: 85000, // $850.00
        currency: "USD",
        policyLimitMinor: 10000, // $100.00
        amountAboveLimitMinor: 75000, // $750.00 above cap
        denialCode: "TX_CAP_EXCEEDED",
        denialReason:
          "Transaction amount ($850.00) exceeds configured per-purchase cap of $100.00 (Check 4).",
        stage: "POLICY",
        realizedSavingsMinor: 0,
        savingsRationale:
          "Unapproved proposal exceeding policy cap was rejected before authorization. Reported as blocked attempt value, not realized savings.",
      },
      {
        id: "blk-002",
        correlationId: "f9b209b6-8575-4d6b-bd85-056345ec8888",
        createdAt: "2026-10-20T19:22:15.000Z",
        merchantId: "merchant-acme-corp",
        merchantDisplayName: "Keychron Official",
        attemptedAmountMinor: 8500, // $85.00
        currency: "USD",
        policyLimitMinor: 10000,
        amountAboveLimitMinor: 0,
        denialCode: "REPLAY_DETECTED",
        denialReason:
          "Gate check failed: mandate status is already EXECUTED. Replay of consumed approval rejected (Check 8).",
        stage: "GATE",
        realizedSavingsMinor: 8500,
        savingsRationale:
          "Active replay attempt on previously captured payment token prevented. Financial loss avoided: $85.00.",
      },
    ];
  }
}
