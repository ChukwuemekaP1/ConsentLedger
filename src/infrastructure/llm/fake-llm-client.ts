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

    // Support simulated tool calls against the catalog if enabled
    if (this.config.simulateToolCalls) {
      await catalog.search(prompt);
    }

    // Over-cap request simulation
    if (lower.includes("expensive") || lower.includes("over-cap") || lower.includes("overcap")) {
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
        rationale: "Selected high-end custom keyboard based on user request",
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
        rationale: "Selected fresh roast Ethiopian Yirgacheffe coffee beans from Coffee Works",
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
        rationale: "Selected $50 serverless compute credits package from CloudCo",
      });
    }

    // Default: Mechanical keyboard from ShopX ($85.00)
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
      promptPlayback: `Buy the 75% keyboard from ShopX for $85.00: ${prompt}`,
      rationale: "Selected best-matching compact 75% mechanical keyboard from ShopX catalog",
    });
  }
}
