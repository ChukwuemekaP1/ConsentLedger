/**
 * Channel3Catalog Unit Tests.
 *
 * Verifies normalization of Channel3 product responses, price minor-unit conversion,
 * TB6 untrusted text sanitization (stripping control chars, length capping),
 * error handling (401, 429, 500), and fallback catalog behavior.
 *
 * Issue #17, ARCHITECTURE.md §14, INVARIANTS I-07, I-11.
 */

import { describe, it, expect } from "vitest";
import { Channel3Catalog } from "../../../../src/infrastructure/catalog/channel3-catalog.js";
import { FixtureCatalog } from "../../../../src/infrastructure/catalog/fixture-catalog.js";

const MOCK_CHANNEL3_SEARCH_RESPONSE = {
  products: [
    {
      id: "prod-kb-1",
      title: "Keychron K2 Wireless Mechanical Keyboard \x00\x08",
      description:
        "A 75% layout wireless keyboard with Gateron switches.\x1B[31m Featuring RGB lighting.",
      brands: [{ id: "brand-1", name: "Keychron" }],
      images: [
        {
          url: "https://cdn.trychannel3.com/images/keychron-k2.jpg",
          is_main_image: true,
        },
      ],
      offers: [
        {
          url: "https://buy.trychannel3.com/keychron-k2?ref=cl",
          domain: "keychron.com",
          price: {
            price: 79.99,
            currency: "USD",
          },
          availability: "InStock",
        },
      ],
    },
    {
      id: "prod-invalid-currency",
      title: "Product with Unknown Currency",
      description: "Testing unknown currency exclusion",
      offers: [
        {
          url: "https://example.com/p",
          domain: "example.com",
          price: {
            price: 100,
            currency: "XYZ", // unsupported currency
          },
        },
      ],
    },
    {
      id: "prod-no-offers",
      title: "Product with No Offers",
      description: "Testing product without offers",
      offers: [],
    },
  ],
  next_page_token: null,
};

describe("Channel3Catalog", () => {
  const dummyApiKey = "ch3_test_key_12345";

  it("normalizes valid Channel3 products into domain ProductItem with integer minor units", async () => {
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      expect(url).toContain("/v1/search");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        "x-api-key": dummyApiKey,
      });

      const body = JSON.parse(String(init?.body));
      expect(body.query).toBe("mechanical keyboard");
      expect(body.limit).toBe(5);

      return new Response(JSON.stringify(MOCK_CHANNEL3_SEARCH_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const catalog = new Channel3Catalog(dummyApiKey, { fetchFn: fakeFetch });
    const results = await catalog.search("mechanical keyboard", { limit: 5 });

    expect(results).toHaveLength(1);
    const item = results[0];
    expect(item).toBeDefined();
    expect(item!.id).toBe("prod-kb-1");
    expect(item!.sku).toBe("prod-kb-1");
    // Control chars stripped (\x00, \x08)
    expect(item!.title).toBe("Keychron K2 Wireless Mechanical Keyboard");
    expect(item!.merchantId).toBe("keychron_com");
    expect(item!.merchantDisplayName).toBe("keychron.com");
    // $79.99 -> 7999 minor units
    expect(item!.priceMinor).toBe(7999);
    expect(item!.currency).toBe("USD");
    expect(item!.imageUrl).toBe("https://cdn.trychannel3.com/images/keychron-k2.jpg");
    expect(item!.buyUrl).toBe("https://buy.trychannel3.com/keychron-k2?ref=cl");
    expect(item!.brand).toBe("Keychron");
    expect(item!.source).toBe("channel3");
  });

  it("sanitizes long text and strips dangerous ASCII control characters (TB6)", async () => {
    const longTitle = "A".repeat(300);
    const longDesc = "B".repeat(2000);

    const payload = {
      products: [
        {
          id: "long-item",
          title: `Title with \x00 null and \x07 bell ${longTitle}`,
          description: `Desc with \x1F control ${longDesc}`,
          offers: [
            {
              url: "https://example.com/item",
              domain: "shop.example.com",
              price: { price: 25.5, currency: "USD" },
            },
          ],
        },
      ],
    };

    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify(payload), { status: 200 });

    const catalog = new Channel3Catalog(dummyApiKey, { fetchFn: fakeFetch });
    const results = await catalog.search("test");

    expect(results).toHaveLength(1);
    const item = results[0]!;
    // Title capped at 200 chars
    expect(item.title.length).toBeLessThanOrEqual(200);
    expect(item.title).not.toContain("\x00");
    expect(item.title).not.toContain("\x07");
    // Description capped at 1000 chars
    expect(item.description.length).toBeLessThanOrEqual(1000);
    expect(item.description).not.toContain("\x1F");
  });

  it("returns empty array for empty or whitespace query without network call", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response("{}", { status: 200 });
    };

    const catalog = new Channel3Catalog(dummyApiKey, { fetchFn: fakeFetch });
    const results = await catalog.search("   ");

    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("falls back to fallbackCatalog on 429 rate limit when configured", async () => {
    const fallback = new FixtureCatalog();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ detail: "Too Many Requests" }), { status: 429 });

    const catalog = new Channel3Catalog(dummyApiKey, {
      fetchFn: fakeFetch,
      fallbackCatalog: fallback,
    });

    const results = await catalog.search("keyboard");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source).toBe("fixture");
  });

  it("throws clear error on 429 when no fallback is configured", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ detail: "Rate limit exceeded" }), { status: 429 });

    const catalog = new Channel3Catalog(dummyApiKey, { fetchFn: fakeFetch });

    await expect(catalog.search("keyboard")).rejects.toThrow(
      "Channel3 API rate limit exceeded (HTTP 429)",
    );
  });

  it("falls back to fallbackCatalog on 5xx server errors", async () => {
    const fallback = new FixtureCatalog();
    const fakeFetch: typeof fetch = async () =>
      new Response("Internal Server Error", { status: 500 });

    const catalog = new Channel3Catalog(dummyApiKey, {
      fetchFn: fakeFetch,
      fallbackCatalog: fallback,
    });

    const results = await catalog.search("keyboard");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.source).toBe("fixture");
  });

  it("fetches product details by ID and normalizes response", async () => {
    const singleProduct = MOCK_CHANNEL3_SEARCH_RESPONSE.products[0]!;
    const fakeFetch: typeof fetch = async (input) => {
      expect(String(input)).toContain("/v1/products/prod-kb-1");
      return new Response(JSON.stringify(singleProduct), { status: 200 });
    };

    const catalog = new Channel3Catalog(dummyApiKey, { fetchFn: fakeFetch });
    const product = await catalog.getDetails("prod-kb-1");

    expect(product).not.toBeNull();
    expect(product!.id).toBe("prod-kb-1");
    expect(product!.priceMinor).toBe(7999);
  });

  it("returns null for non-existent product on 404", async () => {
    const fakeFetch: typeof fetch = async () => new Response("Not Found", { status: 404 });

    const catalog = new Channel3Catalog(dummyApiKey, { fetchFn: fakeFetch });
    const product = await catalog.getDetails("non-existent-sku");

    expect(product).toBeNull();
  });
});
