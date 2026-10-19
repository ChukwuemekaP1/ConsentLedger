/**
 * Fixture product catalog.
 *
 * Provides a deterministic in-memory catalog of ~12 items across 4 merchants.
 * Used for offline execution, integration tests, and simulated agent loops.
 *
 * ARCHITECTURE.md §14, Issue #5.
 */

import type {
  ProductCatalog,
  ProductItem,
  SearchProductsOptions,
} from "../../application/ports/catalog-port.js";

export const FIXTURE_PRODUCTS: readonly ProductItem[] = [
  // Merchant: ShopX
  {
    id: "prod-kb-75",
    sku: "KB-75",
    title: "75% Mechanical Keyboard",
    description: "Compact mechanical keyboard with hot-swappable switches and aluminum frame.",
    merchantId: "shopx",
    merchantDisplayName: "ShopX",
    priceMinor: 8500, // $85.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-kc-pbt",
    sku: "KC-PBT",
    title: "PBT Keycap Set",
    description: "Durable double-shot PBT keycaps in cherry profile with subtle legends.",
    merchantId: "shopx",
    merchantDisplayName: "ShopX",
    priceMinor: 2500, // $25.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-wr-oak",
    sku: "WR-OAK",
    title: "Solid Oak Wrist Rest",
    description: "Ergonomic natural oak wooden wrist rest tailored for 75% keyboards.",
    merchantId: "shopx",
    merchantDisplayName: "ShopX",
    priceMinor: 2000, // $20.00
    currency: "USD",
    source: "fixture",
  },

  // Merchant: CloudCo
  {
    id: "prod-cc-100",
    sku: "CC-100",
    title: "Cloud Compute Credits $100",
    description: "Prepaid compute credits for virtual machine instances and GPU workloads.",
    merchantId: "cloudco",
    merchantDisplayName: "CloudCo",
    priceMinor: 10000, // $100.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-cc-50",
    sku: "CC-50",
    title: "Cloud Compute Credits $50",
    description: "Prepaid compute credits for container hosting and serverless functions.",
    merchantId: "cloudco",
    merchantDisplayName: "CloudCo",
    priceMinor: 5000, // $50.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-cc-20",
    sku: "CC-20",
    title: "Cloud Storage Credits $20",
    description: "Prepaid object storage credits with global replication.",
    merchantId: "cloudco",
    merchantDisplayName: "CloudCo",
    priceMinor: 2000, // $20.00
    currency: "USD",
    source: "fixture",
  },

  // Merchant: Coffee Works
  {
    id: "prod-cf-eth",
    sku: "CF-ETH",
    title: "Ethiopian Yirgacheffe Beans (1kg)",
    description: "Whole bean medium roast coffee with floral jasmine and citrus notes.",
    merchantId: "coffee-works",
    merchantDisplayName: "Coffee Works",
    priceMinor: 2400, // $24.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-cf-col",
    sku: "CF-COL",
    title: "Colombian Supremo Beans (1kg)",
    description: "Whole bean dark roast coffee with rich chocolate and nutty caramel notes.",
    merchantId: "coffee-works",
    merchantDisplayName: "Coffee Works",
    priceMinor: 2200, // $22.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-cf-mug",
    sku: "CF-MUG",
    title: "Ceramic Pour-Over Mug",
    description: "Handcrafted ceramic mug with double-wall heat retention and matte glaze.",
    merchantId: "coffee-works",
    merchantDisplayName: "Coffee Works",
    priceMinor: 1500, // $15.00
    currency: "USD",
    source: "fixture",
  },

  // Merchant: Office Plus
  {
    id: "prod-op-desk-mat",
    sku: "OP-DESK-MAT",
    title: "Large Felt Desk Mat",
    description: "Premium wool felt desk pad providing smooth mouse glide and desk protection.",
    merchantId: "office-plus",
    merchantDisplayName: "Office Plus",
    priceMinor: 3000, // $30.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-op-mon-arm",
    sku: "OP-MON-ARM",
    title: "Single Gas-Spring Monitor Arm",
    description: "Adjustable desk-mount monitor arm supporting up to 32-inch displays.",
    merchantId: "office-plus",
    merchantDisplayName: "Office Plus",
    priceMinor: 6500, // $65.00
    currency: "USD",
    source: "fixture",
  },
  {
    id: "prod-op-cable-org",
    sku: "OP-CABLE-ORG",
    title: "Under-Desk Cable Routing Channel",
    description: "Steel cable management tray with easy wire pass-through slots.",
    merchantId: "office-plus",
    merchantDisplayName: "Office Plus",
    priceMinor: 1800, // $18.00
    currency: "USD",
    source: "fixture",
  },
];

export class FixtureCatalog implements ProductCatalog {
  constructor(private readonly items: readonly ProductItem[] = FIXTURE_PRODUCTS) {}

  async search(query: string, options?: SearchProductsOptions): Promise<readonly ProductItem[]> {
    const q = query.trim().toLowerCase();
    const limit = options?.limit ?? 10;

    if (!q) {
      return this.items.slice(0, limit);
    }

    const matched = this.items.filter((item) => {
      return (
        item.sku.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.merchantDisplayName.toLowerCase().includes(q)
      );
    });

    return matched.slice(0, limit);
  }

  async getDetails(sku: string): Promise<ProductItem | null> {
    const target = sku.trim().toLowerCase();
    const found = this.items.find((item) => item.sku.toLowerCase() === target);
    return found ? { ...found } : null;
  }
}
