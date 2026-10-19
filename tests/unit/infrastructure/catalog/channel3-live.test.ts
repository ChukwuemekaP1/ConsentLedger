/**
 * Channel3 Live Smoke Test.
 *
 * Runs live search queries against api.trychannel3.com when CHANNEL3_API_KEY
 * is provided in the environment. Skips automatically when no key is set.
 *
 * Issue #17.
 */

import { describe, it, expect } from "vitest";
import { Channel3Catalog } from "../../../../src/infrastructure/catalog/channel3-catalog.js";

const apiKey = process.env.CHANNEL3_API_KEY;

describe.skipIf(!apiKey)("Channel3 Live Smoke Test", () => {
  it("fetches real products from Channel3 API and normalizes them", async () => {
    if (!apiKey) return;
    const catalog = new Channel3Catalog(apiKey);
    const products = await catalog.search("mechanical keyboard", { limit: 2 });

    expect(products.length).toBeGreaterThan(0);
    const first = products[0];
    expect(first).toBeDefined();
    if (!first) return;

    expect(first.id).toBeTruthy();
    expect(first.title).toBeTruthy();
    expect(first.priceMinor).toBeGreaterThan(0);
    expect(first.currency).toBe("USD");
    expect(first.source).toBe("channel3");
    expect(first.merchantId).toBeTruthy();
    expect(first.merchantDisplayName).toBeTruthy();
    expect(first.buyUrl).toBeDefined();

    // Verify product detail lookup using discovered SKU
    const detail = await catalog.getDetails(first.sku);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.id).toBe(first.id);
    expect(detail.priceMinor).toBe(first.priceMinor);
  });
});
