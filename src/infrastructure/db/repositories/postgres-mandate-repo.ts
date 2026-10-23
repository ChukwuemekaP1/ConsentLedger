/**
 * Postgres implementation of MandateRepo.
 *
 * Persists and queries mandates, versioned policies, and mandate consents.
 * ARCHITECTURE.md §4.1, §4.2, §12.
 */

import { eq, and, sql } from "drizzle-orm";
import type { Database } from "../client.js";
import { mandates } from "../schema/mandates.js";
import { agents } from "../schema/agents.js";
import { policies } from "../schema/policies.js";
import { mandateConsents } from "../schema/mandate-consents.js";
import type { MandateRepo, StoredMandateConsent } from "../../../application/ports/mandate-repo.js";
import type { StoredMandateRecord } from "../../../domain/gate/gate.js";
import type { PolicyDocument } from "../../../domain/policy/policy.js";
import { DEFAULT_POLICY_V1 } from "../../../domain/policy/policy.js";
import type {
  CartMandateTerms,
  IntentMandateTerms,
  Attestation,
} from "../../../domain/mandate/types.js";

export class PostgresMandateRepo implements MandateRepo {
  constructor(private readonly db: Database) {}

  async findMandateById(id: string): Promise<StoredMandateRecord | null> {
    const rows = await this.db.select().from(mandates).where(eq(mandates.id, id)).limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      terms: row.terms as CartMandateTerms | IntentMandateTerms,
      hash: row.hash,
      attestations: row.attestations as readonly Attestation[],
      status: row.status,
    };
  }

  async findMandateByHash(hash: string): Promise<StoredMandateRecord | null> {
    const rows = await this.db.select().from(mandates).where(eq(mandates.hash, hash)).limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      terms: row.terms as CartMandateTerms | IntentMandateTerms,
      hash: row.hash,
      attestations: row.attestations as readonly Attestation[],
      status: row.status,
    };
  }

  async lockMandate(id: string): Promise<void> {
    // Acquire a row-level lock on the mandate row
    await this.db.execute(sql`SELECT id FROM mandates WHERE id = ${id} FOR UPDATE;`);
  }

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
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      mandate.agentId,
    );
    const agentId = isUuid ? mandate.agentId : "00000000-0000-4000-8000-000000000001";
    if (!isUuid) {
      await this.db
        .insert(agents)
        .values({
          id: agentId,
          name: "Gemini Proposal Agent",
          kind: "builtin-gemini",
          apiKeyHash: "0".repeat(63) + "1",
          createdAt: mandate.createdAt,
        })
        .onConflictDoNothing();
    }

    const rows = await this.db
      .insert(mandates)
      .values({
        id: mandate.id,
        kind: mandate.kind,
        correlationId: mandate.correlationId,
        principalId: mandate.principalId,
        agentId,
        terms: mandate.terms,
        hash: mandate.hash,
        attestations: mandate.attestations as unknown as Attestation[],
        status: mandate.status,
        expiresAt: mandate.expiresAt,
        createdAt: mandate.createdAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert mandate: no row returned");
    }

    return {
      terms: row.terms as CartMandateTerms | IntentMandateTerms,
      hash: row.hash,
      attestations: row.attestations as readonly Attestation[],
      status: row.status,
    };
  }

  async updateMandateStatus(id: string, status: string): Promise<void> {
    await this.db.update(mandates).set({ status }).where(eq(mandates.id, id));
  }

  async findPolicyById(id: string): Promise<PolicyDocument | null> {
    const rows = await this.db.select().from(policies).where(eq(policies.id, id)).limit(1);

    const row = rows[0];
    if (!row) {
      if (id === DEFAULT_POLICY_V1.id || id === "policy-v1" || id === "policy-custom") {
        return DEFAULT_POLICY_V1;
      }
      return null;
    }

    const content = row.content as PolicyDocument;
    if (!content.id) {
      return {
        id: row.id,
        version: row.version,
        rules: (content as { rules?: PolicyDocument["rules"] }).rules ?? DEFAULT_POLICY_V1.rules,
      };
    }

    return content;
  }

  async findActivePolicy(id: string): Promise<PolicyDocument | null> {
    const rows = await this.db
      .select()
      .from(policies)
      .where(and(eq(policies.id, id), eq(policies.active, true)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      if (id === DEFAULT_POLICY_V1.id || id === "policy-v1" || id === "policy-custom") {
        return DEFAULT_POLICY_V1;
      }
      return null;
    }

    const content = row.content as PolicyDocument;
    if (!content.id) {
      return {
        id: row.id,
        version: row.version,
        rules: (content as { rules?: PolicyDocument["rules"] }).rules ?? DEFAULT_POLICY_V1.rules,
      };
    }

    return content;
  }

  async findConsentByMandateId(mandateId: string): Promise<StoredMandateConsent | null> {
    const rows = await this.db
      .select()
      .from(mandateConsents)
      .where(eq(mandateConsents.mandateId, mandateId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      mandateId: row.mandateId,
      credentialId: row.credentialId,
      authenticatorData: row.authenticatorData,
      clientDataJson: row.clientDataJson,
      signature: row.signature,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
    };
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
    const rows = await this.db
      .insert(mandateConsents)
      .values({
        id: consent.id,
        mandateId: consent.mandateId,
        credentialId: consent.credentialId,
        authenticatorData: consent.authenticatorData,
        clientDataJson: consent.clientDataJson,
        signature: consent.signature,
        verifiedAt: consent.verifiedAt,
        createdAt: consent.createdAt,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new Error("Failed to insert mandate consent: no row returned");
    }

    return {
      id: row.id,
      mandateId: row.mandateId,
      credentialId: row.credentialId,
      authenticatorData: row.authenticatorData,
      clientDataJson: row.clientDataJson,
      signature: row.signature,
      verifiedAt: row.verifiedAt,
      createdAt: row.createdAt,
    };
  }
}
