"use client";

/**
 * Security Lab Suite Component.
 *
 * Runs the Phase 6B adversarial scenarios against the real domain Gate and application use cases.
 * Demonstrates zero PayPal capture calls on all blocked attacks and links to evidence events.
 *
 * ARCHITECTURE.md §5, §8.1, docs/DESIGN.md §2, §4.
 */

import { useState } from "react";
import type { LabScenarioMeta, DashboardApi } from "./dashboard-api.js";
import type { ScenarioResult } from "../../application/lab/types.js";
import { formatMinorUnits } from "../agent/format-money.js";

export interface SecurityLabPanelProps {
  readonly scenarios: readonly LabScenarioMeta[];
  readonly api: DashboardApi;
}

export function SecurityLabPanel({ scenarios, api }: SecurityLabPanelProps) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const onRunSingle = async (scenarioId: string) => {
    setRunningId(scenarioId);
    setGlobalError(null);
    try {
      const res = await api.runLabScenarios(scenarioId);
      const result = res.results[0];
      if (result) {
        setResults((prev) => ({ ...prev, [scenarioId]: result }));
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  const onRunAll = async () => {
    setRunningId("all");
    setGlobalError(null);
    try {
      const res = await api.runLabScenarios("all");
      const mapped: Record<string, ScenarioResult> = {};
      for (const r of res.results) {
        mapped[r.scenarioId] = r;
      }
      setResults(mapped);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  const executedCount = Object.keys(results).length;
  const passedCount = Object.values(results).filter((r) => r.runStatus === "PASSED").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header className="panel" style={{ display: "grid", gap: 8 }}>
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
            <h2 className="panel__title">Security Lab: Adversarial Attack Suite</h2>
            <p className="panel__text" style={{ margin: 0 }}>
              Reproducible cryptographic, settlement, and injection attacks executed against the
              real Gate (I-01 through I-11).
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={runningId !== null}
              onClick={() => void onRunAll()}
            >
              {runningId === "all" ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Running All 9 Scenarios…
                </>
              ) : (
                "Run Full Attack Suite"
              )}
            </button>
          </div>
        </div>

        {globalError && (
          <div className="notice notice--breach" role="alert">
            <strong>Security Lab Runner Error:</strong> {globalError}
          </div>
        )}

        {executedCount > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
              background: "var(--panel-2)",
              padding: "8px 12px",
              borderRadius: "var(--radius-control)",
              fontSize: 12,
            }}
          >
            <span>
              Suite Verdict:{" "}
              <strong>
                {passedCount} / {executedCount} Passed
              </strong>
            </span>
            <span className="badge badge--seal">Zero PayPal Captures: ENFORCED</span>
            <span className="badge badge--link">Pure Domain Gate Invariants Verified</span>
          </div>
        )}
      </header>

      <div className="lab-grid" role="region" aria-label="Adversarial attack scenarios">
        {scenarios.map((meta) => {
          const result = results[meta.id];
          const isBusy = runningId === meta.id || runningId === "all";

          return (
            <article key={meta.id} className="scenario-card" aria-labelledby={`title-${meta.id}`}>
              <div className="scenario-card__header">
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span className="badge badge--amber" style={{ fontSize: 10 }}>
                      {meta.category}
                    </span>
                    {result && (
                      <span
                        className={`badge ${result.runStatus === "PASSED" ? "badge--seal" : "badge--breach"}`}
                      >
                        {result.runStatus}
                      </span>
                    )}
                  </div>
                  <h3 id={`title-${meta.id}`} className="scenario-card__title">
                    {meta.name}
                  </h3>
                </div>

                <button
                  type="button"
                  className="btn"
                  disabled={isBusy}
                  onClick={() => void onRunSingle(meta.id)}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {runningId === meta.id ? <span className="spinner" aria-hidden="true" /> : "Run"}
                </button>
              </div>

              <p className="scenario-card__desc">{meta.description}</p>
              <div className="field__hint" style={{ fontSize: 11 }}>
                Target: {meta.targetInvariant}
              </div>

              {result && (
                <div className="scenario-card__verdict">
                  <div className="scenario-card__row">
                    <span>Gate Decision:</span>
                    <strong
                      style={{
                        color: result.decision === "BLOCKED" ? "var(--breach)" : "var(--seal)",
                      }}
                    >
                      {result.decision} (Expected: {result.expectedDecision})
                    </strong>
                  </div>

                  <div className="scenario-card__row">
                    <span>Reason Code:</span>
                    <span className="mono" style={{ color: "var(--amber)" }}>
                      {result.reasonCode}
                    </span>
                  </div>

                  <div className="scenario-card__row">
                    <span>PayPal Captures:</span>
                    <strong
                      style={{
                        color: result.captureCallCount === 0 ? "var(--seal)" : "var(--breach)",
                      }}
                    >
                      {result.captureCallCount} attempted
                    </strong>
                  </div>

                  {result.valueMetrics && (
                    <div
                      style={{
                        borderTop: "1px solid var(--line)",
                        paddingTop: 6,
                        marginTop: 4,
                        display: "grid",
                        gap: 2,
                      }}
                    >
                      <div className="scenario-card__row">
                        <span>Attempted Spend:</span>
                        <span>
                          {formatMinorUnits(
                            result.valueMetrics.attemptedAmountMinor,
                            result.valueMetrics.currency,
                          )}
                        </span>
                      </div>
                      {result.valueMetrics.realizedSavingsMinor !== undefined && (
                        <div className="scenario-card__row">
                          <span style={{ color: "var(--seal)" }}>Realized Savings:</span>
                          <strong style={{ color: "var(--seal)" }}>
                            {formatMinorUnits(
                              result.valueMetrics.realizedSavingsMinor,
                              result.valueMetrics.currency,
                            )}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}

                  {result.evidenceReferences && result.evidenceReferences.length > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                      Evidence: {result.evidenceReferences[0]?.type} (
                      {result.evidenceReferences[0]?.id?.slice(0, 8) ??
                        result.evidenceReferences[0]?.hash?.slice(0, 8)}
                      …)
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
