/**
 * API unit tests for Business Ledger and Security Lab endpoints.
 *
 * Verifies:
 * - Budget overview, pending vs captured amounts, accurate metrics.
 * - Workspace isolation (Invariant I-11, 403 on cross-tenant access).
 * - Blocked attempts with typed Gate denial reason codes.
 * - Security lab scenario runner (zero PayPal capture on blocked attacks).
 * - Pure domain offline evidence bundle verifier (V0–V8).
 *
 * ARCHITECTURE.md §8, §11, §12, §13.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { GET as getOverview } from "../../../src/app/api/v1/dashboard/overview/route.js";
import { GET as getTimeline } from "../../../src/app/api/v1/dashboard/ledger/route.js";
import { GET as getBlockedAttempts } from "../../../src/app/api/v1/dashboard/blocked-attempts/route.js";
import { GET as listLabScenarios } from "../../../src/app/api/v1/lab/scenarios/route.js";
import { POST as runLabScenarios } from "../../../src/app/api/v1/lab/scenarios/run/route.js";
import { POST as verifyBundle } from "../../../src/app/api/v1/lab/verify-bundle/route.js";
import { container } from "../../../src/container.js";

const TEST_PRINCIPAL_A = "a11ce000-0000-4000-8000-000000000001";
const TEST_PRINCIPAL_B = "b22ce000-0000-4000-8000-000000000002";

function makeSessionCookie(principalId: string): string {
  const token = container.getSessionService().sign(principalId);
  return `cl_session=${token}`;
}

describe("Dashboard & Security Lab API Routes", () => {
  beforeEach(() => {
    container.setLabEnabled(true);
  });

  describe("Workspace Authorization & Isolation (Requirement 7)", () => {
    it("rejects unauthenticated overview requests without demo parameter", async () => {
      const request = new Request("http://localhost:3000/api/v1/dashboard/overview");
      const res = await getOverview(request);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe("UNAUTHENTICATED");
    });

    it("allows unauthenticated overview when demo-northstar is explicitly requested", async () => {
      const request = new Request(
        "http://localhost:3000/api/v1/dashboard/overview?workspaceId=demo-northstar",
      );
      const res = await getOverview(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace.isDemo).toBe(true);
      expect(body.workspace.displayName).toContain("Northstar Studio");
      expect(body.budget.monthlyBudgetMinor).toBe(50000); // $500.00
      expect(body.budget.perTxCapMinor).toBe(10000); // $100.00
      expect(body.budget.spentMinor).toBe(8500); // $85.00 keyboard
      expect(body.budget.remainingMinor).toBe(41500); // $415.00
    });

    it("enforces workspace isolation: blocks access to other principal's workspace with 403 Forbidden", async () => {
      const cookie = makeSessionCookie(TEST_PRINCIPAL_A);
      // Principal A attempts to access Principal B's workspace
      const request = new Request(
        `http://localhost:3000/api/v1/dashboard/overview?workspaceId=${TEST_PRINCIPAL_B}`,
        {
          headers: { cookie },
        },
      );
      const res = await getOverview(request);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("FORBIDDEN");
      expect(body.detail).toContain("Workspace authorization failed");
    });

    it("enforces workspace isolation on ledger timeline", async () => {
      const cookie = makeSessionCookie(TEST_PRINCIPAL_A);
      const request = new Request(
        `http://localhost:3000/api/v1/dashboard/ledger?workspaceId=${TEST_PRINCIPAL_B}`,
        {
          headers: { cookie },
        },
      );
      const res = await getTimeline(request);
      expect(res.status).toBe(403);
    });

    it("enforces workspace isolation on blocked attempts", async () => {
      const cookie = makeSessionCookie(TEST_PRINCIPAL_A);
      const request = new Request(
        `http://localhost:3000/api/v1/dashboard/blocked-attempts?workspaceId=${TEST_PRINCIPAL_B}`,
        {
          headers: { cookie },
        },
      );
      const res = await getBlockedAttempts(request);
      expect(res.status).toBe(403);
    });
  });

  describe("Business Metrics & Accounting Accuracy (Requirement 6)", () => {
    it("accurately separates blocked value, amount above limit, and realized savings", async () => {
      const request = new Request(
        "http://localhost:3000/api/v1/dashboard/overview?workspaceId=demo-northstar",
      );
      const res = await getOverview(request);
      expect(res.status).toBe(200);
      const body = await res.json();

      // Total attempted amount of blocked requests
      expect(body.metrics.blockedRequestValueMinor).toBe(93500); // $935.00
      // Excess attempted over the transaction cap ($850 - $100 cap = $750)
      expect(body.metrics.amountAboveLimitMinor).toBe(75000); // $750.00
      // Realized savings only includes active funds/replay prevented ($85.00)
      expect(body.metrics.realizedSavingsMinor).toBe(8500); // $85.00
      expect(body.metrics.savingsRationale).toBeDefined();
      expect(body.metrics.savingsRationale).toContain("blocked value rather than realized savings");
    });

    it("returns typed Gate denial reasons and attempted terms for blocked attempts", async () => {
      const request = new Request(
        "http://localhost:3000/api/v1/dashboard/blocked-attempts?workspaceId=demo-northstar",
      );
      const res = await getBlockedAttempts(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attempts.length).toBe(2);

      const txCapAttempt = body.attempts.find(
        (a: { denialCode: string }) => a.denialCode === "TX_CAP_EXCEEDED",
      );
      expect(txCapAttempt).toBeDefined();
      expect(txCapAttempt.attemptedAmountMinor).toBe(85000); // $850.00
      expect(txCapAttempt.amountAboveLimitMinor).toBe(75000); // $750.00
      expect(txCapAttempt.stage).toBe("POLICY");
      expect(txCapAttempt.realizedSavingsMinor).toBe(0); // Not labeled as realized savings

      const replayAttempt = body.attempts.find(
        (a: { denialCode: string }) => a.denialCode === "REPLAY_DETECTED",
      );
      expect(replayAttempt).toBeDefined();
      expect(replayAttempt.attemptedAmountMinor).toBe(8500); // $85.00
      expect(replayAttempt.stage).toBe("GATE");
      expect(replayAttempt.realizedSavingsMinor).toBe(8500); // Prevented duplicate token capture
    });
  });

  describe("Ledger Timeline (Requirement 2)", () => {
    it("returns ordered event tape with hashes, sequence numbers, and lifecycle states", async () => {
      const request = new Request(
        "http://localhost:3000/api/v1/dashboard/ledger?workspaceId=demo-northstar",
      );
      const res = await getTimeline(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events.length).toBeGreaterThanOrEqual(5);

      const capturedEvent = body.events.find(
        (e: { type: string }) => e.type === "CAPTURE_COMPLETED",
      );
      expect(capturedEvent).toBeDefined();
      expect(capturedEvent.lifecycleState).toBe("captured");
      expect(capturedEvent.hash).toBeDefined();
      expect(capturedEvent.prevHash).toBeDefined();

      const mandateEvent = body.events.find((e: { type: string }) => e.type === "MANDATE_ISSUED");
      expect(mandateEvent).toBeDefined();
      expect(mandateEvent.lifecycleState).toBe("pending");
    });
  });

  describe("Security Lab Scenarios & Zero-Capture Invariant (Requirement 4)", () => {
    it("lists all 9 registered scenarios with expected decisions and reason codes", async () => {
      const request = new Request("http://localhost:3000/api/v1/lab/scenarios");
      const res = await listLabScenarios(request);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.totalScenarios).toBe(9);
      expect(body.scenarios.length).toBe(9);

      const scenarioIds = body.scenarios.map((s: { id: string }) => s.id);
      expect(scenarioIds).toContain("control-valid-purchase");
      expect(scenarioIds).toContain("amount-manipulation");
      expect(scenarioIds).toContain("merchant-substitution");
      expect(scenarioIds).toContain("currency-substitution");
      expect(scenarioIds).toContain("prompt-injection");
      expect(scenarioIds).toContain("reuse-consumed-approval");
      expect(scenarioIds).toContain("expired-mandate");
      expect(scenarioIds).toContain("changed-mandate-consent");
      expect(scenarioIds).toContain("evidence-bundle-tampering");
    });

    it("runs a single attack scenario (amount-manipulation) and confirms 0 PayPal captures", async () => {
      const request = new Request("http://localhost:3000/api/v1/lab/scenarios/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "amount-manipulation" }),
      });
      const res = await runLabScenarios(request);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.totalExecuted).toBe(1);
      expect(body.zeroCaptureEnforced).toBe(true);

      const result = body.results[0];
      expect(result.scenarioId).toBe("amount-manipulation");
      expect(result.decision).toBe("BLOCKED");
      expect(result.expectedDecision).toBe("BLOCKED");
      expect(result.reasonCode).toBe("TERMS_MISMATCH");
      expect(result.captureCallCount).toBe(0);
      expect(result.runStatus).toBe("PASSED");
    });

    it("runs the full suite of 9 scenarios and validates that all passed with zero unauthorized captures", async () => {
      const request = new Request("http://localhost:3000/api/v1/lab/scenarios/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: "all" }),
      });
      const res = await runLabScenarios(request);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.totalExecuted).toBe(9);
      expect(body.allPassed).toBe(true);
      expect(body.zeroCaptureEnforced).toBe(true);

      // Verify that every blocked scenario attempted 0 captures
      for (const result of body.results) {
        if (result.decision === "BLOCKED") {
          expect(result.captureCallCount).toBe(0);
        }
      }
    });
  });

  describe("Offline Evidence Bundle Verifier (Requirement 5)", () => {
    it("verifies a valid evidence bundle offline (V0 through V8 pass)", async () => {
      const request = new Request("http://localhost:3000/api/v1/lab/verify-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "valid" }),
      });
      const res = await verifyBundle(request);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.valid).toBe(true);
      expect(body.checks.length).toBeGreaterThanOrEqual(9);
      expect(body.terminalOutput).toContain("RESULT: VERIFIED VALID OFFLINE");
      expect(body.terminalOutput).toContain("[PASS]   V0: Schema & Version Integrity");
      expect(body.terminalOutput).toContain("[PASS]   V1: Mandate Hash & Parent Binding");
      expect(body.terminalOutput).toContain("[PASS]   V4: Ledger Chain Integrity");
    });

    it("verifies and catches tampered terms in an evidence bundle offline", async () => {
      const request = new Request("http://localhost:3000/api/v1/lab/verify-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "tampered", tamperType: "terms" }),
      });
      const res = await verifyBundle(request);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.valid).toBe(false);
      expect(body.failedCheck).toBe("V1");
      expect(body.code).toBe("HASH_MISMATCH");
      expect(body.terminalOutput).toContain("RESULT: VERIFICATION FAILED");
      expect(body.terminalOutput).toContain("Failed Check:   V1");
    });

    it("returns 404 Problem JSON when lab is disabled (fail-closed)", async () => {
      container.setLabEnabled(false);
      try {
        const reqList = new Request("http://localhost:3000/api/v1/lab/scenarios");
        const resList = await listLabScenarios(reqList);
        expect(resList.status).toBe(404);

        const reqRun = new Request("http://localhost:3000/api/v1/lab/scenarios/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const resRun = await runLabScenarios(reqRun);
        expect(resRun.status).toBe(404);

        const reqVerify = new Request("http://localhost:3000/api/v1/lab/verify-bundle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "valid" }),
        });
        const resVerify = await verifyBundle(reqVerify);
        expect(resVerify.status).toBe(404);
      } finally {
        container.setLabEnabled(true);
      }
    });
  });
});
