/**
 * Live PayPal Sandbox smoke test.
 *
 * Runs only when PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are configured.
 * Tests real OAuth2 token exchange and real Orders v2 order creation against api-m.sandbox.paypal.com.
 */

import { describe, it, expect } from "vitest";
import { PayPalAdapter } from "../../../../src/infrastructure/paypal/paypal-adapter.js";
import { config } from "../../../../src/infrastructure/config/env.js";
import type { GateApproval } from "../../../../src/domain/gate/types.js";
import type { PaymentMandateTerms } from "../../../../src/domain/mandate/types.js";
import type { Timestamp } from "../../../../src/domain/shared/clock.js";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function getCredentials(): { clientId?: string | undefined; clientSecret?: string | undefined } {
  if (config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET) {
    return { clientId: config.PAYPAL_CLIENT_ID, clientSecret: config.PAYPAL_CLIENT_SECRET };
  }
  const envPath = resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf8");
    const idMatch = content.match(/^PAYPAL_CLIENT_ID=(.+)$/m);
    const secretMatch = content.match(/^PAYPAL_CLIENT_SECRET=(.+)$/m);
    if (idMatch && secretMatch) {
      return {
        clientId: idMatch[1]?.trim().replace(/^["']|["']$/g, ""),
        clientSecret: secretMatch[1]?.trim().replace(/^["']|["']$/g, ""),
      };
    }
  }
  return {};
}

const creds = getCredentials();
const hasCredentials = Boolean(
  process.env.TEST_PAYPAL_LIVE === "true" && creds.clientId && creds.clientSecret,
);

describe.skipIf(!hasCredentials)("PayPalAdapter (Live Sandbox Smoke Test)", () => {
  it("authenticates and creates an order in real PayPal Sandbox", async () => {
    if (!creds.clientId || !creds.clientSecret) return;
    const adapter = new PayPalAdapter({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      env: "sandbox",
    });

    const tokenResult = await adapter.getAccessToken();
    expect(tokenResult.ok).toBe(true);
    if (!tokenResult.ok) return;
    expect(typeof tokenResult.value).toBe("string");
    expect(tokenResult.value.length).toBeGreaterThan(20);

    const pmId = randomUUID();
    const fakeApproval = {
      paymentMandateTerms: {
        v: 1,
        kind: "PAYMENT",
        id: pmId,
        correlationId: randomUUID(),
        parent: { mandateId: randomUUID(), hash: "0".repeat(64), kind: "CART" },
        modality: "HP",
        sequence: 1,
        payee: { merchantId: "sandbox-merchant" },
        payment: { amountMinor: 2500, currency: "USD" },
        agentId: "test-agent",
        createdAt: new Date().toISOString(),
      } as unknown as PaymentMandateTerms,
      approvedAt: new Date().toISOString() as Timestamp,
    } as unknown as GateApproval;

    const orderResult = await adapter.createOrder({
      approval: fakeApproval,
      requestId: randomUUID(),
    });

    expect(orderResult.ok).toBe(true);
    if (!orderResult.ok) return;
    expect(orderResult.value.orderId).toBeDefined();
    expect(orderResult.value.status).toBe("CREATED");
    expect(Array.isArray(orderResult.value.links)).toBe(true);
  }, 15_000);
});
