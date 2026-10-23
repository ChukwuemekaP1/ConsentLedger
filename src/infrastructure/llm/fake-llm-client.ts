/**
 * Deterministic Fake LLM Client.
 *
 * Provides repeatable, offline proposals for CI, local development, and tests.
 * Never makes external network requests (ARCHITECTURE.md §14, Issue #5).
 */

import { ok, err, type Result } from "../../domain/shared/result.js";
import type {
  LlmClient,
  LlmError,
  PurchaseProposal,
  GenerateProposalOptions,
} from "../../application/ports/propose-port.js";
import type { ProductCatalog } from "../../application/ports/catalog-port.js";

export interface FakeLlmClientConfig {
  readonly cannedProposal?: PurchaseProposal;
  readonly cannedError?: LlmError;
  readonly simulateToolCalls?: boolean;
}

function extractPriceMinor(prompt: string, fallbackMinor = 8500): number {
  const dollarMatch = prompt.match(/\$(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch && dollarMatch[1]) {
    const parsed = parseFloat(dollarMatch[1]);
    if (!isNaN(parsed) && parsed > 0) return Math.round(parsed * 100);
  }
  const forMatch = prompt.match(/(?:for|at|price|cost)\s+(\d+(?:\.\d{1,2})?)/i);
  if (forMatch && forMatch[1]) {
    const parsed = parseFloat(forMatch[1]);
    if (!isNaN(parsed) && parsed > 0) return Math.round(parsed * 100);
  }
  return fallbackMinor;
}

export class FakeLlmClient implements LlmClient {
  constructor(private readonly config: FakeLlmClientConfig = {}) {}

  async generateProposal(
    prompt: string,
    catalog: ProductCatalog,
    _options?: GenerateProposalOptions,
  ): Promise<Result<PurchaseProposal, LlmError>> {
    if (this.config.cannedError) {
      return err(this.config.cannedError);
    }

    if (this.config.cannedProposal) {
      return ok(this.config.cannedProposal);
    }

    const lower = prompt.toLowerCase();

    // Check for structured spec metadata from the Product Specification Modal
    const specMatch = prompt.match(
      /\[SPEC:\s*brand="([^"]*)"\s*item="([^"]*)"\s*specs="([^"]*)"\s*price="([^"]*)"\s*merchant="([^"]*)"\]/,
    );
    if (specMatch) {
      const brand = specMatch[1] || "Universal";
      const itemTitle = specMatch[2] || "Custom Product";
      const itemSpecs = specMatch[3] || "";
      const priceRaw = parseFloat(specMatch[4] || "85.00");
      const merchantName = specMatch[5] || "ShopX";
      const amountMinor = Math.round((isNaN(priceRaw) || priceRaw <= 0 ? 85 : priceRaw) * 100);
      const merchantId =
        merchantName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/^-+|-+$/g, "") || "shopx";
      const sku = (itemTitle.slice(0, 3) + "-" + Math.abs(amountMinor % 999)).toUpperCase();
      const fullDesc = `${brand !== "Universal" && !itemTitle.includes(brand) ? brand + " " : ""}${itemTitle}${itemSpecs ? " (" + itemSpecs + ")" : ""}`;

      return ok({
        payee: {
          merchantId,
          displayName: merchantName,
        },
        payment: {
          amountMinor,
          currency: "USD",
        },
        items: [
          {
            sku,
            description: fullDesc,
            quantity: 1,
            unitAmountMinor: amountMinor,
          },
        ],
        promptPlayback: `Order ${fullDesc} for $${(amountMinor / 100).toFixed(2)} from ${merchantName}`,
        rationale: `Selected ${fullDesc} ($${(amountMinor / 100).toFixed(2)}) from verified merchant ${merchantName} based on exact sourcing parameters. Evaluated against active catalog inventory for verified merchant rating, high reliability, and policy alignment.`,
      });
    }

    // Support simulated tool calls against the catalog if enabled
    if (this.config.simulateToolCalls) {
      await catalog.search(prompt);
    }

    // Over-cap request simulation (expensive / luxury / headphones)
    if (
      lower.includes("expensive") ||
      lower.includes("over-cap") ||
      lower.includes("overcap") ||
      lower.includes("headphones") ||
      lower.includes("399")
    ) {
      if (lower.includes("headphones") || lower.includes("399") || lower.includes("studio")) {
        return ok({
          payee: {
            merchantId: "shopx",
            displayName: "ShopX",
          },
          payment: {
            amountMinor: 39900, // $399.00
            currency: "USD",
          },
          items: [
            {
              sku: "HP-STUDIO-PRO",
              description: "Studio Noise-Cancelling Headphones",
              quantity: 1,
              unitAmountMinor: 39900,
            },
          ],
          promptPlayback: `Buy premium studio noise-cancelling headphones for $399.00: ${prompt}`,
          rationale:
            "Selected Studio Noise-Cancelling Headphones ($399.00) from verified merchant ShopX. Features custom 45mm planar magnetic drivers with neutral frequency response, active hybrid noise cancellation, memory-foam velour earpads, and 40-hour battery life. Compared against consumer bluetooth headsets ($150–$200) that distort bass and lack acoustic clarity, and multi-thousand dollar audiophile monitors, this unit offers reference-grade mastering fidelity. Note: At $399.00, this purchase requires policy verification against your active spending cap to ensure dual-custody compliance.",
        });
      }

      return ok({
        payee: {
          merchantId: "shopx",
          displayName: "ShopX",
        },
        payment: {
          amountMinor: 250000, // $2500.00
          currency: "USD",
        },
        items: [
          {
            sku: "EXP-LUX",
            description: "Custom Titanium Keyboard Assembly",
            quantity: 1,
            unitAmountMinor: 250000,
          },
        ],
        promptPlayback: `Buy luxury keyboard for $2,500.00: ${prompt}`,
        rationale:
          "Selected Custom Titanium Keyboard Assembly ($2,500.00). Built with a CNC-milled grade 5 titanium chassis, mirror-polished PVD brass weight, and hand-tuned vintage tactile switches. Compared to standard aluminum or polycarbonate models ($100–$250), this represents ultra-luxury artisan craftsmanship with diminishing returns. This request is flagged because it intentionally exceeds configured enterprise spending caps.",
      });
    }

    // Monitor arm simulation
    if (lower.includes("monitor") || lower.includes("arm")) {
      return ok({
        payee: {
          merchantId: "office-plus",
          displayName: "Office Plus",
        },
        payment: {
          amountMinor: 6500, // $65.00
          currency: "USD",
        },
        items: [
          {
            sku: "MON-ARM-1",
            description: "Gas-Spring Ergonomic Monitor Arm",
            quantity: 1,
            unitAmountMinor: 6500,
          },
        ],
        promptPlayback: `Order gas-spring monitor arm for $65.00: ${prompt}`,
        rationale:
          "Selected Gas-Spring Ergonomic Monitor Arm ($65.00) from Office Plus. Features heavy-duty aerospace-grade aluminum construction, internal counterbalance gas-spring supporting displays up to 32 inches and 9kg, full 360-degree rotation, and integrated cable routing channels. Compared against rigid pole-clamps ($35–$45) that cannot adjust smoothly and cheap plastic mounts that droop over time, this arm delivers fluid one-touch ergonomic positioning with a 5-year commercial warranty. At $65.00, it stays well within your transaction cap, providing durable posture health at proven value.",
      });
    }

    // Disallowed merchant simulation
    if (lower.includes("unauthorized") || lower.includes("rogue") || lower.includes("evil")) {
      return ok({
        payee: {
          merchantId: "rogue-merchant",
          displayName: "Rogue Merchant",
        },
        payment: {
          amountMinor: 5000,
          currency: "USD",
        },
        items: [
          {
            sku: "ROGUE-01",
            description: "Unverified merchandise",
            quantity: 1,
            unitAmountMinor: 5000,
          },
        ],
        promptPlayback: `Order from rogue merchant: ${prompt}`,
        rationale: "Selected requested rogue vendor item",
      });
    }

    // Disallowed currency simulation
    if (lower.includes("yen") || lower.includes("jpy")) {
      return ok({
        payee: {
          merchantId: "shopx",
          displayName: "ShopX",
        },
        payment: {
          amountMinor: 8500,
          currency: "JPY",
        },
        items: [
          {
            sku: "KB-75",
            description: "75% Mechanical Keyboard",
            quantity: 1,
            unitAmountMinor: 8500,
          },
        ],
        promptPlayback: `Order 75% keyboard in JPY: ${prompt}`,
        rationale: "Customer requested Japanese Yen billing",
      });
    }

    // Coffee prompt
    if (lower.includes("coffee") || lower.includes("beans")) {
      return ok({
        payee: {
          merchantId: "coffee-works",
          displayName: "Coffee Works",
        },
        payment: {
          amountMinor: 2400, // $24.00
          currency: "USD",
        },
        items: [
          {
            sku: "CF-ETH",
            description: "Ethiopian Yirgacheffe Beans (1kg)",
            quantity: 1,
            unitAmountMinor: 2400,
          },
        ],
        promptPlayback: `Order Ethiopian coffee beans: ${prompt}`,
        rationale:
          "Selected Ethiopian Yirgacheffe Single-Origin Whole Beans (1kg, $24.00) from Coffee Works. Grade 1 washed heirloom beans cultivated at 2,000m altitude, roasted within 7 days of shipment. Delivers exceptional jasmine floral aromatics, bright citrus acidity, and a crisp honey finish. Compared against generic commercial blends ($15–$18) with uneven roasts and stale supermarket shelf-life, or $60+ micro-lot geishas, this bag offers peak cup complexity and ethical fair-trade sourcing. At $24.00 for ~50 cups (less than $0.50/cup), this represents outstanding daily office value well within spending boundaries.",
      });
    }

    // Cloud prompt
    if (lower.includes("cloud") || lower.includes("compute")) {
      return ok({
        payee: {
          merchantId: "cloudco",
          displayName: "CloudCo",
        },
        payment: {
          amountMinor: 5000, // $50.00
          currency: "USD",
        },
        items: [
          {
            sku: "CC-50",
            description: "Cloud Compute Credits $50",
            quantity: 1,
            unitAmountMinor: 5000,
          },
        ],
        promptPlayback: `Buy $50 cloud compute credits: ${prompt}`,
        rationale:
          "Selected $50 Serverless Compute Credits Package from verified infrastructure provider CloudCo. Delivers instantaneous container spin-up, 99.99% SLA uptime, automated multi-region replication, and zero egress transfer fees. Compared against unmetered pay-as-you-go instances that risk billing runaway, this prepaid package guarantees strictly bounded expenditure with zero hidden fees. At $50.00, it provides optimal development capacity while upholding disciplined budget guardrails.",
      });
    }

    // Desktop / PC prompt
    if (lower.includes("desktop") || lower.includes("pc") || lower.includes("optiplex")) {
      const desktopPrice = extractPriceMinor(prompt, 45000);
      return ok({
        payee: {
          merchantId: "shopx",
          displayName: "ShopX",
        },
        payment: {
          amountMinor: desktopPrice,
          currency: "USD",
        },
        items: [
          {
            sku: "PC-DESK-DELL",
            description: "Dell OptiPlex Desktop Workstation (Intel Core i7, 32GB RAM, 1TB SSD)",
            quantity: 1,
            unitAmountMinor: desktopPrice,
          },
        ],
        promptPlayback: `Buy Dell Desktop Workstation for $${(desktopPrice / 100).toFixed(2)}: ${prompt}`,
        rationale: `Selected Dell OptiPlex Enterprise Desktop Workstation ($${(desktopPrice / 100).toFixed(2)}) from verified merchant ShopX. Configured with 13th Gen Intel Core i7, 32GB high-speed DDR5 RAM, 1TB NVMe PCIe SSD, and dual DisplayPort outputs. Compared against budget mini-PCs that suffer from thermal throttling under sustained load, and overpriced boutique gaming rigs with unnecessary GPU markups, this workstation delivers enterprise-tier multi-threaded productivity and 3-year commercial reliability.`,
      });
    }

    // Mouse prompt
    if (lower.includes("mouse")) {
      const mousePrice = extractPriceMinor(prompt, 4500);
      return ok({
        payee: {
          merchantId: "shopx",
          displayName: "ShopX",
        },
        payment: {
          amountMinor: mousePrice,
          currency: "USD",
        },
        items: [
          {
            sku: "MS-LOGI-MX",
            description: "Wireless Ergonomic Precision Mouse (8000 DPI, Quiet Clicks)",
            quantity: 1,
            unitAmountMinor: mousePrice,
          },
        ],
        promptPlayback: `Order wireless ergonomic mouse for $${(mousePrice / 100).toFixed(2)}: ${prompt}`,
        rationale: `Selected Wireless Ergonomic Precision Mouse ($${(mousePrice / 100).toFixed(2)}) from ShopX. Features contoured palm support, silent tactile switches, high-precision optical tracking on any surface, and 70-day rechargeable battery life. Compared against generic office mice ($15–$25) with high latency and wrist strain, this mouse provides superior ergonomic comfort and verified durable switches at optimal cost.`,
      });
    }

    // Chair prompt
    if (lower.includes("chair")) {
      const chairPrice = extractPriceMinor(prompt, 12000);
      return ok({
        payee: {
          merchantId: "office-plus",
          displayName: "Office Plus",
        },
        payment: {
          amountMinor: chairPrice,
          currency: "USD",
        },
        items: [
          {
            sku: "CHR-ERGO-01",
            description: "High-Back Ergonomic Mesh Task Chair with Lumbar Support",
            quantity: 1,
            unitAmountMinor: chairPrice,
          },
        ],
        promptPlayback: `Order ergonomic task chair for $${(chairPrice / 100).toFixed(2)}: ${prompt}`,
        rationale: `Selected High-Back Ergonomic Mesh Task Chair ($${(chairPrice / 100).toFixed(2)}) from Office Plus. Features dynamic 3D lumbar support, breathable Korean filament mesh, adjustable 3D armrests, and Class-4 heavy-duty gas cylinder rated up to 150kg. Compared against foam chairs ($60–$80) that sag within months, this mesh chair ensures thermal comfort and spine alignment throughout full workdays.`,
      });
    }

    // Laptop prompt
    if (lower.includes("laptop") || lower.includes("macbook") || lower.includes("notebook")) {
      const laptopPrice = extractPriceMinor(prompt, 65000);
      return ok({
        payee: {
          merchantId: "shopx",
          displayName: "ShopX",
        },
        payment: {
          amountMinor: laptopPrice,
          currency: "USD",
        },
        items: [
          {
            sku: "LPT-14-PRO",
            description: 'Business Ultrabook 14" (Intel Core i5, 16GB RAM, 512GB SSD)',
            quantity: 1,
            unitAmountMinor: laptopPrice,
          },
        ],
        promptPlayback: `Order business ultrabook for $${(laptopPrice / 100).toFixed(2)}: ${prompt}`,
        rationale: `Selected 14-inch Business Ultrabook ($${(laptopPrice / 100).toFixed(2)}) from ShopX. Weighs only 1.2kg with CNC aluminum unibody, anti-glare FHD IPS panel, 12-hour battery life, and rapid Thunderbolt 4 charging. Compared against bulky budget plastic laptops, this ultrabook offers premium portability and executive build quality.`,
      });
    }

    // Standing desk prompt
    if (lower.includes("standing desk") || (lower.includes("desk") && !lower.includes("desktop"))) {
      const deskPrice = extractPriceMinor(prompt, 22000);
      return ok({
        payee: {
          merchantId: "office-plus",
          displayName: "Office Plus",
        },
        payment: {
          amountMinor: deskPrice,
          currency: "USD",
        },
        items: [
          {
            sku: "DSK-STAND-01",
            description: 'Dual-Motor Electric Standing Desk 60x30" (Anti-Collision Sensor)',
            quantity: 1,
            unitAmountMinor: deskPrice,
          },
        ],
        promptPlayback: `Order dual-motor electric standing desk for $${(deskPrice / 100).toFixed(2)}: ${prompt}`,
        rationale: `Selected Dual-Motor Electric Standing Desk ($${(deskPrice / 100).toFixed(2)}) from Office Plus. Dual heavy-duty motors provide silent <45dB lift, 4 programmable memory heights, integrated gyro anti-collision, and solid engineered wood desktop. Outclasses single-motor wobbly frames at a fraction of boutique furniture store costs.`,
      });
    }

    // Keyboard prompt
    const isKeyboard = lower.includes("keyboard") || lower.includes("keycap");
    if (isKeyboard) {
      return ok({
        payee: {
          merchantId: "shopx",
          displayName: "ShopX",
        },
        payment: {
          amountMinor: 8500, // $85.00
          currency: "USD",
        },
        items: [
          {
            sku: "KB-75",
            description: "75% Mechanical Keyboard",
            quantity: 1,
            unitAmountMinor: 8500,
          },
        ],
        promptPlayback: lower.includes("keycap")
          ? "Buy a keyboard and keycaps"
          : `Buy the 75% keyboard from ShopX for $85.00: ${prompt}`,
        rationale:
          "Selected 75% Mechanical Keyboard ($85.00) from verified merchant ShopX. Features a compact 82-key space-saving layout, factory pre-lubricated tactile mechanical switches, hot-swappable 5-pin PCB, double-shot PBT keycaps resistant to shine, and multi-layer EVA acoustic dampening foam. Compared against disposable membrane office keyboards ($30–$45) that degrade within months and lack tactile precision, and custom enthusiast assemblies ($200+) with steep diminishing returns, this keyboard achieves 90% of custom-grade sound and feel. At $85.00, it provides maximum ergonomic comfort and proven durability while remaining safely under your spending cap.",
      });
    }

    // Dynamic extraction for any free-form user query!
    const cleanTitle = prompt
      .replace(/^(?:i\s+want\s+to\s+buy|buy|order|purchase|get|find|source)\s+/i, "")
      .replace(/\s+(?:for|at)\s+\$?\d+.*$/i, "")
      .trim();
    const finalTitle = cleanTitle
      ? cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1)
      : "Requested Catalog Item";
    const dynamicPriceMinor = extractPriceMinor(prompt, 8500);

    return ok({
      payee: {
        merchantId: "shopx",
        displayName: "ShopX",
      },
      payment: {
        amountMinor: dynamicPriceMinor,
        currency: "USD",
      },
      items: [
        {
          sku: `ITEM-${Math.abs(dynamicPriceMinor % 999)}`,
          description: finalTitle,
          quantity: 1,
          unitAmountMinor: dynamicPriceMinor,
        },
      ],
      promptPlayback: `Order ${finalTitle} for $${(dynamicPriceMinor / 100).toFixed(2)}: ${prompt}`,
      rationale: `Selected ${finalTitle} ($${(dynamicPriceMinor / 100).toFixed(2)}) from verified merchant ShopX matching your specific search query. Sourced directly based on prompt parameters with verified merchant standing and complete dual-custody protection.`,
    });
  }
}
