/**
 * Typed client for Dashboard and Security Lab API endpoints.
 *
 * ARCHITECTURE.md §13
 * INVARIANTS: I-02, I-10, I-11.
 */

import type {
  DashboardOverviewView,
  DashboardTimelineEvent,
  BlockedAttemptRecord,
} from "../../application/ports/dashboard-query-port.js";
import type { ScenarioResult } from "../../application/lab/types.js";
import type { CheckResult } from "../../domain/evidence/types.js";

export interface LabScenarioMeta {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly targetInvariant: string;
  readonly expectedDecision: string;
  readonly expectedReasonCode: string;
}

export interface BundleVerificationView {
  readonly mode: string;
  readonly tamperType?: string | undefined;
  readonly valid: boolean;
  readonly failedCheck?: string | undefined;
  readonly code?: string | undefined;
  readonly message: string;
  readonly checks: readonly CheckResult[];
  readonly terminalOutput: string;
}

export interface DashboardApi {
  getOverview(workspaceId?: string, isDemo?: boolean): Promise<DashboardOverviewView>;
  getTimeline(
    workspaceId?: string,
    isDemo?: boolean,
  ): Promise<{ workspaceId: string; isDemo: boolean; events: readonly DashboardTimelineEvent[] }>;
  getBlockedAttempts(
    workspaceId?: string,
    isDemo?: boolean,
  ): Promise<{ workspaceId: string; isDemo: boolean; attempts: readonly BlockedAttemptRecord[] }>;
  getLabScenarios(): Promise<{ totalScenarios: number; scenarios: readonly LabScenarioMeta[] }>;
  runLabScenarios(scenarioId?: string): Promise<{
    totalExecuted: number;
    allPassed: boolean;
    zeroCaptureEnforced: boolean;
    results: readonly ScenarioResult[];
  }>;
  verifyBundle(
    mode: "valid" | "tampered" | "custom",
    tamperType?: "terms" | "hash" | "signature",
  ): Promise<BundleVerificationView>;
}

export function createDashboardApi(
  fetchFn: (input: string | URL, init?: RequestInit) => Promise<Response>,
): DashboardApi {
  return {
    async getOverview(workspaceId?: string, isDemo?: boolean): Promise<DashboardOverviewView> {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      if (isDemo) params.set("demo", "true");
      const qs = params.toString() ? `?${params.toString()}` : "";

      const res = await fetchFn(`/api/v1/dashboard/overview${qs}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(
          (errorBody as { detail?: string }).detail ?? `Failed to fetch overview (${res.status})`,
        );
      }
      return (await res.json()) as DashboardOverviewView;
    },

    async getTimeline(workspaceId?: string, isDemo?: boolean) {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      if (isDemo) params.set("demo", "true");
      const qs = params.toString() ? `?${params.toString()}` : "";

      const res = await fetchFn(`/api/v1/dashboard/ledger${qs}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(
          (errorBody as { detail?: string }).detail ?? `Failed to fetch timeline (${res.status})`,
        );
      }
      return (await res.json()) as {
        workspaceId: string;
        isDemo: boolean;
        events: readonly DashboardTimelineEvent[];
      };
    },

    async getBlockedAttempts(workspaceId?: string, isDemo?: boolean) {
      const params = new URLSearchParams();
      if (workspaceId) params.set("workspaceId", workspaceId);
      if (isDemo) params.set("demo", "true");
      const qs = params.toString() ? `?${params.toString()}` : "";

      const res = await fetchFn(`/api/v1/dashboard/blocked-attempts${qs}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(
          (errorBody as { detail?: string }).detail ??
            `Failed to fetch blocked attempts (${res.status})`,
        );
      }
      return (await res.json()) as {
        workspaceId: string;
        isDemo: boolean;
        attempts: readonly BlockedAttemptRecord[];
      };
    },

    async getLabScenarios() {
      const res = await fetchFn("/api/v1/lab/scenarios", {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Failed to list lab scenarios (${res.status})`);
      }
      return (await res.json()) as {
        totalScenarios: number;
        scenarios: readonly LabScenarioMeta[];
      };
    },

    async runLabScenarios(scenarioId?: string) {
      const res = await fetchFn("/api/v1/lab/scenarios/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ scenarioId: scenarioId ?? "all" }),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(
          (errorBody as { detail?: string }).detail ?? `Failed to run scenario (${res.status})`,
        );
      }
      return (await res.json()) as {
        totalExecuted: number;
        allPassed: boolean;
        zeroCaptureEnforced: boolean;
        results: readonly ScenarioResult[];
      };
    },

    async verifyBundle(
      mode: "valid" | "tampered" | "custom",
      tamperType?: "terms" | "hash" | "signature",
    ): Promise<BundleVerificationView> {
      const res = await fetchFn("/api/v1/lab/verify-bundle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ mode, tamperType }),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(
          (errorBody as { detail?: string }).detail ?? `Verification failed (${res.status})`,
        );
      }
      return (await res.json()) as BundleVerificationView;
    },
  };
}
