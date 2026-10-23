"use client";

/**
 * Blocked Attempts and Gate Denials Component.
 *
 * Displays attempted purchase terms, typed Gate reason codes (e.g. TX_CAP_EXCEEDED,
 * MERCHANT_NOT_ALLOWED, REPLAY_DETECTED), and accurate financial loss metrics.
 *
 * ARCHITECTURE.md §5, §12, docs/DESIGN.md §4.
 */

import { formatMinorUnits } from "../agent/format-money.js";
import type { BlockedAttemptRecord } from "../../application/ports/dashboard-query-port.js";

export interface BlockedAttemptsPanelProps {
  readonly attempts: readonly BlockedAttemptRecord[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRefresh?: () => void;
}

export function BlockedAttemptsPanel({
  attempts,
  loading,
  error,
  onRefresh,
}: BlockedAttemptsPanelProps) {
  if (loading && attempts.length === 0) {
    return (
      <section className="panel" aria-labelledby="blocked-loading-heading">
        <h2 id="blocked-loading-heading" className="panel__title">
          Loading blocked attempts…
        </h2>
        <p className="progress" role="status">
          <span className="spinner" aria-hidden="true" />
          Querying security denials from the ledger…
        </p>
      </section>
    );
  }

  if (error && attempts.length === 0) {
    return (
      <section className="panel notice notice--breach" aria-labelledby="blocked-error-heading">
        <h2 id="blocked-error-heading" className="notice__title">
          Blocked attempts unavailable
        </h2>
        <p className="panel__text">Failed to query security denials: {error}</p>
        {onRefresh && (
          <div className="actions">
            <button type="button" className="btn btn--primary" onClick={onRefresh}>
              Retry Query
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="blocked-panel-heading">
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
          <h2 id="blocked-panel-heading" className="panel__title">
            Gate Denials & Blocked Requests ({attempts.length})
          </h2>
          <p className="panel__text" style={{ margin: 0 }}>
            Attempted transactions blocked by domain policies or Gate invariants before any payment
            settlement could occur.
          </p>
        </div>

        {onRefresh && (
          <button type="button" className="btn" onClick={onRefresh}>
            Refresh
          </button>
        )}
      </div>

      {attempts.length === 0 ? (
        <div className="notice" role="status" style={{ textAlign: "center", padding: 24 }}>
          <p className="panel__text">
            No unauthorized or blocked attempts recorded for this workspace.
          </p>
        </div>
      ) : (
        <div className="blocked-table-wrap">
          <table className="blocked-table" aria-label="Blocked purchase attempts">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Merchant & Attempt</th>
                <th scope="col">Attempted Total</th>
                <th scope="col">Denial Code</th>
                <th scope="col">Stage</th>
                <th scope="col">Amount Over Cap</th>
                <th scope="col">Realized Savings</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((item) => (
                <tr key={item.id}>
                  <td>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </td>
                  <td>
                    <strong>{item.merchantDisplayName}</strong>
                    <div className="field__hint" style={{ fontSize: 11 }}>
                      ID: {item.merchantId}
                    </div>
                  </td>
                  <td>
                    <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                      {formatMinorUnits(item.attemptedAmountMinor, item.currency)}
                    </strong>
                  </td>
                  <td>
                    <span className="badge badge--breach">{item.denialCode}</span>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                      {item.denialReason}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge--link">{item.stage}</span>
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.amountAboveLimitMinor > 0 ? (
                      <span style={{ color: "var(--amber)" }}>
                        +{formatMinorUnits(item.amountAboveLimitMinor, item.currency)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>—</span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.realizedSavingsMinor > 0 ? (
                      <span style={{ color: "var(--seal)", fontWeight: 600 }}>
                        {formatMinorUnits(item.realizedSavingsMinor, item.currency)}
                      </span>
                    ) : (
                      <span
                        style={{ color: "var(--text-dim)" }}
                        title="Rejected before authorization; no funds were at risk"
                      >
                        $0.00
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
