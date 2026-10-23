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

  const onVerify = async (
    mode: "valid" | "tampered",
    tamperType?: "terms" | "hash" | "signature",
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.verifyBundle(mode, tamperType);
      setVerification(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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

      {error && (
        <div className="notice notice--breach" role="alert">
          <strong>Verification Error:</strong> {error}
        </div>
      )}

      {verification ? (
        <div className="terminal-panel" aria-label="Offline verifier terminal output">
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
