"use client";

/**
 * Spending Policy & Fraud Shield Configuration Modal.
 *
 * Allows users and businesses to customize their per-transaction cap and monthly budget.
 * Changes are enforced directly by the domain Gate on every purchase proposal.
 *
 * docs/DESIGN.md §2, §4, ARCHITECTURE.md §4.1
 */

import { useState, useEffect } from "react";
import { formatMinorUnits } from "../agent/format-money.js";
import type { PolicyDocument } from "../../domain/policy/policy.js";

export interface SpendingPolicyConfig {
  readonly maxPerTxMinor: number;
  readonly monthlyBudgetMinor: number;
  readonly currency: string;
}

export interface SpendingPolicyModalProps {
  readonly isOpen: boolean;
  readonly currentConfig: SpendingPolicyConfig;
  readonly onClose: () => void;
  readonly onSave: (config: SpendingPolicyConfig, policyDoc: PolicyDocument) => void;
}

const PRESET_CAPS = [
  { label: "$50 (Strict)", value: 5000 },
  { label: "$100 (Standard)", value: 10000 },
  { label: "$200 (Flexible)", value: 20000 },
  { label: "$500 (High Cap)", value: 50000 },
] as const;

const PRESET_BUDGETS = [
  { label: "$250 / mo", value: 25000 },
  { label: "$500 / mo", value: 50000 },
  { label: "$1,000 / mo", value: 100000 },
  { label: "$2,500 / mo", value: 250000 },
] as const;

export function buildPolicyDocument(capMinor: number, currency = "USD"): PolicyDocument {
  return {
    id: "policy-custom",
    version: 1,
    rules: {
      maxPerTxMinor: capMinor,
      currencyAllowlist: [currency],
      merchantAllowlist: ["shopx", "coffee-works", "cloudco", "office-plus"],
    },
  };
}

export function SpendingPolicyModal({
  isOpen,
  currentConfig,
  onClose,
  onSave,
}: SpendingPolicyModalProps) {
  const [capMinor, setCapMinor] = useState(currentConfig.maxPerTxMinor);
  const [budgetMinor, setBudgetMinor] = useState(currentConfig.monthlyBudgetMinor);
  const [customCapInput, setCustomCapInput] = useState(
    (currentConfig.maxPerTxMinor / 100).toString(),
  );

  useEffect(() => {
    if (isOpen) {
      setCapMinor(currentConfig.maxPerTxMinor);
      setBudgetMinor(currentConfig.monthlyBudgetMinor);
      setCustomCapInput((currentConfig.maxPerTxMinor / 100).toString());
    }
  }, [isOpen, currentConfig]);

  if (!isOpen) return null;

  const handleCustomCapChange = (raw: string) => {
    setCustomCapInput(raw);
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) {
      setCapMinor(Math.round(num * 100));
    }
  };

  const handleSelectPresetCap = (value: number) => {
    setCapMinor(value);
    setCustomCapInput((value / 100).toString());
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const config: SpendingPolicyConfig = {
      maxPerTxMinor: capMinor,
      monthlyBudgetMinor: budgetMinor,
      currency: "USD",
    };
    const policyDoc = buildPolicyDocument(capMinor, "USD");
    onSave(config, policyDoc);
    onClose();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-modal-title"
      >
        <header className="modal-header">
          <div>
            <span className="badge badge--seal">Active Guardrail</span>
            <h2 id="policy-modal-title" className="modal-title">
              Spending Policy & Fraud Shield
            </h2>
            <p className="modal-subtitle">
              Configure personal or business spending limits. The domain Gate blocks any proposal
              exceeding these limits before passkeys are called.
            </p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close policy settings"
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSave} className="modal-body">
          {/* Transaction Cap Section */}
          <div className="policy-section">
            <div className="policy-section__label-row">
              <label htmlFor="custom-cap-input" className="policy-label">
                Maximum Spend Cap per Transaction
              </label>
              <span className="policy-current-val">{formatMinorUnits(capMinor, "USD")} / tx</span>
            </div>
            <p className="policy-hint">
              Proposals above this cap are strictly denied (e.g. testing the $85 keyboard against a
              $50 cap).
            </p>

            <div className="policy-presets" role="group" aria-label="Transaction cap presets">
              {PRESET_CAPS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`policy-preset-btn ${
                    capMinor === preset.value ? "policy-preset-btn--selected" : ""
                  }`}
                  onClick={() => handleSelectPresetCap(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <label htmlFor="custom-cap-input" className="field__label">
                Or enter custom cap ($ USD):
              </label>
              <input
                id="custom-cap-input"
                type="number"
                min="1"
                step="1"
                className="input"
                value={customCapInput}
                onChange={(e) => handleCustomCapChange(e.target.value)}
              />
            </div>
          </div>

          {/* Monthly Budget Section */}
          <div className="policy-section">
            <div className="policy-section__label-row">
              <span className="policy-label">Monthly Spending Budget</span>
              <span className="policy-current-val">
                {formatMinorUnits(budgetMinor, "USD")} / month
              </span>
            </div>
            <p className="policy-hint">
              Cumulative monthly limit displayed on the ledger budget meter.
            </p>

            <div className="policy-presets" role="group" aria-label="Monthly budget presets">
              {PRESET_BUDGETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`policy-preset-btn ${
                    budgetMinor === preset.value ? "policy-preset-btn--selected" : ""
                  }`}
                  onClick={() => setBudgetMinor(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Security & Invariant Guarantee Card */}
          <div className="policy-guarantee">
            <h3 className="policy-guarantee__title">🛡️ Cryptographic & Policy Invariants</h3>
            <ul className="policy-guarantee__list">
              <li>
                <strong>Gate Invariant (I-02):</strong> The client is never trusted for terms. The
                server verifies this policy independently.
              </li>
              <li>
                <strong>Biometric Dual-Custody:</strong> No agent or automated script can spend
                funds without your physical passkey signature.
              </li>
              <li>
                <strong>Zero Leakage:</strong> PayPal is never contacted for transactions denied by
                this policy.
              </li>
            </ul>
          </div>

          <footer className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
              Save & Enforce Policy
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
