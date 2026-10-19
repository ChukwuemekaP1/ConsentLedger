/**
 * Route tests for POST /api/v1/proposals.
 *
 * Verifies request validation, session authentication, error mapping,
 * and successful proposal creation according to RFC 9457 problem specifications.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { POST } from "../../../src/app/api/v1/proposals/route.js";
import { container } from "../../../src/container.js";

import type {
  MandateRepo,
  StoredMandateConsent,
} from "../../../src/application/ports/mandate-repo.js";
import type { StoredMandateRecord } from "../../../src/domain/gate/gate.js";
import type { PolicyDocument } from "../../../src/domain/policy/policy.js";

class InMemoryMandateRepo implements MandateRepo {
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
    const m = this.mandates.get(id);
    if (m) {
      this.mandates.set(id, { ...m, status });
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
    const stored: StoredMandateConsent = { ...consent };
    this.consents.set(consent.mandateId, stored);
    return stored;
  }
}

describe("POST /api/v1/proposals", () => {
  let validSessionCookie: string;
  const testPrincipalId = "00000000-0000-4000-8000-000000000001";

  beforeAll(() => {
    container.setMandateRepo(new InMemoryMandateRepo());
    // Generate valid session cookie using SessionService
    const session = container.getSessionService().sign(testPrincipalId);
    validSessionCookie = `cl_session=${session}`;
  });

  it("returns 401 when unauthenticated", async () => {
    const request = new Request("http://localhost:3000/api/v1/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Buy a keyboard" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("returns 400 when body is invalid JSON", async () => {
    const request = new Request("http://localhost:3000/api/v1/proposals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: "invalid-json{",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when prompt is empty", async () => {
    const request = new Request("http://localhost:3000/api/v1/proposals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ prompt: "" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("returns 201 with mandate and proposal on valid request", async () => {
    const request = new Request("http://localhost:3000/api/v1/proposals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ prompt: "I want a 75% mechanical keyboard from ShopX" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const data = await response.json();

    expect(data.mandate).toBeDefined();
    expect(data.mandate.terms.kind).toBe("CART");
    expect(data.mandate.terms.principalId).toBe(testPrincipalId);
    expect(data.mandate.terms.payment.amountMinor).toBe(8500);
    expect(data.proposal).toBeDefined();
    expect(data.proposal.payee.merchantId).toBe("shopx");
    expect(data.evaluation.decision).toBe("ALLOW");
  });

  it("returns 422 with policy denial reasons when over cap", async () => {
    const request = new Request("http://localhost:3000/api/v1/proposals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: validSessionCookie,
      },
      body: JSON.stringify({ prompt: "Buy the most expensive luxury keyboard over-cap" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(422);
    const data = await response.json();

    expect(data.title).toBe("Policy Denied");
    expect(data.reasons).toContain("TX_CAP_EXCEEDED");
    expect(data.proposal).toBeDefined();
  });
});
