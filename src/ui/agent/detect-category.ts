/**
 * Pure category detection based on natural-language shopping requests.
 * Runs instantly in the browser without consuming Gemini API tokens or triggering rate limits.
 */

export type ProductCategory = "clothing" | "electronics" | "furniture" | "groceries" | "general";

export interface CategorySpecField {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly type?: "text" | "select";
  readonly options?: readonly string[];
}

const CLOTHING_KEYWORDS = [
  "shirt",
  "t-shirt",
  "hoodie",
  "jacket",
  "coat",
  "pants",
  "jeans",
  "trousers",
  "shorts",
  "dress",
  "skirt",
  "shoes",
  "sneakers",
  "boots",
  "loafers",
  "sandals",
  "hat",
  "cap",
  "gloves",
  "scarf",
  "socks",
  "suit",
  "blazer",
  "sweater",
  "cardigan",
];

const ELECTRONICS_KEYWORDS = [
  "laptop",
  "desktop",
  "pc",
  "macbook",
  "computer",
  "monitor",
  "screen",
  "display",
  "phone",
  "iphone",
  "android",
  "smartphone",
  "keyboard",
  "mouse",
  "headphones",
  "earbuds",
  "headset",
  "camera",
  "mic",
  "microphone",
  "tablet",
  "ipad",
  "gpu",
  "cpu",
  "ssd",
  "ram",
  "charger",
  "cable",
  "dock",
  "hub",
];

const FURNITURE_KEYWORDS = [
  "chair",
  "desk",
  "table",
  "sofa",
  "couch",
  "bed",
  "mattress",
  "lamp",
  "bookshelf",
  "shelf",
  "cabinet",
  "drawer",
  "stand",
  "stool",
  "cushion",
  "armchair",
];

const GROCERY_KEYWORDS = [
  "coffee",
  "beans",
  "tea",
  "snack",
  "protein",
  "cereal",
  "beverage",
  "drink",
  "water",
  "chocolate",
  "oil",
  "spices",
  "food",
];

export function detectCategory(query: string): ProductCategory {
  const normalized = query.toLowerCase();
  const words = normalized.split(/[\s,.-]+/);

  for (const word of words) {
    if (CLOTHING_KEYWORDS.includes(word)) return "clothing";
    if (ELECTRONICS_KEYWORDS.includes(word)) return "electronics";
    if (FURNITURE_KEYWORDS.includes(word)) return "furniture";
    if (GROCERY_KEYWORDS.includes(word)) return "groceries";
  }

  // Substring check for compound terms like "macbook" or "sneakers"
  for (const kw of CLOTHING_KEYWORDS) {
    if (normalized.includes(kw)) return "clothing";
  }
  for (const kw of ELECTRONICS_KEYWORDS) {
    if (normalized.includes(kw)) return "electronics";
  }
  for (const kw of FURNITURE_KEYWORDS) {
    if (normalized.includes(kw)) return "furniture";
  }
  for (const kw of GROCERY_KEYWORDS) {
    if (normalized.includes(kw)) return "groceries";
  }

  return "general";
}

export function getCategoryFields(category: ProductCategory): readonly CategorySpecField[] {
  switch (category) {
    case "clothing":
      return [
        { id: "size", label: "Size", placeholder: "e.g. M, L, XL, US 10.5, 32x32" },
        { id: "color", label: "Color / Pattern", placeholder: "e.g. Black, Navy, Olive" },
        {
          id: "fit",
          label: "Fit / Gender",
          placeholder: "e.g. Men's Slim Fit, Women's Relaxed, Unisex",
        },
      ];
    case "electronics":
      return [
        { id: "brand", label: "Preferred Brand", placeholder: "e.g. Dell, Apple, Logitech, Sony" },
        {
          id: "specs",
          label: "Hardware Specs",
          placeholder: "e.g. 32GB RAM, 1TB SSD, ANC, 4K 144Hz",
        },
        {
          id: "model",
          label: "Model / Series",
          placeholder: "e.g. XPS 15, MX Master 3S, WH-1000XM5",
        },
      ];
    case "furniture":
      return [
        {
          id: "dimensions",
          label: "Dimensions / Space",
          placeholder: "e.g. 60x30 inch, High-back",
        },
        {
          id: "material",
          label: "Material / Finish",
          placeholder: "e.g. Solid Walnut, Breathable Mesh",
        },
        { id: "color", label: "Color", placeholder: "e.g. Matte Black, Oak, Grey" },
      ];
    case "groceries":
      return [
        {
          id: "quantityOrWeight",
          label: "Pack Size / Weight",
          placeholder: "e.g. 2 lb bag, 12-pack, 500g",
        },
        {
          id: "dietary",
          label: "Roast / Dietary",
          placeholder: "e.g. Whole Bean Dark Roast, Organic, Sugar-Free",
        },
      ];
    case "general":
      return [
        {
          id: "brand",
          label: "Preferred Brand",
          placeholder: "e.g. Universal, Any Reputable Brand",
        },
        {
          id: "specs",
          label: "Key Parameters",
          placeholder: "e.g. Heavy-duty, Wireless, Waterproof",
        },
      ];
  }
}
