/**
 * Channel3 product catalog adapter.
 *
 * Implements ProductCatalog port using Channel3 REST API (v1).
 * Sanitizes untrusted merchant text (TB6) and converts prices to integer minor units.
 *
 * ARCHITECTURE.md §14, Issue #17, INVARIANTS I-07, I-11.
 */

import { z } from "zod";
import type {
  ProductCatalog,
  ProductItem,
  SearchProductsOptions,
} from "../../application/ports/catalog-port.js";
import type { Currency } from "../../domain/money/currency.js";

// ─── Channel3 Wire Schemas ──────────────────────────────────────────────────

const Channel3PriceSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string(),
});

const Channel3OfferSchema = z.object({
  url: z.string(),
  domain: z.string(),
  price: Channel3PriceSchema,
  availability: z.string().optional(),
});

const Channel3ImageSchema = z.object({
  url: z.string(),
  is_main_image: z.boolean().optional(),
});

const Channel3BrandSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
});

const Channel3ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  brands: z.array(Channel3BrandSchema).optional().default([]),
  images: z.array(Channel3ImageSchema).optional().default([]),
  offers: z.array(Channel3OfferSchema).optional().default([]),
});

const Channel3SearchResponseSchema = z.object({
  products: z.array(Channel3ProductSchema),
  next_page_token: z.string().nullable().optional(),
});

// ─── Input Sanitization (TB6) ────────────────────────────────────────────────

// Strip ASCII control characters except newline and tab
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeText(raw: string, maxLength: number): string {
  const clean = raw.replace(CONTROL_CHAR_REGEX, "").trim();
  return clean.length > maxLength ? clean.slice(0, maxLength) : clean;
}

function sanitizeDomainAsMerchantId(domain: string): { merchantId: string; displayName: string } {
  const cleanDomain = domain.toLowerCase().replace(/^www\./, "");
  const merchantId = cleanDomain.replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "merchant";
  return {
    merchantId,
    displayName: cleanDomain,
  };
}

// ─── Channel3Catalog Adapter ─────────────────────────────────────────────────

export interface Channel3CatalogOptions {
  readonly baseUrl?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
  readonly fallbackCatalog?: ProductCatalog | undefined;
  readonly timeoutMs?: number | undefined;
}

export class Channel3Catalog implements ProductCatalog {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly fallbackCatalog?: ProductCatalog | undefined;
  private readonly timeoutMs: number;

  constructor(apiKey: string, options?: Channel3CatalogOptions) {
    this.apiKey = apiKey.trim();
    this.baseUrl = options?.baseUrl ?? "https://api.trychannel3.com";
    this.fetchFn = options?.fetchFn ?? fetch;
    this.fallbackCatalog = options?.fallbackCatalog;
    this.timeoutMs = options?.timeoutMs ?? 10_000;
  }

  async search(query: string, options?: SearchProductsOptions): Promise<readonly ProductItem[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return [];
    }

    const limit = Math.min(Math.max(options?.limit ?? 10, 1), 30);
    const url = `${this.baseUrl}/v1/search`;

    try {
      const response = await this.executeFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify({
          query: cleanQuery,
          limit,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 402) {
          if (this.fallbackCatalog) {
            return this.fallbackCatalog.search(query, options);
          }
          throw new Error(`Channel3 API authentication or billing error: HTTP ${response.status}`);
        }
        if (response.status === 429) {
          if (this.fallbackCatalog) {
            return this.fallbackCatalog.search(query, options);
          }
          throw new Error("Channel3 API rate limit exceeded (HTTP 429)");
        }
        if (response.status >= 500 && this.fallbackCatalog) {
          return this.fallbackCatalog.search(query, options);
        }
        throw new Error(`Channel3 API search failed with HTTP ${response.status}`);
      }

      const json = await response.json();
      const parsed = Channel3SearchResponseSchema.safeParse(json);
      if (!parsed.success) {
        if (this.fallbackCatalog) {
          return this.fallbackCatalog.search(query, options);
        }
        throw new Error(`Malformed Channel3 search response: ${parsed.error.message}`);
      }

      return this.normalizeProducts(parsed.data.products);
    } catch (err) {
      if (this.fallbackCatalog) {
        return this.fallbackCatalog.search(query, options);
      }
      throw err;
    }
  }

  async getDetails(sku: string): Promise<ProductItem | null> {
    const cleanSku = sku.trim();
    if (!cleanSku) {
      return null;
    }

    const url = `${this.baseUrl}/v1/products/${encodeURIComponent(cleanSku)}`;

    try {
      const response = await this.executeFetch(url, {
        method: "GET",
        headers: {
          "x-api-key": this.apiKey,
        },
      });

      if (response.status === 404) {
        return this.fallbackCatalog ? this.fallbackCatalog.getDetails(sku) : null;
      }

      if (!response.ok) {
        if (this.fallbackCatalog) {
          return this.fallbackCatalog.getDetails(sku);
        }
        throw new Error(`Channel3 API product detail failed with HTTP ${response.status}`);
      }

      const json = await response.json();
      const parsed = Channel3ProductSchema.safeParse(json);
      if (!parsed.success) {
        if (this.fallbackCatalog) {
          return this.fallbackCatalog.getDetails(sku);
        }
        return null;
      }

      const normalized = this.normalizeProduct(parsed.data);
      return normalized;
    } catch (err) {
      if (this.fallbackCatalog) {
        return this.fallbackCatalog.getDetails(sku);
      }
      throw err;
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async executeFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private normalizeProducts(
    products: readonly z.infer<typeof Channel3ProductSchema>[],
  ): readonly ProductItem[] {
    const results: ProductItem[] = [];
    for (const prod of products) {
      const item = this.normalizeProduct(prod);
      if (item) {
        results.push(item);
      }
    }
    return results;
  }

  private normalizeProduct(prod: z.infer<typeof Channel3ProductSchema>): ProductItem | null {
    // A usable product must have at least one offer with a valid price
    const primaryOffer = prod.offers[0];
    if (!primaryOffer) {
      return null;
    }

    const rawCurrency = primaryOffer.price.currency.toUpperCase();
    if (
      rawCurrency !== "USD" &&
      rawCurrency !== "EUR" &&
      rawCurrency !== "GBP" &&
      rawCurrency !== "JPY"
    ) {
      return null;
    }

    const currency: Currency = rawCurrency;
    const priceMinor = Math.round(primaryOffer.price.price * 100);
    const { merchantId, displayName } = sanitizeDomainAsMerchantId(primaryOffer.domain);

    const title = sanitizeText(prod.title, 200);
    const description = prod.description ? sanitizeText(prod.description, 1000) : title;

    const mainImage = prod.images.find((img) => img.is_main_image) ?? prod.images[0];
    const brand = prod.brands[0]?.name ? sanitizeText(prod.brands[0].name, 64) : undefined;

    return {
      id: prod.id,
      sku: prod.id,
      title,
      description,
      merchantId,
      merchantDisplayName: displayName,
      priceMinor,
      currency,
      ...(mainImage?.url ? { imageUrl: mainImage.url } : {}),
      ...(primaryOffer.url ? { buyUrl: primaryOffer.url } : {}),
      ...(brand ? { brand } : {}),
      source: "channel3",
    };
  }
}
