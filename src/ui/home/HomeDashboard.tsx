"use client";

import { useMemo, useState } from "react";
import type {
  DashboardOverviewView,
  DashboardTimelineEvent,
  BlockedAttemptRecord,
} from "../../application/ports/dashboard-query-port.js";
import { formatMinorUnits } from "../agent/format-money.js";
import type { SpendingPolicyConfig } from "../dashboard/SpendingPolicyModal.js";

export interface HomeDashboardProps {
  readonly overview?: DashboardOverviewView | undefined;
  readonly events?: readonly DashboardTimelineEvent[] | undefined;
  readonly blockedAttempts?: readonly BlockedAttemptRecord[] | undefined;
  readonly displayName?: string | undefined;
  readonly policyConfig: SpendingPolicyConfig;
  readonly onOpenPurchaseModal: () => void;
  readonly onOpenPolicyModal: () => void;
  readonly onOpenAuthModal?: () => void;
  readonly onSelectTransaction?: (event: DashboardTimelineEvent) => void;
}

type FilterTab = "all" | "captured" | "pending" | "blocked";

export function HomeDashboard({
  overview,
  events = [],
  blockedAttempts = [],
  displayName,
  policyConfig,
  onOpenPurchaseModal,
  onOpenPolicyModal,
  onOpenAuthModal,
}: HomeDashboardProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  const userName = displayName?.trim() || "Shopper";

  // Derive dynamic list of authentic stores seen in real transactions
  const dynamicStores = useMemo(() => {
    const storesMap = new Map<string, { count: number; name: string }>();
    for (const ev of events) {
      const payload = ev.payload;
      const terms = payload["terms"] as
        { payee?: { displayName?: string; merchantId?: string } } | undefined;
      const proposal = payload["proposal"] as
        { payee?: { displayName?: string; merchantId?: string } } | undefined;
      const payee = terms?.payee ?? proposal?.payee;
      if (payee) {
        const id = payee.merchantId || payee.displayName || "merchant";
        const name = payee.displayName || payee.merchantId || "Merchant Store";
        const existing = storesMap.get(id);
        if (existing) {
          existing.count++;
        } else {
          storesMap.set(id, { count: 1, name });
        }
      }
    }
    return Array.from(storesMap.entries()).map(([id, info]) => ({
      id,
      name: info.name,
      count: info.count,
    }));
  }, [events]);

  // Spending figures
  const spentMinor = overview?.budget.spentMinor ?? 0;
  const budgetMinor = policyConfig.monthlyBudgetMinor;
  const remainingMinor = Math.max(0, budgetMinor - spentMinor);
  const percentUsed =
    budgetMinor > 0 ? Math.min(100, Math.round((spentMinor / budgetMinor) * 100)) : 0;

  // Build correlation map to resolve rich terms for any transaction event
  const correlationTermsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        desc: string;
        merchant: string;
        amountMinor?: number | undefined;
        currency?: string | undefined;
      }
    >();
    for (const ev of events) {
      const payload = ev.payload;
      const terms = payload["terms"] as
        | {
            payee?: { displayName?: string };
            payment?: { amountMinor?: number; currency?: string };
            items?: Array<{ description?: string; quantity?: number }>;
          }
        | undefined;
      const prompt = payload["prompt"] as string | undefined;
      if (terms) {
        const desc = terms.items?.[0]?.description || prompt || "Authorized Purchase";
        const merchant = terms.payee?.displayName || "Authorized Merchant";
        map.set(ev.correlationId, {
          desc,
          merchant,
          amountMinor: terms.payment?.amountMinor,
          currency: terms.payment?.currency,
        });
      }
    }
    return map;
  }, [events]);

  // Aggregate one primary display card per correlation
  const primaryOrderEvents = useMemo(() => {
    const correlationMap = new Map<string, DashboardTimelineEvent>();
    const typePriority: Record<string, number> = {
      CAPTURE_COMPLETED: 5,
      PAYMENT_CAPTURED: 5,
      POLICY_DENIED: 5,
      EXECUTION_DENIED: 5,
      ORDER_CREATED: 4,
      CONSENT_RECORDED: 3,
      MANDATE_ISSUED: 2,
    };
    for (const ev of events) {
      const existing = correlationMap.get(ev.correlationId);
      const currentPriority = typePriority[ev.type] ?? 1;
      const existingPriority = existing ? (typePriority[existing.type] ?? 1) : 0;
      if (!existing || currentPriority > existingPriority) {
        correlationMap.set(ev.correlationId, ev);
      }
    }
    return Array.from(correlationMap.values());
  }, [events]);

  // Filtered purchases / events
  const filteredEvents = useMemo(() => {
    const source = primaryOrderEvents.length > 0 ? primaryOrderEvents : events;
    if (activeFilter === "all") return source;
    if (activeFilter === "captured") {
      return source.filter((e) => e.lifecycleState === "captured" || e.type.includes("CAPTURE"));
    }
    if (activeFilter === "pending") {
      return source.filter((e) => e.lifecycleState === "pending" || e.type.includes("CONSENT"));
    }
    return source.filter((e) => e.type.includes("DENIED") || e.type.includes("BLOCKED"));
  }, [primaryOrderEvents, events, activeFilter]);

  return (
    <div className="home-dashboard-layout">
      {/* 1. Header Greeting Row (Reference Style) */}
      <div className="home-greeting-bar">
        <div className="home-greeting-text">
          <h1 className="home-title">
            Hello <span className="home-title-name">{userName}</span>
          </h1>
          <p className="home-subtitle">Your personal autonomous shopping companion is active</p>
        </div>

        <div className="home-header-actions">
          {onOpenAuthModal && (
            <button
              type="button"
              className="home-policy-badge-btn"
              onClick={onOpenAuthModal}
              title="Authorized Principal: Alex Vance"
            >
              <span>👔 Principal: {userName}</span>
              <span className="home-badge-action" style={{ color: "var(--seal, #00d26a)" }}>
                Active
              </span>
            </button>
          )}
          <button
            type="button"
            className="home-policy-badge-btn"
            onClick={onOpenPolicyModal}
            title="Configure monthly and per-transaction spending guardrails"
          >
            <span>
              🔒 Cap: {formatMinorUnits(policyConfig.maxPerTxMinor, policyConfig.currency)}
            </span>
            <span className="home-badge-action">Edit</span>
          </button>
        </div>
      </div>

      {/* 2. Hero Spend Overview Card (Inspired by Reference Health Report) */}
      <div className="home-hero-card">
        <div className="home-hero-header">
          <span className="home-hero-label">Spending &amp; Policy Guardrails</span>
          <span className="home-hero-tag">Biometric Dual-Custody</span>
        </div>

        <div className="home-hero-metrics-row">
          {/* Dark Contrast Hero Tile */}
          <div className="home-hero-tile home-hero-tile--dark">
            <span className="home-tile-label">Spent This Month</span>
            <div className="home-tile-value">
              {formatMinorUnits(spentMinor, policyConfig.currency)}
            </div>
            <div className="home-tile-sub">
              <span>{percentUsed}% of designated budget</span>
            </div>
          </div>

          {/* Light Balance Tile */}
          <div className="home-hero-tile home-hero-tile--light">
            <div className="home-tile-content">
              <span className="home-tile-label">Left to Spend</span>
              <div className="home-tile-value home-tile-value--green">
                {formatMinorUnits(remainingMinor, policyConfig.currency)}
              </div>
              <span className="home-tile-sub">
                Monthly Cap: {formatMinorUnits(budgetMinor, policyConfig.currency)}
              </span>
            </div>

            {/* Circular Progress Indicator */}
            <div className="home-progress-ring" aria-hidden="true">
              <svg viewBox="0 0 36 36" className="circular-chart">
                <path
                  className="circle-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="circle"
                  strokeDasharray={`${percentUsed}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <text x="18" y="20.35" className="percentage">
                  {percentUsed}%
                </text>
              </svg>
            </div>
          </div>
        </div>

        {/* Action Button: Make a Purchase */}
        <div className="home-hero-cta">
          <button type="button" className="home-btn-purchase-primary" onClick={onOpenPurchaseModal}>
            <span className="purchase-cta-icon">✨</span>
            <span className="purchase-cta-text">Make a Purchase</span>
            <span className="purchase-cta-arrow">→</span>
          </button>
        </div>
      </div>

      {/* 3. Real Stores Visited Strip */}
      <div className="home-stores-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Verified Merchants &amp; Catalogs</h2>
          <span className="home-section-meta">Channel3 Live Ingestion</span>
        </div>

        {dynamicStores.length > 0 ? (
          <div className="home-stores-scroll-grid">
            {dynamicStores.map((st) => (
              <div key={st.id} className="home-store-chip">
                <span className="store-chip-icon">🏬</span>
                <span className="store-chip-name">{st.name}</span>
                <span className="store-chip-count">{st.count} orders</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="home-stores-empty">
            <span>
              No merchant stores logged yet. Your first purchase will record authentic store
              provenance here.
            </span>
          </div>
        )}
      </div>

      {/* 4. Filter Chips (Reference Style: All, Face, Body, Lip -> All, Bought, Pending, Blocked) */}
      <div className="home-filter-strip">
        <div className="home-filter-header">
          <h2 className="home-section-title">Activity &amp; Orders</h2>
        </div>
        <div className="home-chips-row" role="tablist" aria-label="Order filters">
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "all"}
            className={`home-pill-chip ${activeFilter === "all" ? "is-active" : ""}`}
            onClick={() => setActiveFilter("all")}
          >
            All Orders ({events.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "captured"}
            className={`home-pill-chip ${activeFilter === "captured" ? "is-active" : ""}`}
            onClick={() => setActiveFilter("captured")}
          >
            Bought / Settled
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "pending"}
            className={`home-pill-chip ${activeFilter === "pending" ? "is-active" : ""}`}
            onClick={() => setActiveFilter("pending")}
          >
            Pending Approval
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "blocked"}
            className={`home-pill-chip ${activeFilter === "blocked" ? "is-active" : ""}`}
            onClick={() => setActiveFilter("blocked")}
          >
            Blocked by Policy ({blockedAttempts.length})
          </button>
        </div>
      </div>

      {/* 5. Orders & Purchases List */}
      <div className="home-purchases-container">
        {filteredEvents.length > 0 ? (
          <div className="home-cards-grid">
            {filteredEvents.slice(0, 8).map((ev) => {
              const payload = ev.payload;
              const corrInfo = correlationTermsMap.get(ev.correlationId);

              const desc =
                corrInfo?.desc ||
                (payload["prompt"] as string | undefined) ||
                "Authorized Purchase";
              const merchant = corrInfo?.merchant || "Authorized Merchant";
              const amountMinor =
                corrInfo?.amountMinor ??
                (payload["amountMinor"] as number | undefined) ??
                (payload["attemptedAmountMinor"] as number | undefined);
              const currency =
                corrInfo?.currency || (payload["currency"] as string | undefined) || "USD";
              const amountFormatted = amountMinor
                ? formatMinorUnits(amountMinor, currency)
                : undefined;

              return (
                <div key={ev.id} className="home-order-card">
                  <div className="home-order-card-icon">
                    <span>🛍️</span>
                  </div>
                  <div className="home-order-card-details">
                    <span className="home-order-title">{desc}</span>
                    <span className="home-order-sub">
                      {merchant} · {new Date(ev.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="home-order-card-meta">
                    {amountFormatted && (
                      <span className="home-order-amount">{amountFormatted}</span>
                    )}
                    <span
                      className={`home-status-badge ${
                        ev.lifecycleState === "captured"
                          ? "home-status--captured"
                          : ev.lifecycleState === "pending"
                            ? "home-status--pending"
                            : "home-status--standard"
                      }`}
                    >
                      {ev.lifecycleState === "captured"
                        ? "✓ Settled"
                        : ev.lifecycleState === "pending"
                          ? "⏳ Pending"
                          : "Audit Event"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="home-purchases-empty">
            <div className="empty-cart-icon">🛒</div>
            <h3 className="empty-cart-title">No purchases in this view</h3>
            <p className="empty-cart-desc">
              Ask the agent to source products within your spending policy limits.
            </p>
            <button type="button" className="cl-btn cl-btn--primary" onClick={onOpenPurchaseModal}>
              Start First Purchase
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
