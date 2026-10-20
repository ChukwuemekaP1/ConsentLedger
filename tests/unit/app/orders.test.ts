/**
 * Route tests for POST /api/v1/orders and GET /api/v1/paypal/client-config.
 *
 * Verifies request validation, session authentication, RFC 9457 problem responses,
 * Gate rejection mappings, and safe config exposure without secrets.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "../../../src/app/api/v1/orders/route.js";
import { GET as getClientConfig } from "../../../src/app/api/v1/paypal/client-config/route.js";
import { container } from "../../../src/container.js";
import { FakePaymentProvider } from "../../../src/infrastructure/paypal/fake-payment-provider.js";
import type {
  PaymentMandateRepo,
  StoredPaymentMandateRecord,
  PaymentMandateStatus,
} from "../../../src/application/ports/payment-mandate-repo.js";
import type {
  MandateRepo,
  StoredMandateConsent,
} from "../../../src/application/ports/mandate-repo.js";
import type { StoredMandateRecord } from "../../../src/domain/gate/index.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";
import { hashPolicy } from "../../../src/domain/policy/policy.js";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { keyId } from "../../../src/domain/crypto/signing.js";
import { attestMandate } from "../../../src/domain/mandate/attestation.js";
import { buildCartMandate } from "../../../src/domain/mandate/builders.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";
import type { Uuid, Timestamp } from "../../../src/domain/shared/clock.js";

class MockMandateRepo implements MandateRepo {
  mandates = new Map<string, StoredMandateRecord>();
  consents = new Map<string, StoredMandateConsent>();
  policies = new Map<string, PolicyDocument>();

  async findMandateById(id: string): Promise<StoredMandateRecord | null> {
    return this.mandates.get(id) ?? null;
  }
  async findMandateByHash(hash: string): Promise<StoredMandateRecord | null> {
    for (const m of this.mandates.values()) {
      if (m.hash === hash) return m;
    }
    return null;
  }
  async lockMandate(_id: string): Promise<void> {}
  async createMandate(mandate: {
    id: string;
    kind: "CART" | "INTENT";
    correlationId: string;
    principalId: string;
    agentId: string;
    terms: StoredMandateRecord["terms"];
    hash: string;
    attestations: StoredMandateRecord["attestations"];
    status: string;
    expiresAt: string;
    createdAt: string;
  }): Promise<StoredMandateRecord> {
    const record: StoredMandateRecord = {
      terms: mandate.terms,
      hash: mandate.hash,
      attestations: mandate.attestations,
      status: mandate.status,
    };
    this.mandates.set(mandate.id, record);
    return record;
  }
  async updateMandateStatus(id: string, status: string): Promise<void> {
    const existing = this.mandates.get(id);
    if (existing) {
      this.mandates.set(id, { ...existing, status });
    }
  }
  async findPolicyById(id: string): Promise<PolicyDocument | null> {
    return this.policies.get(id) ?? null;
  }
  async findActivePolicy(id: string): Promise<PolicyDocument | null> {
    return this.policies.get(id) ?? null;
  }
  async findConsentByMandateId(mandateId: string): Promise<StoredMandateConsent | null> {
    return this.consents.get(mandateId) ?? null;
  }
  async saveConsent(consent: {
    id: string;
    mandateId: string;
    credentialId: string;
    authenticatorData: string;
    clientDataJson: string;
    signature: string;
    verifiedAt: string;
    createdAt: string;
  }): Promise<StoredMandateConsent> {
    this.consents.set(consent.mandateId, consent);
    return consent;
  }
}

class MockPaymentMandateRepo implements PaymentMandateRepo {
  records = new Map<string, StoredPaymentMandateRecord>();

  async findPaymentMandateById(id: string): Promise<StoredPaymentMandateRecord | null> {
    return this.records.get(id) ?? null;
  }
  async findPaymentMandateByMandateId(
    mandateId: string,
  ): Promise<StoredPaymentMandateRecord | null> {
    for (const r of this.records.values()) {
      if (r.mandateId === mandateId) return r;
    }
    return null;
  }
  async findPaymentMandateByOrderId(orderId: string): Promise<StoredPaymentMandateRecord | null> {
    for (const r of this.records.values()) {
      if (r.paypalOrderId === orderId) return r;
    }
    return null;
  }
  async countByMandateId(mandateId: string): Promise<number> {
    let count = 0;
    for (const r of this.records.values()) {
      if (r.mandateId === mandateId) count++;
    }
    return count;
  }
  async lockPaymentMandate(_id: string): Promise<void> {
    // No-op for mock
  }
  async insertPaymentMandate(record: {
    id: string;
    mandateId: string;
    correlationId: string;
    sequence: number;
    terms: StoredPaymentMandateRecord["terms"];
    hash: string;
    authoritySignature: string;
    status: PaymentMandateStatus;
    requestId: string;
    createdAt: string;
  }): Promise<StoredPaymentMandateRecord> {
    const full: StoredPaymentMandateRecord = {
      ...record,
      captureRequestId: null,
      paypalOrderId: null,
      paypalCaptureId: null,
    };
    this.records.set(record.id, full);
    return full;
  }
  async updatePaymentMandateStatus(
    id: string,
    update: {
      status: PaymentMandateStatus;
      paypalOrderId?: string;
      captureRequestId?: string;
      paypalCaptureId?: string;
    },
  ): Promise<void> {
    const existing = this.records.get(id);
    if (existing) {
      this.records.set(id, {
        ...existing,
        status: update.status,
        ...(update.paypalOrderId !== undefined ? { paypalOrderId: update.paypalOrderId } : {}),
      });
    }
  }
}

describe("POST /api/v1/orders", () => {
  let mockMandateRepo: MockMandateRepo;
  let mockPaymentMandateRepo: MockPaymentMandateRepo;
  let fakePaymentProvider: FakePaymentProvider;
  let validSessionCookie: string;
  let principalId: string;
  const authorityKeys = generateKeyPairSync("ed25519");
  const merchantKeys = generateKeyPairSync("ed25519");

  beforeEach(() => {
    mockMandateRepo = new MockMandateRepo();
    mockPaymentMandateRepo = new MockPaymentMandateRepo();
    fakePaymentProvider = new FakePaymentProvider();

    container.setMandateRepo(mockMandateRepo);
    container.setPaymentMandateRepo(mockPaymentMandateRepo);
    container.setPaymentProvider(fakePaymentProvider);

    const tMap = new Map();
    tMap.set(keyId(authorityKeys.publicKey), {
      role: "AUTHORITY" as const,
      publicKey: authorityKeys.publicKey,
    });
    tMap.set(keyId(merchantKeys.publicKey), {
      role: "MERCHANT" as const,
      publicKey: merchantKeys.publicKey,
    });
    container.setTrustedKeys(tMap);
    container.setAuthorityKeyPair(authorityKeys);

    principalId = randomUUID();
    validSessionCookie = `cl_session=${container.getSessionService().sign(principalId)}`;

    const defaultPolicy = {
      id: "policy-default",
      version: 1,
      rules: { maxPerTxMinor: 100000 },
    };
    mockMandateRepo.policies.set("policy-default", defaultPolicy);
  });

  async function createValidSignedMandate() {
    const mandateId = randomUUID();
    const correlationId = randomUUID();
    const policy = mockMandateRepo.policies.get("policy-default");
    if (!policy) throw new Error("Policy not found");
    const policyHash = hashPolicy(policy);
    if (!policyHash.ok) throw new Error("Policy hash failed");

    const buildResult = buildCartMandate({
      id: mandateId as Uuid,
      correlationId: correlationId as Uuid,
      principalId,
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "merchant-1", displayName: "Merchant One" },
      payment: { amountMinor: 7500, currency: "USD" },
      items: [
        {
          sku: "ITEM-A",
          description: "Widget A",
          quantity: 1,
          unitAmountMinor: 7500,
        },
      ],
      promptPlayback: "Widget purchase",
      policy: { id: policy.id, hash: policyHash.value },
      validity: {
        notBefore: new Date(Date.now() - 60000).toISOString() as Timestamp,
        expiresAt: new Date(Date.now() + 600000).toISOString() as Timestamp,
      },
      nonce: "nonce-1",
    });

    if (!buildResult.ok) throw new Error("Failed to build mandate");
    const { terms, hash } = buildResult.value;

    // Attest with authority and merchant
    const authAttest = attestMandate(
      "AUTHORITY",
      hash as Hash,
      authorityKeys.privateKey,
      authorityKeys.publicKey,
    );
    const merchAttest = attestMandate(
      "MERCHANT",
      hash as Hash,
      merchantKeys.privateKey,
      merchantKeys.publicKey,
    );
    if (!authAttest.ok || !merchAttest.ok) throw new Error("Attest failed");

    // Save mandate as SIGNED (ready for execution)
    await mockMandateRepo.createMandate({
      id: mandateId,
      kind: "CART",
      correlationId,
      principalId,
      agentId: "agent-1",
      terms,
      hash,
      attestations: [authAttest.value, merchAttest.value],
      status: "SIGNED",
      expiresAt: terms.validity.expiresAt,
      createdAt: terms.validity.notBefore,
    });

    // Save consent
    await mockMandateRepo.saveConsent({
      id: randomUUID(),
      mandateId,
      credentialId: "cred-1",
      authenticatorData: "auth-data",
      clientDataJson: "client-data",
      signature: "sig",
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    return { mandateId, hash };
  }

  it("returns 401 UNAUTHENTICATED without session cookie", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mandateId: randomUUID() }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 VALIDATION_FAILED for invalid request body", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ mandateId: "not-a-uuid" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("returns 404 MANDATE_NOT_FOUND if mandate does not exist", async () => {
    const req = new Request("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ mandateId: randomUUID() }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("MANDATE_NOT_FOUND");
  });

  it("returns 403 CONSENT_MISSING if mandate has no consent recorded", async () => {
    const mandateId = randomUUID();
    const policy = mockMandateRepo.policies.get("policy-default");
    if (!policy) throw new Error("Policy not found");
    const policyHash = hashPolicy(policy);
    if (!policyHash.ok) throw new Error("Policy hash failed");

    const buildResult = buildCartMandate({
      id: mandateId as Uuid,
      correlationId: randomUUID() as Uuid,
      principalId,
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "merchant-1", displayName: "Merchant One" },
      payment: { amountMinor: 7500, currency: "USD" },
      items: [
        {
          sku: "ITEM-A",
          description: "Widget A",
          quantity: 1,
          unitAmountMinor: 7500,
        },
      ],
      promptPlayback: "Widget purchase",
      policy: { id: policy.id, hash: policyHash.value },
      validity: {
        notBefore: new Date(Date.now() - 60000).toISOString() as Timestamp,
        expiresAt: new Date(Date.now() + 600000).toISOString() as Timestamp,
      },
      nonce: "nonce-1",
    });

    if (!buildResult.ok) throw new Error("Failed to build mandate");
    const { terms, hash } = buildResult.value;

    await mockMandateRepo.createMandate({
      id: mandateId,
      kind: "CART",
      correlationId: terms.correlationId,
      principalId,
      agentId: "agent-1",
      terms,
      hash,
      attestations: [],
      status: "ISSUED",
      expiresAt: terms.validity.expiresAt,
      createdAt: terms.validity.notBefore,
    });

    const req = new Request("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ mandateId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("CONSENT_MISSING");
  });

  it("returns 201 Created and order details on valid execution", async () => {
    const { mandateId } = await createValidSignedMandate();

    const req = new Request("http://localhost:3000/api/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ mandateId }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.orderId).toBeDefined();
    expect(body.paymentMandateId).toBeDefined();
    expect(body.status).toBe("CREATED");
    expect(body.links).toBeDefined();
  });
});

describe("GET /api/v1/paypal/client-config", () => {
  it("returns safe PayPal client configuration without secrets (I-12)", async () => {
    const req = new Request("http://localhost:3000/api/v1/paypal/client-config");
    const res = await getClientConfig(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("clientId");
    expect(body).toHaveProperty("currency");
    expect(body).toHaveProperty("environment");

    // Must never leak client secret
    expect(body).not.toHaveProperty("clientSecret");
    expect(body).not.toHaveProperty("PAYPAL_CLIENT_SECRET");
  });
});
