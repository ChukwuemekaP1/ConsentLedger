/**
 * Gemini Adapter Unit Tests.
 *
 * Verifies tool calling execution, schema validation, retry logic, error handling,
 * and rate-limiting backoff against mocked Gemini REST responses.
 *
 * Implements acceptance criterion: llm.invalid-output.test (Issue #5).
 */

import { describe, it, expect } from "vitest";
import { GeminiLlmClient } from "../../../../src/infrastructure/llm/gemini-adapter.js";
import { FixtureCatalog } from "../../../../src/infrastructure/catalog/fixture-catalog.js";

describe("GeminiLlmClient (llm.invalid-output.test)", () => {
  const catalog = new FixtureCatalog();

  it("fails immediately if API key is missing", async () => {
    const client = new GeminiLlmClient("", "gemini-1.5-pro");
    const result = await client.generateProposal("Buy a keyboard", catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("PROVIDER_ERROR");
      expect(result.error.message).toContain("API key");
    }
  });

  it("handles single-turn valid proposal directly", async () => {
    const mockFetch: typeof fetch = async () => {
      const body = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "propose_cart",
                    args: {
                      payee: {
                        merchantId: "shopx",
                        displayName: "ShopX",
                      },
                      payment: {
                        amountMinor: 8500,
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
                      promptPlayback: "Buy 75% keyboard from ShopX for $85.00",
                      rationale: "Selected matching keyboard from ShopX",
                    },
                  },
                },
              ],
            },
          },
        ],
      };
      return new Response(JSON.stringify(body), { status: 200 });
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Buy 75% keyboard", catalog);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payee.merchantId).toBe("shopx");
      expect(result.value.payment.amountMinor).toBe(8500);
      expect(result.value.payment.currency).toBe("USD");
      expect(result.value.items).toHaveLength(1);
      expect(result.value.promptPlayback).toBe("Buy 75% keyboard from ShopX for $85.00");
    }
  });

  it("executes multi-turn tool calling: search_products then propose_cart", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async (_url, init) => {
      callCount++;
      const req = JSON.parse(init?.body as string);

      if (callCount === 1) {
        // First turn: model calls search_products
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "search_products",
                        args: { query: "keyboard" },
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      // Second turn: verify client sent functionResponse with search results
      const functionResponsePart = (
        req.contents as Array<{
          role: string;
          parts: Array<{ functionResponse?: unknown }>;
        }>
      ).find((c) => c.role === "user" && c.parts[0]?.functionResponse !== undefined);
      expect(functionResponsePart).toBeDefined();

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "propose_cart",
                      args: {
                        payee: { merchantId: "shopx", displayName: "ShopX" },
                        payment: { amountMinor: 8500, currency: "USD" },
                        items: [
                          {
                            sku: "KB-75",
                            description: "75% Mechanical Keyboard",
                            quantity: 1,
                            unitAmountMinor: 8500,
                          },
                        ],
                        promptPlayback: "Purchasing mechanical keyboard",
                        rationale: "Found in catalog search",
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Looking for a keyboard", catalog);

    expect(callCount).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payee.merchantId).toBe("shopx");
      expect(result.value.payment.amountMinor).toBe(8500);
    }
  });

  it("retries once when proposal schema is malformed, succeeding on second attempt", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async (_url, init) => {
      callCount++;
      const req = JSON.parse(init?.body as string);

      if (callCount === 1) {
        // Return proposal where item total does not match payment amount (1 * 5000 != 8500)
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: "propose_cart",
                        args: {
                          payee: { merchantId: "shopx", displayName: "ShopX" },
                          payment: { amountMinor: 8500, currency: "USD" },
                          items: [
                            {
                              sku: "KB-75",
                              description: "75% Mechanical Keyboard",
                              quantity: 1,
                              unitAmountMinor: 5000, // MISMATCH!
                            },
                          ],
                          promptPlayback: "Buy keyboard",
                          rationale: "Selected keyboard",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      // Check that turn 2 received the schema error explanation
      const functionResponsePart = (
        req.contents as Array<{
          role: string;
          parts: Array<{ functionResponse?: { name: string } }>;
        }>
      ).find((c) => c.role === "user" && c.parts[0]?.functionResponse?.name === "propose_cart");
      expect(functionResponsePart).toBeDefined();

      // Return corrected proposal
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "propose_cart",
                      args: {
                        payee: { merchantId: "shopx", displayName: "ShopX" },
                        payment: { amountMinor: 8500, currency: "USD" },
                        items: [
                          {
                            sku: "KB-75",
                            description: "75% Mechanical Keyboard",
                            quantity: 1,
                            unitAmountMinor: 8500, // CORRECTED
                          },
                        ],
                        promptPlayback: "Buy keyboard",
                        rationale: "Selected keyboard",
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Buy keyboard", catalog);

    expect(callCount).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.payment.amountMinor).toBe(8500);
      expect(result.value.items[0]?.unitAmountMinor).toBe(8500);
    }
  });

  it("fails clearly with MALFORMED_OUTPUT when model fails schema validation twice", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      // Always return invalid proposal (negative amount)
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "propose_cart",
                      args: {
                        payee: { merchantId: "shopx", displayName: "ShopX" },
                        payment: { amountMinor: -500, currency: "USD" },
                        items: [],
                        promptPlayback: "Invalid",
                        rationale: "Invalid",
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Buy something", catalog);

    expect(callCount).toBe(2); // Retried once then failed
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MALFORMED_OUTPUT");
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).toContain("invalid proposal after retry");
    }
  });

  it("returns RATE_LIMITED error with retryable=true on HTTP 429", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(JSON.stringify({ error: "RESOURCE_EXHAUSTED" }), { status: 429 });
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Buy keyboard", catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("RATE_LIMITED");
      expect(result.error.retryable).toBe(true);
      expect(result.error.message).toContain("429");
    }
  });

  it("returns PROVIDER_ERROR on HTTP 500", async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Buy keyboard", catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("PROVIDER_ERROR");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("returns MAX_STEPS_EXCEEDED when agent loops 5 times without propose_cart", async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: "search_products",
                      args: { query: `search-${callCount}` },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const client = new GeminiLlmClient("test-key", "gemini-1.5-pro", mockFetch);
    const result = await client.generateProposal("Infinite search", catalog);

    expect(callCount).toBe(5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MAX_STEPS_EXCEEDED");
    }
  });
});
