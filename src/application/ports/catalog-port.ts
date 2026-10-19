/**
 * Product catalog port.
 *
 * Defines product items and catalog operations for agent discovery and quoting.
 * Real product data (#17) and merchant quote (#16) will implement this same port.
 *
 * ARCHITECTURE.md §14, ADR-0004, INVARIANT I-07.
 */

import type { Currency } from "../../domain/money/currency.js";

export interface ProductItem {
  readonly id: string;
  readonly sku: string;
  readonly title: string;
  readonly description: string;
  readonly merchantId: string;
  readonly merchantDisplayName: string;
  readonly priceMinor: number;
  readonly currency: Currency;
}

export interface SearchProductsOptions {
  readonly limit?: number;
}

export interface ProductCatalog {
  search(query: string, options?: SearchProductsOptions): Promise<readonly ProductItem[]>;
  getDetails(sku: string): Promise<ProductItem | null>;
}
