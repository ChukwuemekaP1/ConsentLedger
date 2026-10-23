"use client";

import { useState, useMemo } from "react";
import { detectCategory, getCategoryFields, type ProductCategory } from "./detect-category.js";
import { formatMinorUnits } from "./format-money.js";
import type { SpendingPolicyConfig } from "../dashboard/SpendingPolicyModal.js";

export interface PurchaseRequestModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onApply: (formattedPrompt: string) => void;
  readonly onSearch?: (searchQuery: string) => void;
  readonly policyConfig: SpendingPolicyConfig;
}

export function PurchaseRequestModal({
  isOpen,
  onClose,
  onApply,
  onSearch,
  policyConfig,
}: PurchaseRequestModalProps) {
  const [query, setQuery] = useState("");
  const [priceUsd, setPriceUsd] = useState("85.00");
  const [quantity, setQuantity] = useState(1);
  const [storePreference, setStorePreference] = useState("");
  const [dynamicValues, setDynamicValues] = useState<Record<string, string>>({});

  // Detect category dynamically as the user types
  const category = useMemo<ProductCategory>(() => detectCategory(query), [query]);
  const fields = useMemo(() => getCategoryFields(category), [category]);

  if (!isOpen) return null;

  const priceMinor = Math.round((parseFloat(priceUsd) || 0) * 100);
  const isWithinCap = priceMinor <= policyConfig.maxPerTxMinor;

  const handleFieldChange = (fieldId: string, val: string) => {
    setDynamicValues((prev) => ({ ...prev, [fieldId]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQuery = query.trim() || "Item";

    // Build natural-language instructions incorporating dynamic specs
    const specDetails: string[] = [];
    for (const field of fields) {
      const val = dynamicValues[field.id]?.trim();
      if (val) {
        specDetails.push(`${field.label}: ${val}`);
      }
    }

    const pricePart = priceUsd ? ` for around $${parseFloat(priceUsd).toFixed(2)}` : "";
    const storePart = storePreference.trim() ? ` from ${storePreference.trim()}` : "";
    const specsPart = specDetails.length > 0 ? ` with ${specDetails.join(", ")}` : "";

    const finalPrompt = `Order ${quantity > 1 ? `${quantity}x ` : ""}${cleanQuery}${specsPart}${pricePart}${storePart}.`;
    onApply(finalPrompt);
    onClose();
  };

  return (
    <div
      className="cl-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cl-modal-sheet">
        {/* Modal Header */}
        <div className="cl-modal-header">
          <div>
            <div className="cl-modal-tag">
              <span className="cl-modal-dot" />
              <span>Autonomous Sourcing</span>
            </div>
            <h2 id="purchase-modal-title" className="cl-modal-title">
              Make a Purchase Request
            </h2>
            <p className="cl-modal-desc">
              Describe what you want. The AI will query real merchant inventories and formulate a
              tailored Cart Mandate.
            </p>
          </div>
          <button
            type="button"
            className="cl-modal-close"
            onClick={onClose}
            aria-label="Close purchase modal"
          >
            ✕
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="cl-modal-form">
          {/* Main Search Input */}
          <div className="cl-field-group">
            <label className="cl-label" htmlFor="purchase-query">
              What should the agent buy? *
            </label>
            <input
              id="purchase-query"
              className="cl-input cl-input--prominent"
              required
              autoFocus
              placeholder="e.g. Mechanical keyboard, running sneakers, Dell desktop, coffee..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.trim().length > 0 && (
              <div className="cl-category-indicator">
                <span className="cl-indicator-label">Detected Category:</span>
                <span className="cl-category-pill">
                  {category === "clothing" && "👟 Apparel & Shoes"}
                  {category === "electronics" && "💻 Tech & Electronics"}
                  {category === "furniture" && "🪑 Furniture & Office"}
                  {category === "groceries" && "☕ Pantry & Coffee"}
                  {category === "general" && "📦 General Product"}
                </span>
              </div>
            )}
          </div>

          {/* Dynamic Adaptive Fields */}
          {query.trim().length > 0 && fields.length > 0 && (
            <div className="cl-adaptive-section">
              <span className="cl-adaptive-title">Tailored Product Parameters:</span>
              <div className="cl-adaptive-grid">
                {fields.map((field) => (
                  <div key={field.id} className="cl-field-group">
                    <label className="cl-label-sm" htmlFor={`field-${field.id}`}>
                      {field.label}
                    </label>
                    <input
                      id={`field-${field.id}`}
                      className="cl-input cl-input--sm"
                      placeholder={field.placeholder}
                      value={dynamicValues[field.id] || ""}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Budget & Quantity Row */}
          <div className="cl-pricing-row">
            <div className="cl-field-group" style={{ flex: 1.5 }}>
              <label className="cl-label" htmlFor="purchase-price">
                Target Budget ($ USD) *
              </label>
              <input
                id="purchase-price"
                type="number"
                step="0.01"
                min="0.50"
                required
                className="cl-input"
                value={priceUsd}
                onChange={(e) => setPriceUsd(e.target.value)}
              />
              <div className="cl-cap-feedback">
                {isWithinCap ? (
                  <span className="cl-cap-pill cl-cap-pill--valid">
                    ✓ Within your {formatMinorUnits(policyConfig.maxPerTxMinor, "USD")} purchase cap
                  </span>
                ) : (
                  <span className="cl-cap-pill cl-cap-pill--exceeds">
                    ⚠️ Exceeds your {formatMinorUnits(policyConfig.maxPerTxMinor, "USD")} cap (will
                    be denied by policy)
                  </span>
                )}
              </div>
            </div>

            <div className="cl-field-group" style={{ flex: 0.8 }}>
              <label className="cl-label" htmlFor="purchase-qty">
                Quantity
              </label>
              <input
                id="purchase-qty"
                type="number"
                min="1"
                max="50"
                required
                className="cl-input"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              />
            </div>
          </div>

          {/* Store Preference */}
          <div className="cl-field-group">
            <label className="cl-label" htmlFor="purchase-store">
              Store Preference (Optional)
            </label>
            <input
              id="purchase-store"
              className="cl-input"
              placeholder="e.g. Any reputable merchant, ShopX, Amazon, BestBuy..."
              value={storePreference}
              onChange={(e) => setStorePreference(e.target.value)}
            />
          </div>

          {/* Action Row */}
          <div className="cl-modal-actions" style={{ flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="cl-btn cl-btn--secondary" onClick={onClose}>
              Cancel
            </button>
            {onSearch && (
              <button
                type="button"
                className="cl-btn cl-btn--secondary"
                onClick={() => {
                  const cleanQuery = query.trim() || "Item";
                  const specDetails: string[] = [];
                  for (const field of fields) {
                    const val = dynamicValues[field.id]?.trim();
                    if (val) specDetails.push(val);
                  }
                  const searchStr = `${cleanQuery} ${specDetails.join(" ")}`.trim();
                  onSearch(searchStr);
                  onClose();
                }}
              >
                🔍 Search Store Catalog
              </button>
            )}
            <button type="submit" className="cl-btn cl-btn--primary">
              🚀 Fast Dual-Custody Order
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
