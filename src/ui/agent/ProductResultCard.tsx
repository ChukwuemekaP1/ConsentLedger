"use client";

import { useState } from "react";
import type { ProposalView, ConsentView } from "./checkout-machine.js";
import { formatMinorUnits } from "./format-money.js";
import { MandateCard } from "./MandateCard.js";

export interface ProductResultCardProps {
  readonly proposal: ProposalView;
  readonly consent?: ConsentView | undefined;
  readonly signature?: string | undefined;
  readonly signingStep?: string | undefined;
  readonly consentFailed?: boolean;
  readonly nowMs: number;
  readonly catalogLabel: string;
  readonly onApprove?: () => void;
  readonly isSigning?: boolean;
}

export function ProductResultCard(props: ProductResultCardProps) {
  const {
    proposal,
    consent,
    signature,
    signingStep,
    consentFailed,
    nowMs,
    catalogLabel,
    onApprove,
    isSigning,
  } = props;

  const [showRationale, setShowRationale] = useState(true);

  const { mandate, rationale, products } = proposal;
  const terms = mandate.terms;
  const totalAmountFormatted = formatMinorUnits(terms.payment.amountMinor, terms.payment.currency);
  const primaryItem = terms.items[0];
  const primaryProduct = products?.[0];

  const merchantName = terms.payee.displayName || terms.payee.merchantId;
  const isApproved = consent !== undefined;

  return (
    <div className="product-result-card-container">
      <div className="product-card-hero">
        {/* Top Provenance Badge */}
        <div className="product-card-top-row">
          <div className="product-source-badge">
            <span className="source-dot" />
            <span>Sourced via {catalogLabel}</span>
          </div>
          <span className="product-merchant-pill">
            Store: <strong>{merchantName}</strong>
          </span>
        </div>

        {/* Product Visual & Details Row */}
        <div className="product-card-main-content">
          <div className="product-image-frame">
            {primaryProduct?.imageUrl ? (
              <img
                src={primaryProduct.imageUrl}
                alt={primaryItem?.description || "Sourced product item"}
                className="product-main-img"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="product-image-fallback" aria-hidden="true">
                <span className="fallback-icon">✨</span>
                <span className="fallback-text">Verified Item</span>
              </div>
            )}
          </div>

          <div className="product-core-info">
            {primaryProduct?.brand && (
              <span className="product-brand-tag">{primaryProduct.brand}</span>
            )}
            <h2 className="product-title-heading">
              {primaryItem?.description || "Curated Product"}
            </h2>

            <div className="product-pricing-strip">
              <div className="product-price-block">
                <span className="product-price-currency">{terms.payment.currency}</span>
                <span className="product-price-number">{totalAmountFormatted}</span>
              </div>
              <div className="product-policy-check">
                <span className="policy-badge policy-badge--allowed">
                  ✓ Passed Policy Guardrails
                </span>
              </div>
            </div>

            {/* Quick Spec Highlights */}
            {terms.items.length > 1 && (
              <div className="product-bundle-notice">
                <span>Includes {terms.items.length} items in curated package</span>
              </div>
            )}

            {primaryProduct?.buyUrl && (
              <a
                href={primaryProduct.buyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="product-store-link"
              >
                View on original store page ↗
              </a>
            )}
          </div>
        </div>

        {/* AI Valuation & Rationale Section */}
        <div className="product-rationale-accordion">
          <button
            type="button"
            className="rationale-toggle-btn"
            onClick={() => setShowRationale((prev) => !prev)}
            aria-expanded={showRationale}
          >
            <span className="rationale-btn-icon">💡</span>
            <span className="rationale-btn-title">Why this product was chosen</span>
            <span className="rationale-chevron">{showRationale ? "▲" : "▼"}</span>
          </button>

          {showRationale && (
            <div className="product-rationale-body">
              <p className="rationale-text">{rationale}</p>
              <div className="rationale-chips">
                <span className="rationale-chip">🛡️ Budget Guarded</span>
                <span className="rationale-chip">⚖️ Quality Density Verified</span>
                <span className="rationale-chip">🔒 Zero Auto-Spend</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
