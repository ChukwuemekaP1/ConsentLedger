/**
 * Component tests for Business Ledger and Security Lab surfaces.
 *
 * ARCHITECTURE.md §13, docs/DESIGN.md §2, §4.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentWorkbench } from "../../src/ui/agent/AgentWorkbench.js";
import { BudgetOverviewCard } from "../../src/ui/dashboard/BudgetOverviewCard.js";
import { BlockedAttemptsPanel } from "../../src/ui/dashboard/BlockedAttemptsPanel.js";
import { LedgerTimeline } from "../../src/ui/dashboard/LedgerTimeline.js";
import { SecurityLabPanel } from "../../src/ui/dashboard/SecurityLabPanel.js";
import { OfflineVerifierView } from "../../src/ui/dashboard/OfflineVerifierView.js";
import { BusinessLedgerSurface } from "../../src/ui/dashboard/BusinessLedgerSurface.js";
import type {
  DashboardApi,
  LabScenarioMeta,
  BundleVerificationView,
} from "../../src/ui/dashboard/dashboard-api.js";
import type { ScenarioResult } from "../../src/application/lab/types.js";
import type {
  DashboardOverviewView,
  DashboardTimelineEvent,
  BlockedAttemptRecord,
} from "../../src/application/ports/dashboard-query-port.js";
import { makeApi, makePasskeys, makePayPal, NOW } from "./fixtures.js";

const mockOverview: DashboardOverviewView = {
  workspace: {
    id: "ws-northstar-demo",
    displayName: "Northstar Studio (Demo)",
    isDemo: true,
  },
  budget: {
    currency: "USD",
    monthlyBudgetMinor: 50000, // $500.00
    spentMinor: 8500, // $85.00
    pendingMinor: 0,
    remainingMinor: 41500, // $415.00
    perTxCapMinor: 10000, // $100.00
  },
  metrics: {
    currency: "USD",
    blockedRequestValueMinor: 93500, // $935.00
    amountAboveLimitMinor: 75000, // $750.00
    realizedSavingsMinor: 8500, // $85.00
    savingsRationale: "Prevented duplicate capture of consumed approval token.",
  },
  activitySummary: {
    totalTransactions: 3,
    capturedCount: 1,
    pendingCount: 0,
    blockedCount: 2,
  },
};

const mockTimelineEvents: readonly DashboardTimelineEvent[] = [
  {
    id: "evt-001",
    correlationId: "c-111",
    seq: 1,
    type: "MANDATE_ISSUED",
    actor: { type: "system", id: "authority" },
    payload: { amountMinor: 8500, currency: "USD", merchant: "Keychron" },
    prevHash: "00000000",
    hash: "11111111",
    createdAt: "2026-10-20T12:00:00.000Z",
    lifecycleState: "pending",
  },
  {
    id: "evt-002",
    correlationId: "c-111",
    seq: 2,
    type: "CAPTURE_COMPLETED",
    actor: { type: "provider", id: "paypal" },
    payload: { paypalCaptureId: "CAP-123", amountMinor: 8500, status: "COMPLETED" },
    prevHash: "11111111",
    hash: "22222222",
    createdAt: "2026-10-20T12:02:00.000Z",
    lifecycleState: "captured",
  },
  {
    id: "evt-003",
    correlationId: "c-222",
    seq: 1,
    type: "POLICY_DENIED",
    actor: { type: "system", id: "gate" },
    payload: { reasonCode: "TX_CAP_EXCEEDED", attemptedAmountMinor: 85000 },
    prevHash: "00000000",
    hash: "33333333",
    createdAt: "2026-10-20T12:05:00.000Z",
    lifecycleState: "failed",
  },
];

const mockBlockedAttempts: readonly BlockedAttemptRecord[] = [
  {
    id: "blk-01",
    correlationId: "c-222",
    createdAt: "2026-10-20T12:05:00.000Z",
    merchantId: "m-silicon",
    merchantDisplayName: "Silicon Express",
    attemptedAmountMinor: 85000,
    currency: "USD",
    policyLimitMinor: 10000,
    amountAboveLimitMinor: 75000,
    denialCode: "TX_CAP_EXCEEDED",
    denialReason: "Transaction amount exceeds per-purchase cap of $100.00.",
    stage: "POLICY",
    realizedSavingsMinor: 0,
    savingsRationale: "Blocked proposal before authorization.",
  },
  {
    id: "blk-02",
    correlationId: "c-333",
    createdAt: "2026-10-20T12:10:00.000Z",
    merchantId: "m-keychron",
    merchantDisplayName: "Keychron Official",
    attemptedAmountMinor: 8500,
    currency: "USD",
    policyLimitMinor: 10000,
    amountAboveLimitMinor: 0,
    denialCode: "REPLAY_DETECTED",
    denialReason: "Mandate is already EXECUTED. Replay rejected.",
    stage: "GATE",
    realizedSavingsMinor: 8500,
    savingsRationale: "Prevented duplicate settlement of authorization token.",
  },
];

const mockScenarios: readonly LabScenarioMeta[] = [
  {
    id: "amount-manipulation",
    name: "Amount Manipulation Attack",
    category: "TAMPERING",
    description: "An attacker alters payment terms post-consent.",
    targetInvariant: "I-02: Terms immutability",
    expectedDecision: "BLOCKED",
    expectedReasonCode: "TERMS_MISMATCH",
  },
  {
    id: "reuse-consumed-approval",
    name: "Replay Attack",
    category: "REPLAY",
    description: "Attacker attempts to reuse settled authorization.",
    targetInvariant: "I-03: Single use tokens",
    expectedDecision: "BLOCKED",
    expectedReasonCode: "REPLAY_DETECTED",
  },
];

function makeMockDashboardApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getOverview: vi.fn().mockResolvedValue(mockOverview),
    getTimeline: vi.fn().mockResolvedValue({
      workspaceId: "ws-demo",
      isDemo: true,
      events: mockTimelineEvents,
    }),
    getBlockedAttempts: vi.fn().mockResolvedValue({
      workspaceId: "ws-demo",
      isDemo: true,
      attempts: mockBlockedAttempts,
    }),
    getLabScenarios: vi.fn().mockResolvedValue({
      totalScenarios: mockScenarios.length,
      scenarios: mockScenarios,
    }),
    runLabScenarios: vi.fn().mockImplementation((scenarioId?: string) => {
      const mockResult: ScenarioResult = {
        scenarioId: (scenarioId as ScenarioResult["scenarioId"]) ?? "amount-manipulation",
        name: "Amount Manipulation Attack",
        category: "TAMPERING",
        description: "Altered terms post-consent",
        invariant: "I-02",
        runStatus: "PASSED",
        decision: "BLOCKED",
        expectedDecision: "BLOCKED",
        reasonCode: "TERMS_MISMATCH",
        expectedReasonCode: "TERMS_MISMATCH",
        captureAttempted: false,
        captureCallCount: 0,
        executionTimeMs: 12,
        valueMetrics: {
          currency: "USD",
          attemptedAmountMinor: 85000,
          authorizedAmountMinor: 8500,
          amountAbovePolicyMinor: 75000,
          realizedSavingsMinor: 0,
        },
      };
      return Promise.resolve({
        totalExecuted: 1,
        allPassed: true,
        zeroCaptureEnforced: true,
        results: [mockResult],
      });
    }),
    verifyBundle: vi.fn().mockImplementation((mode: string) => {
      const isValid = mode === "valid";
      return Promise.resolve<BundleVerificationView>({
        mode,
        valid: isValid,
        failedCheck: isValid ? undefined : "V1",
        code: isValid ? undefined : "HASH_MISMATCH",
        message: isValid ? "Verified offline successfully" : "Hash mismatch detected",
        checks: [
          { id: "V0", name: "Schema & Version Integrity", status: "PASS", details: "Valid" },
          {
            id: "V1",
            name: "Mandate Hash & Parent Binding",
            status: isValid ? "PASS" : "FAIL",
            details: isValid ? "Matches mandate hash" : "Hash mismatch detected",
          },
          {
            id: "V4",
            name: "Ledger Chain Integrity",
            status: "PASS",
            details: "All hashes verified",
          },
        ],
        terminalOutput: isValid
          ? "RESULT: VERIFIED VALID OFFLINE\n[PASS] V0: Schema\n[PASS] V1: Hash Binding"
          : "RESULT: VERIFICATION FAILED\n[FAIL] V1: Mandate Hash & Parent Binding",
      });
    }),
    ...overrides,
  };
}

describe("Phase 7B Dashboard UI Components", () => {
  describe("Surface Navigation in AgentWorkbench", () => {
    it("renders top tabs and switches to Business Ledger and Security Lab", async () => {
      const agentApi = makeApi();
      const passkeys = makePasskeys();
      const paypal = makePayPal();
      const dashboardApi = makeMockDashboardApi();

      render(
        <AgentWorkbench
          api={agentApi}
          passkeys={passkeys}
          paypal={paypal.port}
          dashboardApi={dashboardApi}
          now={() => NOW}
        />,
      );

      // Verify header title and surface tabs exist
      expect(screen.getByRole("tab", { name: "Agent Workbench" })).toBeDefined();
      expect(screen.getByRole("tab", { name: "Business Ledger" })).toBeDefined();
      expect(screen.getByRole("tab", { name: "Security Lab" })).toBeDefined();

      // Switch to Business Ledger
      fireEvent.click(screen.getByRole("tab", { name: "Business Ledger" }));

      // Title updates to Business Ledger
      expect(screen.getByText(/ConsentLedger · Business Ledger/)).toBeDefined();
      expect(dashboardApi.getOverview).toHaveBeenCalled();

      // Switch to Security Lab
      fireEvent.click(screen.getByRole("tab", { name: "Security Lab" }));
      expect(screen.getByText(/ConsentLedger · Security Lab/)).toBeDefined();
      expect(dashboardApi.getLabScenarios).toHaveBeenCalled();
    });
  });

  describe("BudgetOverviewCard Component", () => {
    it("renders monthly budget, spent, remaining, and transaction cap", () => {
      render(<BudgetOverviewCard overview={mockOverview} loading={false} error={null} />);

      expect(screen.getByText("$500.00 USD")).toBeDefined(); // Monthly Budget
      expect(screen.getByText("$415.00 USD")).toBeDefined(); // Remaining
      expect(screen.getByText(/Spent: \$85\.00/)).toBeDefined();
      expect(screen.getByText(/Cap: \$100\.00/)).toBeDefined();
    });

    it("displays accurately separated metrics: blocked request value vs amount over limit vs realized savings", () => {
      render(<BudgetOverviewCard overview={mockOverview} loading={false} error={null} />);

      // Blocked request value
      expect(screen.getByText("$935.00 USD")).toBeDefined();
      expect(screen.getByText("$750.00 USD")).toBeDefined(); // Excess attempted over cap

      // Defensible Realized Savings
      expect(screen.getByText("Defensible Realized Savings")).toBeDefined();
      expect(screen.getByText("$85.00 USD")).toBeDefined(); // Realized savings
      expect(screen.getByText(/Prevented duplicate capture/)).toBeDefined();
    });

    it("displays loading and error states explicitly", () => {
      const { rerender } = render(
        <BudgetOverviewCard overview={null} loading={true} error={null} />,
      );
      expect(screen.getByText(/Loading budget metrics/)).toBeDefined();

      rerender(
        <BudgetOverviewCard
          overview={null}
          loading={false}
          error="Network timeout on database replica"
        />,
      );
      expect(screen.getByText(/Budget metrics unavailable/)).toBeDefined();
      expect(screen.getByText(/Network timeout on database replica/)).toBeDefined();
    });
  });

  describe("BlockedAttemptsPanel Component", () => {
    it("renders blocked requests with merchant, attempted amount, typed denial code, and stage", () => {
      render(<BlockedAttemptsPanel attempts={mockBlockedAttempts} loading={false} error={null} />);

      expect(screen.getByText("Silicon Express")).toBeDefined();
      expect(screen.getByText("$850.00 USD")).toBeDefined();
      expect(screen.getByText("TX_CAP_EXCEEDED")).toBeDefined();
      expect(screen.getByText("POLICY")).toBeDefined();

      expect(screen.getByText("Keychron Official")).toBeDefined();
      expect(screen.getByText("REPLAY_DETECTED")).toBeDefined();
      expect(screen.getByText("GATE")).toBeDefined();
    });
  });

  describe("LedgerTimeline Component", () => {
    it("renders events tape with sequence, actor chips, status badges, and expandable JSON", () => {
      render(<LedgerTimeline events={mockTimelineEvents} loading={false} error={null} />);

      expect(screen.getAllByText("#1").length).toBeGreaterThan(0);
      expect(screen.getByText("#2")).toBeDefined();
      expect(screen.getByText("CAPTURE_COMPLETED")).toBeDefined();
      expect(screen.getByText("POLICY_DENIED")).toBeDefined();

      // Inspect payload button toggles JSON
      const inspectButtons = screen.getAllByRole("button", { name: "Inspect" });
      const firstInspect = inspectButtons[0];
      if (firstInspect) {
        fireEvent.click(firstInspect);
      }
      expect(screen.getByText(/Hide Payload/)).toBeDefined();
    });
  });

  describe("SecurityLabPanel Component", () => {
    it("renders scenarios and executes run with zero PayPal captures", async () => {
      const api = makeMockDashboardApi();
      render(<SecurityLabPanel scenarios={mockScenarios} api={api} />);

      expect(screen.getByText("Amount Manipulation Attack")).toBeDefined();
      expect(screen.getByText("Replay Attack")).toBeDefined();

      const runButtons = screen.getAllByRole("button", { name: "Run" });
      const firstRun = runButtons[0];
      if (firstRun) {
        fireEvent.click(firstRun);
      }

      await waitFor(() => {
        expect(api.runLabScenarios).toHaveBeenCalledWith("amount-manipulation");
        expect(screen.getByText(/0 attempted/)).toBeDefined(); // Zero captures
        expect(screen.getByText(/TERMS_MISMATCH/)).toBeDefined();
      });
    });
  });

  describe("OfflineVerifierView Component", () => {
    it("runs offline verification and displays terminal output for valid and tampered bundles", async () => {
      const api = makeMockDashboardApi();
      render(<OfflineVerifierView api={api} />);

      // Run valid bundle check
      fireEvent.click(screen.getByRole("button", { name: "Verify Legitimate Bundle" }));
      await waitFor(() => {
        expect(api.verifyBundle).toHaveBeenCalledWith("valid", undefined);
        expect(screen.getAllByText(/VERIFIED VALID/).length).toBeGreaterThan(0);
        expect(screen.getByText(/RESULT: VERIFIED VALID OFFLINE/)).toBeDefined();
      });

      // Run tampered terms check
      fireEvent.click(
        screen.getByRole("button", { name: "Test Tampered Terms ($49.99 → $999.00)" }),
      );
      await waitFor(() => {
        expect(api.verifyBundle).toHaveBeenCalledWith("tampered", "terms");
        expect(screen.getByText(/FAILED: V1/)).toBeDefined();
      });
    });
  });

  describe("BusinessLedgerSurface Integration", () => {
    it("allows toggling between current authenticated workspace and demo policy", async () => {
      const api = makeMockDashboardApi();
      render(<BusinessLedgerSurface api={api} />);

      await waitFor(() => {
        expect(api.getOverview).toHaveBeenCalledWith(undefined, false);
      });

      // Switch to demo workspace
      const select = screen.getByLabelText("Workspace:");
      fireEvent.change(select, { target: { value: "demo" } });

      await waitFor(() => {
        expect(api.getOverview).toHaveBeenCalledWith("demo-northstar", true);
      });
    });
  });

  describe("Phase 7C: Interactive Spending Policy Modal & Product Discovery Studio", () => {
    it("renders Why Passkeys explainer and quick-search product suggestions", () => {
      const agentApi = makeApi();
      const passkeys = makePasskeys();
      const paypal = makePayPal();
      const dashboardApi = makeMockDashboardApi();

      render(
        <AgentWorkbench
          api={agentApi}
          passkeys={passkeys}
          paypal={paypal.port}
          dashboardApi={dashboardApi}
          now={() => NOW}
        />,
      );

      // Verify Why Passkeys card
      expect(screen.getByText(/Dual-Custody: The AI Proposes, You Authorize/)).toBeDefined();
      expect(
        screen.getByText(/cannot touch company funds or bypass your spending cap/),
      ).toBeDefined();

      // Verify product suggestions exist
      expect(screen.getByText(/75% Mechanical Keyboard/)).toBeDefined();
      expect(screen.getByText(/Gas-Spring Monitor Arm/)).toBeDefined();
      expect(screen.getByText(/Studio Headphones Setup/)).toBeDefined();

      // Clicking suggestion populates textarea
      const kbBtn = screen.getByRole("button", {
        name: "Select 75% Mechanical Keyboard for $85.00 USD",
      });
      fireEvent.click(kbBtn);

      const textarea = screen.getByLabelText("What should the agent buy?") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Buy a 75% mechanical keyboard");
    });

    it("opens spending policy modal, adjusts per-transaction cap, and updates workbench cap", async () => {
      const agentApi = makeApi();
      const passkeys = makePasskeys();
      const paypal = makePayPal();
      const dashboardApi = makeMockDashboardApi();

      render(
        <AgentWorkbench
          api={agentApi}
          passkeys={passkeys}
          paypal={paypal.port}
          dashboardApi={dashboardApi}
          now={() => NOW}
        />,
      );

      // Verify initial cap in navbar button ($100.00 / tx)
      const policyTrigger = screen.getByRole("button", {
        name: "Configure spending policy and transaction caps",
      });
      expect(policyTrigger.textContent).toContain("$100.00 USD / tx");

      // Click to open modal
      fireEvent.click(policyTrigger);
      expect(screen.getByRole("dialog", { name: "Spending Policy & Fraud Shield" })).toBeDefined();

      // Select $50 preset cap
      const preset50Btn = screen.getByRole("button", { name: "$50 (Strict)" });
      fireEvent.click(preset50Btn);

      // Submit modal
      const saveBtn = screen.getByRole("button", { name: "Save & Enforce Policy" });
      fireEvent.click(saveBtn);

      // Modal closed and cap in navbar updated to $50.00
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(policyTrigger.textContent).toContain("$50.00 USD / tx");
    });
  });
});
