"use client";

import { useState } from "react";
import { formatMinorUnits } from "../agent/format-money.js";
import type { SpendingPolicyConfig } from "../dashboard/SpendingPolicyModal.js";
import { buildPolicyDocument } from "../dashboard/SpendingPolicyModal.js";
import type { PolicyDocument } from "../../domain/policy/policy.js";

export const DEDICATED_PRINCIPAL = {
  name: "Alex Vance",
  role: "VP of Engineering & Authorized Principal",
  workspace: "Enterprise Procurement",
  defaultCapMinor: 10000, // $100.00
  monthlyBudgetMinor: 50000, // $500.00
  avatar: "👔",
} as const;

export interface DemoAuthModalProps {
  readonly isOpen: boolean;
  readonly currentName: string;
  readonly currentPolicy: SpendingPolicyConfig;
  readonly onClose: () => void;
  readonly onSaveSession: (
    name: string,
    policyConfig: SpendingPolicyConfig,
    policyDoc: PolicyDocument,
  ) => void;
}

export function DemoAuthModal({
  isOpen,
  currentName,
  currentPolicy,
  onClose,
  onSaveSession,
}: DemoAuthModalProps) {
  const [selectedCapMinor, setSelectedCapMinor] = useState(currentPolicy.maxPerTxMinor);
  const [selectedBudgetMinor, setSelectedBudgetMinor] = useState(currentPolicy.monthlyBudgetMinor);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);

    try {
      // Call authoritative session endpoint to issue the signed cl_session cookie
      await fetch("/api/v1/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalId: "a11ce000-0000-4000-8000-000000000001",
          displayName: DEDICATED_PRINCIPAL.name,
        }),
      });
    } catch {
      // Proceed even if offline
    }

    setIsAuthenticating(false);
    setSuccessNotice(true);

    const newConfig: SpendingPolicyConfig = {
      maxPerTxMinor: selectedCapMinor,
      monthlyBudgetMinor: selectedBudgetMinor,
      currency: currentPolicy.currency,
    };
    const doc = buildPolicyDocument(selectedCapMinor, currentPolicy.currency);

    setTimeout(() => {
      setSuccessNotice(false);
      onSaveSession(DEDICATED_PRINCIPAL.name, newConfig, doc);
      onClose();
    }, 600);
  };

  return (
    <div
      className="policy-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="policy-modal-card" style={{ maxWidth: 480 }}>
        <div className="policy-modal-header">
          <div>
            <h2 id="auth-modal-title" className="policy-modal-title">
              👤 Executive Identity &amp; Dual-Custody Session
            </h2>
            <p className="policy-modal-subtitle">
              Dedicated signing authority for enterprise spending controls &amp; passkey
              dual-custody.
            </p>
          </div>
          <button
            type="button"
            className="policy-modal-close"
            onClick={onClose}
            aria-label="Close demo session modal"
          >
            ✕
          </button>
        </div>

        {/* Dedicated Authorized Principal Card */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px",
            background: "var(--panel-2, rgba(255, 255, 255, 0.04))",
            border: "1px solid var(--seal, #00d26a)",
            borderRadius: "var(--radius-panel, 12px)",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "rgba(0, 210, 106, 0.15)",
              border: "2px solid var(--seal, #00d26a)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
            }}
          >
            {DEDICATED_PRINCIPAL.avatar}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 16, color: "var(--text)" }}>
                {DEDICATED_PRINCIPAL.name}
              </strong>
              <span
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  background: "rgba(0, 210, 106, 0.18)",
                  color: "var(--seal, #00d26a)",
                  padding: "2px 8px",
                  borderRadius: 20,
                  border: "1px solid rgba(0, 210, 106, 0.3)",
                }}
              >
                Authorized
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
              {DEDICATED_PRINCIPAL.role}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Workspace: <strong>{DEDICATED_PRINCIPAL.workspace}</strong>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            void handleConfirm(e);
          }}
          style={{ display: "grid", gap: 14 }}
        >
          <div className="field">
            <label className="field__label">Active Per-Transaction Spending Cap</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[2500, 5000, 10000, 20000, 50000].map((capMinor) => (
                <button
                  key={capMinor}
                  type="button"
                  className={`policy-preset-btn ${selectedCapMinor === capMinor ? "policy-preset-btn--selected" : ""}`}
                  onClick={() => setSelectedCapMinor(capMinor)}
                >
                  {formatMinorUnits(capMinor, "USD")}
                </button>
              ))}
            </div>
          </div>

          <div className="policy-guarantee" style={{ padding: "10px 12px" }}>
            <div
              className="policy-guarantee__title"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <span>🛡️</span>
              <span>Hardware-Bound Dual Custody</span>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45 }}>
              The AI agent proposes orders in <strong>{DEDICATED_PRINCIPAL.name}</strong>&apos;s
              name, but cannot touch funds or initiate PayPal settlement without cryptographic
              confirmation.
            </p>
          </div>

          {successNotice && (
            <div className="notice notice--seal" role="status" style={{ fontSize: 12, padding: 8 }}>
              ✓ Session active for {DEDICATED_PRINCIPAL.name} with{" "}
              {formatMinorUnits(selectedCapMinor, "USD")} cap!
            </div>
          )}

          <div className="modal-footer" style={{ marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose} disabled={isAuthenticating}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={isAuthenticating}
              style={{ minWidth: 160 }}
            >
              {isAuthenticating ? "Authenticating Session…" : "Authenticate Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
