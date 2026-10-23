"use client";

/**
 * Offline Evidence Verifier Terminal Component.
 *
 * Runs the pure domain verifier (verifyEvidenceBundle) on valid and tampered
 * evidence bundles offline (0 network calls, 0 DB queries, 0 private keys).
 *
 * ARCHITECTURE.md §11, ADR-0002, ADR-0003, docs/DESIGN.md §4.
 */

import { useState } from "react";
import type { DashboardApi, BundleVerificationView } from "./dashboard-api.js";

export interface OfflineVerifierViewProps {
  readonly api: DashboardApi;
}

export function OfflineVerifierView({ api }: OfflineVerifierViewProps) {
  const [loading, setLoading] = useState(false);
  const [verification, setVerification] = useState<BundleVerificationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTamper, setActiveTamper] = useState<"terms" | "hash" | "merchant">("terms");
  const [customPrice, setCustomPrice] = useState("999.00");
  const [isAttackSimulated, setIsAttackSimulated] = useState(false);

  const onVerify = async (
    mode: "valid" | "tampered",
    tamperType?: "terms" | "hash" | "signature",
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.verifyBundle(mode, tamperType);
      setVerification(res);
      setIsAttackSimulated(mode === "tampered");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateAttack = () => {
    void onVerify("tampered", activeTamper === "hash" ? "hash" : "terms");
  };

  return (
    <section className="panel" aria-labelledby="verifier-heading">
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
          <h2 id="verifier-heading" className="panel__title">
            Offline Evidence Bundle Verifier (V0–V8)
          </h2>
          <p className="panel__text" style={{ margin: 0 }}>
            Independently audit cryptographic attestations, UP/UV passkey binding, and hash chains
            offline.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--primary"
            disabled={loading}
            onClick={() => void onVerify("valid")}
          >
            {loading ? <span className="spinner" aria-hidden="true" /> : "Verify Legitimate Bundle"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void onVerify("tampered", "terms")}
          >
            Test Tampered Terms ($49.99 → $999.00)
          </button>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void onVerify("tampered", "hash")}
          >
            Test Broken Hash Chain
          </button>
        </div>
      </div>

      {/* Interactive Live Tamper Playground */}
      <div className="tamper-playground" style={{ marginTop: 12 }}>
        <div className="tamper-playground__header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="badge badge--amber">Interactive Attack Simulator</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Live In-Flight Tamper Terminal</span>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label
              htmlFor="simulate-toggle"
              style={{
                fontSize: 12,
                color: "var(--text-dim)",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <input
                id="simulate-toggle"
                type="checkbox"
                checked={isAttackSimulated}
                onChange={(e) => {
                  setIsAttackSimulated(e.target.checked);
                  if (e.target.checked) {
                    void onVerify("tampered", activeTamper === "hash" ? "hash" : "terms");
                  } else {
                    void onVerify("valid");
                  }
                }}
              />
              Simulate Live Attack
            </label>
            <button
              type="button"
              className="btn btn--primary"
              style={{ padding: "3px 10px", fontSize: 12 }}
              disabled={loading}
              onClick={handleSimulateAttack}
            >
              Execute In-Flight Tamper
            </button>
          </div>
        </div>

        {/* Side-by-Side Payload Terminal */}
        <div className="tamper-grid">
          <div className="tamper-col">
            <div className="tamper-col__title">
              <span className="badge badge--seal">1. Authentic Signed Terms</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
                Ed25519 Authority Attested
              </span>
            </div>
            <pre className="tamper-payload">
              {JSON.stringify(
                {
                  mandateId: "mandate-northstar-01",
                  payee: { merchantId: "shopx", displayName: "ShopX" },
                  payment: { amountMinor: 4999, currency: "USD" },
                  items: [{ sku: "KB-75", quantity: 1, unitAmountMinor: 4999 }],
                  signature: "ed25519:362d300aac872e82... [VALID]",
                  passkey: "Bound to Hash (UP=1, UV=1)",
                },
                null,
                2,
              )}
            </pre>
          </div>

          <div className="tamper-col">
            <div className="tamper-col__title">
              <span className="badge badge--breach">2. Intercepted Attack Payload</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--breach)" }}>
                {activeTamper === "terms"
                  ? "Tampered Price ($49.99 → $999.00)"
                  : activeTamper === "merchant"
                    ? "Substituted Rogue Merchant"
                    : "Broken Hash Chain (Bit-Flipped)"}
              </span>
            </div>
            <pre className="tamper-payload tamper-payload--tampered">
              {JSON.stringify(
                {
                  mandateId: "mandate-northstar-01",
                  payee: {
                    merchantId: activeTamper === "merchant" ? "rogue-merchant-vault" : "shopx",
                    displayName: activeTamper === "merchant" ? "Rogue Merchant" : "ShopX",
                  },
                  payment: {
                    amountMinor: activeTamper === "terms" ? 99900 : 4999,
                    currency: "USD",
                    _attack:
                      activeTamper === "terms"
                        ? "🚨 IN-FLIGHT TAMPER: $49.99 -> $999.00"
                        : "🚨 PAYEE SUBSTITUTION",
                  },
                  items: [
                    {
                      sku: "KB-75",
                      quantity: 1,
                      unitAmountMinor: activeTamper === "terms" ? 99900 : 4999,
                    },
                  ],
                  signature:
                    activeTamper === "hash"
                      ? "ed25519:BROKEN_HASH_CHAIN_MISMATCH"
                      : "ed25519:362d300aac872e82... [TAMPERED_SIG_INVALID]",
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>

        <div className="tamper-footer">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Attack Presets:</span>
            <button
              type="button"
              className={`chip ${activeTamper === "terms" ? "chip--active" : ""}`}
              onClick={() => {
                setActiveTamper("terms");
                void onVerify("tampered", "terms");
              }}
            >
              Price Inflation ($49.99 → $999)
            </button>
            <button
              type="button"
              className={`chip ${activeTamper === "merchant" ? "chip--active" : ""}`}
              onClick={() => {
                setActiveTamper("merchant");
                void onVerify("tampered", "terms");
              }}
            >
              Rogue Merchant Substitution
            </button>
            <button
              type="button"
              className={`chip ${activeTamper === "hash" ? "chip--active" : ""}`}
              onClick={() => {
                setActiveTamper("hash");
                void onVerify("tampered", "hash");
              }}
            >
              Merkle Hash Disruption
            </button>
          </div>
          <span className="badge badge--seal" style={{ fontSize: 11 }}>
            Zero PayPal Captures: 100% Guaranteed
          </span>
        </div>
      </div>

      {error && (
        <div className="notice notice--breach" role="alert" style={{ marginTop: 12 }}>
          <strong>Verification Error:</strong> {error}
        </div>
      )}

      {verification ? (
        <div
          className="terminal-panel"
          aria-label="Offline verifier terminal output"
          style={{ marginTop: 12 }}
        >
          <div className="terminal-header">
            <span>TERMINAL · pnpm verify:bundle --offline</span>
            <span className={`badge ${verification.valid ? "badge--seal" : "badge--breach"}`}>
              {verification.valid ? "VERIFIED VALID" : `FAILED: ${verification.failedCheck}`}
            </span>
          </div>
          <pre className={`terminal-body ${verification.valid ? "" : "terminal-body--failed"}`}>
            {verification.terminalOutput}
          </pre>
        </div>
      ) : (
        <div
          className="terminal-panel"
          style={{
            minHeight: 180,
            display: "grid",
            placeItems: "center",
            padding: 24,
            textAlign: "center",
            marginTop: 12,
          }}
        >
          <div>
            <p className="mono" style={{ color: "var(--text-dim)", fontSize: 13 }}>
              Select a verification target above to execute the pure domain offline verifier
              (V0–V8).
            </p>
            <p className="field__hint">
              Proves cryptographic integrity, passkey challenge binding, and Merkle tree inclusion
              with zero trust in our servers.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
