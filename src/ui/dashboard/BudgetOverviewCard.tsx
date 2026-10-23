"use client";

/**
 * Budget and Financial Metrics Overview Card.
 *
 * Displays authoritative server budget metrics, strictly separating blocked request
 * value, amount above policy cap, and defensible realized savings (I-10).
 *
 * ARCHITECTURE.md §12, docs/DESIGN.md §2, §4.
 */

import { formatMinorUnits } from "../agent/format-money.js";
import type { DashboardOverviewView } from "../../application/ports/dashboard-query-port.js";

export interface BudgetOverviewCardProps {
  readonly overview: DashboardOverviewView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry?: () => void;
}

export function BudgetOverviewCard({ overview, loading, error, onRetry }: BudgetOverviewCardProps) {
  if (loading && !overview) {
    return (
      <section className="panel" aria-labelledby="budget-loading-heading">
        <h2 id="budget-loading-heading" className="panel__title">
          Loading budget metrics…
        </h2>
        <p className="progress" role="status">
          <span className="spinner" aria-hidden="true" />
          Fetching authoritative ledger state from the server…
        </p>
      </section>
    );
  }

  if (error && !overview) {
    return (
      <section className="panel notice notice--breach" aria-labelledby="budget-error-heading">
        <h2 id="budget-error-heading" className="notice__title">
          Budget metrics unavailable
        </h2>
        <p className="panel__text">Failed to retrieve authoritative ledger metrics: {error}.</p>
        {onRetry && (
          <div className="actions">
            <button type="button" className="btn btn--primary" onClick={onRetry}>
              Retry Query
            </button>
          </div>
        )}
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="panel" aria-labelledby="budget-empty-heading">
        <h2 id="budget-empty-heading" className="panel__title">
          No budget configured
        </h2>
        <p className="panel__text">No policy or budget found for this workspace.</p>
      </section>
    );
  }

  const { budget, metrics, activitySummary, workspace } = overview;
  const spentPercent =
    budget.monthlyBudgetMinor !== null && budget.monthlyBudgetMinor > 0
      ? Math.min(100, Math.round((budget.spentMinor / budget.monthlyBudgetMinor) * 100))
      : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {workspace.isDemo && (
        <div className="notice notice--amber" role="status">
          <strong>DEMO DATA:</strong> Displaying illustrative policy for Northstar Studio ($500.00
          monthly budget, $100.00 transaction cap). Not merged with live records.
        </div>
      )}

      <div className="db-overview" aria-label="Business Metrics Summary">
        {/* Monthly Budget Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__label">Monthly Budget</h3>
            <span className="badge badge--link">
              Cap:{" "}
              {budget.perTxCapMinor !== null
                ? `${formatMinorUnits(budget.perTxCapMinor, budget.currency)} / tx`
                : "No cap"}
            </span>
          </div>
          <p className="metric-card__val">
            {budget.monthlyBudgetMinor !== null
              ? formatMinorUnits(budget.monthlyBudgetMinor, budget.currency)
              : "No limit"}
          </p>
          <div
            className="meter-track"
            role="progressbar"
            aria-valuenow={spentPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`meter-fill ${spentPercent > 80 ? "meter-fill--danger" : spentPercent > 50 ? "meter-fill--warning" : ""}`}
              style={{ width: `${spentPercent}%` }}
            />
          </div>
          <div className="metric-card__sub" style={{ justifyContent: "space-between" }}>
            <span>Spent: {formatMinorUnits(budget.spentMinor, budget.currency)}</span>
            <span>{budget.monthlyBudgetMinor !== null ? `${spentPercent}% used` : "Uncapped"}</span>
          </div>
        </div>

        {/* Remaining Budget Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__label">Remaining Budget</h3>
            {budget.pendingMinor > 0 && (
              <span className="badge badge--amber">
                Pending: {formatMinorUnits(budget.pendingMinor, budget.currency)}
              </span>
            )}
          </div>
          <p className="metric-card__val" style={{ color: "var(--seal)" }}>
            {budget.remainingMinor !== null
              ? formatMinorUnits(budget.remainingMinor, budget.currency)
              : "Uncapped"}
          </p>
          <p className="metric-card__sub">
            Available for authorized agent proposals in the current monthly period.
          </p>
        </div>

        {/* Blocked Requests & Over-Limit Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__label">Blocked Attempt Value</h3>
            <span className="badge badge--breach">{activitySummary.blockedCount} blocked</span>
          </div>
          <p className="metric-card__val" style={{ color: "var(--breach)" }}>
            {formatMinorUnits(metrics.blockedRequestValueMinor, metrics.currency)}
          </p>
          <p className="metric-card__sub">
            Amount attempted above cap:{" "}
            <strong>{formatMinorUnits(metrics.amountAboveLimitMinor, metrics.currency)}</strong>
          </p>
        </div>

        {/* Realized Savings Card */}
        <div className="metric-card">
          <div className="metric-card__header">
            <h3 className="metric-card__label">Defensible Realized Savings</h3>
            <span className="badge badge--seal">Verified</span>
          </div>
          <p className="metric-card__val" style={{ color: "var(--seal)" }}>
            {formatMinorUnits(metrics.realizedSavingsMinor, metrics.currency)}
          </p>
          <p className="metric-card__sub">
            Prevented losses from active unauthorized in-flight or replay attempts.
          </p>
        </div>
      </div>

      {metrics.savingsRationale && (
        <div className="rationale-box">
          <strong>Metric Accounting Note: </strong>
          {metrics.savingsRationale}
        </div>
      )}
    </div>
  );
}
