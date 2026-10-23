import { describe, it, expect } from "vitest";
import { detectCategory, getCategoryFields } from "../../../src/ui/agent/detect-category.js";

describe("detectCategory", () => {
  it("detects clothing items correctly", () => {
    expect(detectCategory("running sneakers for gym")).toBe("clothing");
    expect(detectCategory("warm winter jacket in black")).toBe("clothing");
    expect(detectCategory("casual blue jeans")).toBe("clothing");
  });

  it("detects electronics and tech gear correctly", () => {
    expect(detectCategory("Dell desktop workstation")).toBe("electronics");
    expect(detectCategory("mechanical keyboard with brown switches")).toBe("electronics");
    expect(detectCategory("wireless ergonomic mouse")).toBe("electronics");
    expect(detectCategory("Sony noise-cancelling headphones")).toBe("electronics");
  });

  it("detects furniture items correctly", () => {
    expect(detectCategory("high back ergonomic office chair")).toBe("furniture");
    expect(detectCategory("standing desk with dual motors")).toBe("furniture");
    expect(detectCategory("wooden bookshelf")).toBe("furniture");
  });

  it("detects grocery and coffee items correctly", () => {
    expect(detectCategory("Ethiopian whole bean coffee")).toBe("groceries");
    expect(detectCategory("organic green tea leaves")).toBe("groceries");
  });

  it("falls back to general category for unknown items", () => {
    expect(detectCategory("acrylic paint set")).toBe("general");
    expect(detectCategory("notebook with fountain pen")).toBe("general");
  });

  it("returns tailored fields for each category", () => {
    const clothingFields = getCategoryFields("clothing");
    expect(clothingFields.map((f) => f.id)).toContain("size");

    const techFields = getCategoryFields("electronics");
    expect(techFields.map((f) => f.id)).toContain("specs");

    const furnitureFields = getCategoryFields("furniture");
    expect(furnitureFields.map((f) => f.id)).toContain("dimensions");
  });
});
