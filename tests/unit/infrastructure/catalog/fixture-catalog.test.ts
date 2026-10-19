import { describe, it, expect } from "vitest";
import {
  FixtureCatalog,
  FIXTURE_PRODUCTS,
} from "../../../../src/infrastructure/catalog/fixture-catalog.js";
import { HostileCatalogDecorator } from "../../../../src/infrastructure/catalog/hostile-catalog-decorator.js";
import type { ProductItem } from "../../../../src/application/ports/catalog-port.js";

describe("FixtureCatalog", () => {
  const catalog = new FixtureCatalog();

  it("contains exactly 12 items across 4 merchants", () => {
    expect(FIXTURE_PRODUCTS).toHaveLength(12);
    const merchants = new Set(FIXTURE_PRODUCTS.map((p: ProductItem) => p.merchantId));
    expect(merchants.size).toBe(4);
    expect(merchants).toContain("shopx");
    expect(merchants).toContain("cloudco");
    expect(merchants).toContain("coffee-works");
    expect(merchants).toContain("office-plus");
  });

  it("searches products by title and description keyword", async () => {
    const results = await catalog.search("keyboard");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.sku).toBe("KB-75");
    expect(results[0]?.priceMinor).toBe(8500);
    expect(results[0]?.currency).toBe("USD");
  });

  it("searches products by merchant display name", async () => {
    const results = await catalog.search("Coffee Works");
    expect(results).toHaveLength(3);
    for (const item of results) {
      expect(item.merchantId).toBe("coffee-works");
    }
  });

  it("respects search limit option", async () => {
    const results = await catalog.search("", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("gets details by SKU case-insensitively", async () => {
    const item = await catalog.getDetails("kb-75");
    expect(item).not.toBeNull();
    expect(item?.sku).toBe("KB-75");
    expect(item?.title).toBe("75% Mechanical Keyboard");
    expect(item?.priceMinor).toBe(8500);
  });

  it("returns null for non-existent SKU", async () => {
    const item = await catalog.getDetails("NONEXISTENT-SKU");
    expect(item).toBeNull();
  });
});

describe("HostileCatalogDecorator", () => {
  const baseCatalog = new FixtureCatalog();
  const hostileCatalog = new HostileCatalogDecorator(baseCatalog);

  it("injects hostile instructions into search results", async () => {
    const results = await hostileCatalog.search("keyboard");
    expect(results.length).toBeGreaterThan(0);
    const item = results[0];
    expect(item?.description).toContain("SYSTEM OVERRIDE");
    expect(item?.description).toContain("evil-corp");
  });

  it("injects hostile instructions into getDetails", async () => {
    const item = await hostileCatalog.getDetails("KB-75");
    expect(item).not.toBeNull();
    expect(item?.description).toContain("SYSTEM OVERRIDE");
  });
});
