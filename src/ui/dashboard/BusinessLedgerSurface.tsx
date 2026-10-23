"use client";

/**
 * Business Ledger Surface Component.
 *
 * Provides the business overview, budget usage, timeline tape, and blocked attempts.
 * Enforces workspace isolation and supports clearly labeled Northstar Studio demo mode.
 *
 * ARCHITECTURE.md §12, docs/DESIGN.md §2 (Ledger surface).
 */

import { useEffect, useState, useCallback } from "react";
import type { DashboardApi } from "./dashboard-api.js";
import { BudgetOverviewCard } from "./BudgetOverviewCard.js";
import { LedgerTimeline } from "./LedgerTimeline.js";
import { BlockedAttemptsPanel } from "./BlockedAttemptsPanel.js";
import type {
  DashboardOverviewView,
  DashboardTimelineEvent,
  BlockedAttemptRecord,
} from "../../application/ports/dashboard-query-port.js";

export interface BusinessLedgerSurfaceProps {
  readonly api: DashboardApi;
}

export function BusinessLedgerSurface({ api }: BusinessLedgerSurfaceProps) {
  const [workspaceMode, setWorkspaceMode] = useState<"current" | "demo">("current");
  const [overview, setOverview] = useState<DashboardOverviewView | null>(null);
  const [events, setEvents] = useState<readonly DashboardTimelineEvent[]>([]);
  const [attempts, setAttempts] = useState<readonly BlockedAttemptRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDemo = workspaceMode === "demo";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, tl, blk] = await Promise.all([
        api.getOverview(isDemo ? "demo-northstar" : undefined, isDemo),
        api.getTimeline(isDemo ? "demo-northstar" : undefined, isDemo),
        api.getBlockedAttempts(isDemo ? "demo-northstar" : undefined, isDemo),
      ]);

      setOverview(ov);
      setEvents(tl.events);
      setAttempts(blk.attempts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, isDemo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 className="panel__title">Business Ledger & Financial Controls</h2>
          <p className="panel__text" style={{ margin: 0 }}>
            Authoritative spend caps, passkey approvals, settlement timeline, and audit evidence.
          </p>
        </div>

        <div className="wb-workspace-select">
          <label htmlFor="workspace-switcher">Workspace:</label>
          <select
            id="workspace-switcher"
            className="wb-select"
            value={workspaceMode}
            onChange={(e) => setWorkspaceMode(e.target.value as typeof workspaceMode)}
          >
            <option value="current">Current Authenticated Workspace</option>
            <option value="demo">Northstar Studio (Demo Policy $500 / $100)</option>
          </select>
        </div>
      </div>

      <BudgetOverviewCard
        overview={overview}
        loading={loading}
        error={error}
        onRetry={() => void loadData()}
      />

      <BlockedAttemptsPanel
        attempts={attempts}
        loading={loading}
        error={error}
        onRefresh={() => void loadData()}
      />

      <LedgerTimeline
        events={events}
        loading={loading}
        error={error}
        onRefresh={() => void loadData()}
      />
    </div>
  );
}
