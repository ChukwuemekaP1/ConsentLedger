"use client";

import { useState } from "react";
import { ThemeToggle } from "../theme/ThemeToggle.js";
import type { ClientConfig } from "../agent/api-schemas.js";
import { formatMinorUnits } from "../agent/format-money.js";

export type Surface = "home" | "agent" | "ledger" | "lab";

export interface AppNavigationProps {
  readonly activeSurface: Surface;
  readonly onSelectSurface: (surface: Surface) => void;
  readonly onOpenPurchaseModal: () => void;
  readonly onOpenPolicyModal: () => void;
  readonly onOpenAuthModal?: () => void;
  readonly labEnabled?: boolean;
  readonly config?: ClientConfig | undefined;
  readonly configError?: boolean;
  readonly passkeyRegistered?: boolean;
  readonly displayName?: string | undefined;
  readonly maxPerTxMinor?: number | undefined;
}

export function AppNavigation({
  activeSurface,
  onSelectSurface,
  onOpenPurchaseModal,
  onOpenPolicyModal,
  onOpenAuthModal,
  labEnabled = true,
  config,
  configError,
  passkeyRegistered,
  displayName,
  maxPerTxMinor,
}: AppNavigationProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSelect = (surface: Surface) => {
    onSelectSurface(surface);
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="app-nav-header">
      <div className="app-nav-inner">
        {/* Brand / Logo */}
        <div
          className="app-nav-brand"
          onClick={() => handleSelect("home")}
          role="button"
          tabIndex={0}
        >
          <div className="app-logo-badge">
            <span className="app-logo-icon">🔒</span>
          </div>
          <div className="app-brand-text">
            <span className="app-brand-title">ConsentLedger</span>
            <span className="app-brand-badge">Dual-Custody</span>
          </div>
        </div>

        {/* Desktop Surface Tabs (Visible on screens >= 900px) */}
        <nav className="desktop-nav-tabs" role="tablist" aria-label="Workbench Surfaces">
          <button
            type="button"
            role="tab"
            id="tab-home"
            aria-label="Home"
            aria-selected={activeSurface === "home"}
            aria-controls="panel-home"
            className={`nav-tab-btn ${activeSurface === "home" ? "is-active" : ""}`}
            onClick={() => handleSelect("home")}
          >
            <span className="nav-tab-icon">🏠</span>
            <span>Home</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-agent"
            aria-label="Agent Workbench"
            aria-selected={activeSurface === "agent"}
            aria-controls="panel-agent"
            className={`nav-tab-btn ${activeSurface === "agent" ? "is-active" : ""}`}
            onClick={() => handleSelect("agent")}
          >
            <span className="nav-tab-icon">✨</span>
            <span>Agent Workbench</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-ledger"
            aria-label="Business Ledger"
            aria-selected={activeSurface === "ledger"}
            aria-controls="panel-ledger"
            className={`nav-tab-btn ${activeSurface === "ledger" ? "is-active" : ""}`}
            onClick={() => handleSelect("ledger")}
          >
            <span className="nav-tab-icon">📜</span>
            <span>Business Ledger</span>
          </button>
          {labEnabled && (
            <button
              type="button"
              role="tab"
              id="tab-lab"
              aria-label="Security Lab"
              aria-selected={activeSurface === "lab"}
              aria-controls="panel-lab"
              className={`nav-tab-btn ${activeSurface === "lab" ? "is-active" : ""}`}
              onClick={() => handleSelect("lab")}
            >
              <span className="nav-tab-icon">🛡️</span>
              <span>Security Lab</span>
            </button>
          )}
        </nav>

        {/* Right Tools: Badges, Profile, Policy, Purchase CTA, Theme Toggle, Mobile Menu Toggle */}
        <div className="app-nav-right">
          {/* Environment Badges list */}
          <ul className="wb-badges" aria-label="Environment">
            {config?.catalogMode === "fixture" && <li className="badge badge--amber">Demo data</li>}
            {config?.settlementMode === "simulated" && (
              <li className="badge badge--amber">Simulated settlement</li>
            )}
            {config?.settlementMode === "paypal" && config.environment === "sandbox" && (
              <li className="badge badge--link">PayPal Sandbox</li>
            )}
            {config === undefined && configError && (
              <li className="badge badge--breach">Config unavailable</li>
            )}
            {passkeyRegistered && <li className="badge badge--seal">Passkey registered</li>}
          </ul>

          {/* User Profile / Dedicated Principal Pill Button */}
          {onOpenAuthModal && (
            <button
              type="button"
              className="app-nav-user-pill"
              onClick={onOpenAuthModal}
              title="Authorized Executive Principal — Alex Vance"
              aria-label={`Authorized Principal: ${displayName || "Alex Vance"}`}
            >
              <span className="user-pill-avatar">👔</span>
              <span className="user-pill-name">{displayName || "Alex Vance"}</span>
              <span className="user-pill-dot" />
            </button>
          )}

          {/* Spending Policy Quick Button */}
          {maxPerTxMinor !== undefined && (
            <button
              type="button"
              className="desktop-policy-badge-btn"
              onClick={onOpenPolicyModal}
              title="Configure spending cap"
              aria-label="Configure spending policy and transaction caps"
            >
              <span>🔒</span>
              <span>Cap: {formatMinorUnits(maxPerTxMinor, "USD")} / tx</span>
            </button>
          )}

          <button
            type="button"
            className="desktop-quick-purchase-btn"
            onClick={onOpenPurchaseModal}
          >
            <span>✨</span>
            <span>New Purchase</span>
          </button>

          <ThemeToggle />

          {/* Mobile Grid Menu Button (Reference ⋮⋮ style) */}
          <button
            type="button"
            className="mobile-grid-toggle-btn"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-expanded={isMobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            <span className="grid-icon">⋮⋮</span>
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Sheet */}
      {isMobileMenuOpen && (
        <div className="mobile-dropdown-sheet" role="dialog" aria-modal="true">
          <div className="mobile-dropdown-content">
            <div className="mobile-dropdown-header">
              <span className="mobile-dropdown-title">Navigation &amp; Controls</span>
              <button
                type="button"
                className="mobile-dropdown-close"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mobile-nav-links">
              <button
                type="button"
                className={`mobile-nav-item ${activeSurface === "home" ? "is-active" : ""}`}
                onClick={() => handleSelect("home")}
              >
                <span className="item-icon">🏠</span>
                <div className="item-info">
                  <span className="item-title">Home Dashboard</span>
                  <span className="item-desc">Spending report, limits &amp; real stores</span>
                </div>
              </button>

              <button
                type="button"
                className={`mobile-nav-item ${activeSurface === "agent" ? "is-active" : ""}`}
                onClick={() => handleSelect("agent")}
              >
                <span className="item-icon">✨</span>
                <div className="item-info">
                  <span className="item-title">Shopping Studio</span>
                  <span className="item-desc">AI product sourcing &amp; passkey approval</span>
                </div>
              </button>

              <button
                type="button"
                className={`mobile-nav-item ${activeSurface === "ledger" ? "is-active" : ""}`}
                onClick={() => handleSelect("ledger")}
              >
                <span className="item-icon">📜</span>
                <div className="item-info">
                  <span className="item-title">Activity Ledger</span>
                  <span className="item-desc">Cryptographic timeline &amp; audit bundle</span>
                </div>
              </button>

              {labEnabled && (
                <button
                  type="button"
                  className={`mobile-nav-item ${activeSurface === "lab" ? "is-active" : ""}`}
                  onClick={() => handleSelect("lab")}
                >
                  <span className="item-icon">🛡️</span>
                  <div className="item-info">
                    <span className="item-title">Security Lab</span>
                    <span className="item-desc">Tamper defense &amp; adversarial tests</span>
                  </div>
                </button>
              )}

              <button
                type="button"
                className="mobile-nav-item mobile-nav-item--action"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenPolicyModal();
                }}
              >
                <span className="item-icon">🔒</span>
                <div className="item-info">
                  <span className="item-title">Set Spending Policy</span>
                  <span className="item-desc">Customize transaction cap and monthly limit</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Floating Bottom Navigation Pill (Visible on screens < 900px) */}
      <nav className="mobile-floating-bottom-bar" aria-label="Mobile Bottom Bar">
        <button
          type="button"
          className={`bottom-pill-btn ${activeSurface === "home" ? "is-active" : ""}`}
          onClick={() => handleSelect("home")}
          aria-label="Go to Home"
        >
          <span className="bottom-pill-icon">🏠</span>
          <span className="bottom-pill-label">Home</span>
        </button>

        <button
          type="button"
          className={`bottom-pill-btn ${activeSurface === "agent" ? "is-active" : ""}`}
          onClick={() => handleSelect("agent")}
          aria-label="Go to Shopping Studio"
        >
          <span className="bottom-pill-icon">🤖</span>
          <span className="bottom-pill-label">Studio</span>
        </button>

        {/* Center Radiant Make a Purchase Action */}
        <button
          type="button"
          className="bottom-pill-center-action"
          onClick={onOpenPurchaseModal}
          aria-label="Make a Purchase"
        >
          <span className="center-action-icon">✨</span>
        </button>

        <button
          type="button"
          className={`bottom-pill-btn ${activeSurface === "ledger" ? "is-active" : ""}`}
          onClick={() => handleSelect("ledger")}
          aria-label="Go to Activity Ledger"
        >
          <span className="bottom-pill-icon">📜</span>
          <span className="bottom-pill-label">Activity</span>
        </button>

        {labEnabled && (
          <button
            type="button"
            className={`bottom-pill-btn ${activeSurface === "lab" ? "is-active" : ""}`}
            onClick={() => handleSelect("lab")}
            aria-label="Go to Security Lab"
          >
            <span className="bottom-pill-icon">🛡️</span>
            <span className="bottom-pill-label">Lab</span>
          </button>
        )}
      </nav>
    </header>
  );
}
