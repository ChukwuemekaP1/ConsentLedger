/**
 * Dashboard Query Port.
 *
 * Defines read-model queries for the business ledger, budget overview,
 * and blocked attempts history.
 *
 * ARCHITECTURE.md §3, §12
 * INVARIANTS: I-02, I-03, I-10, I-11.
 */

export interface WorkspaceBudgetView {
  readonly currency: string;
  readonly monthlyBudgetMinor: number | null;
  readonly spentMinor: number;
  readonly pendingMinor: number;
  readonly unknownMinor?: number;
  readonly remainingMinor: number | null;
  readonly perTxCapMinor: number | null;
}

export interface ValueMetricsView {
  readonly currency: string;
  /** Total attempted value of blocked requests */
  readonly blockedRequestValueMinor: number;
  /** Value attempted in excess of the policy limit */
  readonly amountAboveLimitMinor: number;
  /**
   * Realized financial loss prevented by blocking requests.
   * Only populated when funds/authorizations were actively at risk (e.g. replayed approval).
   * Unapproved chat suggestions are NOT labeled as realized savings.
   */
  readonly realizedSavingsMinor: number;
  readonly savingsRationale: string;
}

export interface ActivitySummaryView {
  readonly totalTransactions: number;
  readonly capturedCount: number;
  readonly pendingCount: number;
  readonly unknownCount?: number;
  readonly blockedCount: number;
}

export interface DashboardOverviewView {
  readonly workspace: {
    readonly id: string;
    readonly displayName: string;
    readonly isDemo: boolean;
  };
  readonly budget: WorkspaceBudgetView;
  readonly metrics: ValueMetricsView;
  readonly activitySummary: ActivitySummaryView;
}

export interface DashboardTimelineEvent {
  readonly id: string;
  readonly correlationId: string;
  readonly seq: number;
  readonly type: string;
  readonly actor: {
    readonly type: string;
    readonly id: string;
  };
  readonly payload: Record<string, unknown>;
  readonly prevHash: string;
  readonly hash: string;
  readonly createdAt: string;
  readonly lifecycleState: "pending" | "captured" | "failed" | "unknown";
  readonly evidenceRef?:
    | {
        readonly type: string;
        readonly id?: string | undefined;
        readonly hash?: string | undefined;
      }
    | undefined;
}

export interface BlockedAttemptRecord {
  readonly id: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly merchantId: string;
  readonly merchantDisplayName: string;
  readonly attemptedAmountMinor: number;
  readonly currency: string;
  readonly policyLimitMinor: number;
  readonly amountAboveLimitMinor: number;
  readonly denialCode: string;
  readonly denialReason: string;
  readonly stage: "POLICY" | "GATE" | "SETTLEMENT";
  readonly realizedSavingsMinor: number;
  readonly savingsRationale?: string | undefined;
}

export interface DashboardQueryPort {
  /**
   * Fetch business overview and budget usage for a principal workspace.
   */
  getOverview(principalId: string, isDemoRequested?: boolean): Promise<DashboardOverviewView>;

  /**
   * Fetch ledger timeline events and payment states for a principal workspace.
   */
  getTimeline(
    principalId: string,
    isDemoRequested?: boolean,
  ): Promise<readonly DashboardTimelineEvent[]>;

  /**
   * Fetch blocked attempts with typed Gate denial codes and attempted terms.
   */
  getBlockedAttempts(
    principalId: string,
    isDemoRequested?: boolean,
  ): Promise<readonly BlockedAttemptRecord[]>;
}
