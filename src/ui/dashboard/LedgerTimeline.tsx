"use client";

/**
 * Ledger Timeline Tape Component.
 *
 * Renders an append-only, tamper-evident hash chain vertical tape with
 * actor chips, status badges, short hashes, and expandable payload inspection.
 *
 * ARCHITECTURE.md §8, docs/DESIGN.md §4.
 */

import { useState } from "react";
import type { DashboardTimelineEvent } from "../../application/ports/dashboard-query-port.js";

export interface LedgerTimelineProps {
  readonly events: readonly DashboardTimelineEvent[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRefresh?: () => void;
}

export function LedgerTimeline({ events, loading, error, onRefresh }: LedgerTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterState, setFilterState] = useState<
    "ALL" | "captured" | "pending" | "failed" | "unknown"
  >("ALL");

  if (loading && events.length === 0) {
    return (
      <section className="panel" aria-labelledby="timeline-loading-heading">
        <h2 id="timeline-loading-heading" className="panel__title">
          Loading ledger events…
        </h2>
        <p className="progress" role="status">
          <span className="spinner" aria-hidden="true" />
          Reading tamper-evident event chain from the server…
        </p>
      </section>
    );
  }

  if (error && events.length === 0) {
    return (
      <section className="panel notice notice--breach" aria-labelledby="timeline-error-heading">
        <h2 id="timeline-error-heading" className="notice__title">
          Ledger timeline unavailable
        </h2>
        <p className="panel__text">Failed to query ledger events: {error}</p>
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

  const filteredEvents = events.filter((ev) => {
    if (filterState === "ALL") return true;
    return ev.lifecycleState === filterState;
  });

  return (
    <section className="panel" aria-labelledby="ledger-timeline-heading">
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
          <h2 id="ledger-timeline-heading" className="panel__title">
            Ledger Timeline ({events.length} Events)
          </h2>
          <p className="panel__text" style={{ margin: 0 }}>
            Tamper-evident, hash-chained sequence of issued mandates, passkey consents, and
            settlements.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label htmlFor="timeline-filter" className="sr-only">
            Filter by state
          </label>
          <select
            id="timeline-filter"
            className="wb-select"
            value={filterState}
            onChange={(e) => setFilterState(e.target.value as typeof filterState)}
          >
            <option value="ALL">All States ({events.length})</option>
            <option value="captured">Captured</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed / Denied</option>
            <option value="unknown">Unknown</option>
          </select>
          {onRefresh && (
            <button type="button" className="btn" onClick={onRefresh} title="Refresh ledger events">
              Refresh
            </button>
          )}
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="notice" role="status" style={{ textAlign: "center", padding: 24 }}>
          <p className="panel__text">
            {events.length === 0
              ? "No ledger events recorded for this workspace yet."
              : `No events matching filter: ${filterState}.`}
          </p>
        </div>
      ) : (
        <div className="timeline-tape" role="feed" aria-label="Ledger event feed">
          {filteredEvents.map((ev) => {
            const isExpanded = expandedId === ev.id;
            const shortPrev = ev.prevHash.slice(0, 8);
            const shortHash = ev.hash.slice(0, 8);

            const badgeClass =
              ev.lifecycleState === "captured"
                ? "badge--seal"
                : ev.lifecycleState === "failed"
                  ? "badge--breach"
                  : ev.lifecycleState === "unknown"
                    ? "badge--link"
                    : "badge--amber";

            return (
              <article
                key={ev.id}
                className={`timeline-event timeline-event--${ev.lifecycleState}`}
                aria-labelledby={`ev-title-${ev.id}`}
              >
                <div className="timeline-event__header">
                  <div className="timeline-event__meta">
                    <span className="timeline-event__seq">#{ev.seq}</span>
                    <span className={`badge ${badgeClass}`}>{ev.type}</span>
                    <span className="badge badge--link" style={{ fontSize: 10 }}>
                      {ev.actor.type}:{ev.actor.id.slice(0, 12)}
                    </span>
                  </div>
                  <time className="timeline-event__time" dateTime={ev.createdAt}>
                    {new Date(ev.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div className="timeline-event__hash">
                    <span>prev: {shortPrev}…</span> → <strong>hash: {shortHash}…</strong>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {ev.evidenceRef?.hash && (
                      <span className="badge" style={{ fontSize: 10 }}>
                        ref: {ev.evidenceRef.hash.slice(0, 8)}…
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "Hide Payload" : "Inspect"}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <pre
                    className="mono"
                    style={{
                      background: "var(--panel-2)",
                      border: "1px solid var(--line)",
                      borderRadius: 4,
                      padding: 10,
                      fontSize: 11,
                      overflowX: "auto",
                      margin: 0,
                    }}
                  >
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
