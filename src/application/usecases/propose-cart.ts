/**
 * Use case: Propose Cart Mandate.
 *
 * Runs the AI agent loop (Gemini or FakeLlmClient) over the catalog to produce
 * a structured proposal, evaluates the proposal against policy, builds an issued
 * Cart Mandate with authority attestation, and atomically appends ledger events.
 *
 * ARCHITECTURE.md §4.1, §5, §14, INVARIANTS I-04, I-07, I-10, I-11.
 */

import type { KeyObject } from "node:crypto";
import { type Result, ok, err } from "../../domain/shared/result.js";
import type { Clock, IdGenerator, Uuid } from "../../domain/shared/clock.js";
import type { LlmClient, PurchaseProposal, ProductCatalog } from "../ports/index.js";
import type { ProductItem, SearchProductsOptions } from "../ports/catalog-port.js";
import type { MandateRepo } from "../ports/mandate-repo.js";
import type { StoredMandateRecord } from "../../domain/gate/gate.js";
import {
  evaluatePolicy,
  hashPolicy,
  DEFAULT_POLICY_V1,
  type PolicyDocument,
  type PolicyEvaluation,
  type PolicyReasonCode,
} from "../../domain/policy/index.js";
import { buildCartMandate, attestMandate, type Attestation } from "../../domain/mandate/index.js";
import type { Hash } from "../../domain/crypto/hash.js";
import type { AppendLedgerEvent } from "./append-ledger-event.js";

export interface AuthorityKeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

export interface ProposeCartInput {
  readonly principalId: string;
  readonly prompt: string;
  readonly correlationId?: string;
  readonly policy?: PolicyDocument;
  readonly agentId?: string;
}

/**
 * Display-only product facts for the UI (image, store link, brand).
 * Deliberately NOT part of the signed mandate terms: the passkey signs `terms` only (I-02).
 */
export interface ProposedProductView {
  readonly sku: string;
  readonly title: string;
  readonly merchantDisplayName: string;
  readonly imageUrl?: string;
  readonly buyUrl?: string;
  readonly brand?: string;
}

export interface ProposeCartOutput {
  readonly mandate: StoredMandateRecord;
  readonly proposal: PurchaseProposal;
  readonly evaluation: PolicyEvaluation;
  readonly products: readonly ProposedProductView[];
}

/**
 * Wraps the catalog so we remember every item the agent actually saw.
 * Lets us show real product imagery without a second round-trip to the store API.
 */
class RecordingCatalog implements ProductCatalog {
  readonly seen = new Map<string, ProductItem>();
  constructor(private readonly inner: ProductCatalog) {}

  async search(query: string, options?: SearchProductsOptions): Promise<readonly ProductItem[]> {
    const items = await this.inner.search(query, options);
    for (const item of items) this.seen.set(item.sku, item);
    return items;
  }

  async getDetails(sku: string): Promise<ProductItem | null> {
    const item = await this.inner.getDetails(sku);
    if (item) this.seen.set(item.sku, item);
    return item;
  }
}

function toProductView(item: ProductItem): ProposedProductView {
  return {
    sku: item.sku,
    title: item.title,
    merchantDisplayName: item.merchantDisplayName,
    ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
    ...(item.buyUrl !== undefined ? { buyUrl: item.buyUrl } : {}),
    ...(item.brand !== undefined ? { brand: item.brand } : {}),
  };
}

export type ProposeCartErrorKind =
  | "LLM_ERROR"
  | "POLICY_DENIED"
  | "POLICY_NOT_FOUND"
  | "MANDATE_BUILD_FAILED"
  | "PERSISTENCE_FAILED";

export interface ProposeCartError {
  readonly kind: ProposeCartErrorKind;
  readonly message: string;
  readonly reasons?: readonly PolicyReasonCode[];
  readonly proposal?: PurchaseProposal;
  readonly details?: unknown;
}

export class ProposeCartUseCase {
  constructor(
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly llmClient: LlmClient,
    private readonly catalog: ProductCatalog,
    private readonly mandateRepo: MandateRepo,
    private readonly authorityKeyPair?: AuthorityKeyPair,
    private readonly appendLedgerEvent?: AppendLedgerEvent,
    private readonly merchantKeyPair?: AuthorityKeyPair,
  ) {}

  async execute(input: ProposeCartInput): Promise<Result<ProposeCartOutput, ProposeCartError>> {
    const correlationId = input.correlationId ?? this.idGenerator.uuid();
    const agentId = input.agentId ?? "gemini-proposal-agent";

    // 1. Resolve Policy (input policy -> active policy from repo -> seeded DEFAULT_POLICY_V1)
    let policy = input.policy;
    if (!policy) {
      const activePolicy = await this.mandateRepo.findActivePolicy("policy-v1");
      policy = activePolicy ?? DEFAULT_POLICY_V1;
    }

    // 2. Invoke AI Proposal Agent
    const recordingCatalog = new RecordingCatalog(this.catalog);
    const llmResult = await this.llmClient.generateProposal(input.prompt, recordingCatalog);
    if (!llmResult.ok) {
      return err({
        kind: "LLM_ERROR",
        message: `LLM proposal generation failed: ${llmResult.error.message}`,
        details: llmResult.error,
      });
    }
    const proposal = llmResult.value;

    // 3. Evaluate Policy (Deterministic Gate Check 6/7)
    const evaluation = evaluatePolicy(policy, {
      amountMinor: proposal.payment.amountMinor,
      currency: proposal.payment.currency,
      merchantId: proposal.payee.merchantId,
    });

    if (evaluation.decision === "DENY") {
      // Append POLICY_DENIED event to ledger if enabled
      if (this.appendLedgerEvent) {
        await this.appendLedgerEvent.execute({
          correlationId,
          type: "POLICY_DENIED",
          actor: { type: "agent", id: agentId },
          payload: {
            reasons: evaluation.reasons,
            proposal,
            prompt: input.prompt,
          },
        });
      }

      return err({
        kind: "POLICY_DENIED",
        message: "Purchase proposal denied by policy",
        reasons: evaluation.reasons,
        proposal,
      });
    }

    // 4. Build Cart Mandate
    const mandateId = this.idGenerator.uuid();
    const notBefore = this.clock.now();
    // Cart TTL: 10 minutes (must be < 15 minutes)
    const expiresAt = this.clock.offsetSeconds(600);
    const nonce = this.idGenerator.nonceHex(32);

    const policyHashResult = hashPolicy(policy);
    if (!policyHashResult.ok) {
      return err({
        kind: "MANDATE_BUILD_FAILED",
        message: "Failed to hash policy document",
        details: policyHashResult.error,
      });
    }

    const mandateResult = buildCartMandate({
      id: mandateId,
      correlationId: correlationId as Uuid,
      principalId: input.principalId,
      agent: { id: agentId, model: "gemini-1.5-pro" },
      payee: proposal.payee,
      payment: proposal.payment,
      items: proposal.items,
      promptPlayback: proposal.promptPlayback,
      policy: { id: policy.id, hash: policyHashResult.value },
      validity: { notBefore, expiresAt },
      nonce,
    });

    if (!mandateResult.ok) {
      return err({
        kind: "MANDATE_BUILD_FAILED",
        message: `Failed to build Cart Mandate: ${mandateResult.error.message}`,
        details: mandateResult.error,
      });
    }

    const { terms, hash } = mandateResult.value;

    // 5. Attest Mandate with Authority and Merchant Keys
    const attestations: Attestation[] = [];
    if (this.authorityKeyPair) {
      const attestationResult = attestMandate(
        "AUTHORITY",
        hash as Hash,
        this.authorityKeyPair.privateKey,
        this.authorityKeyPair.publicKey,
      );
      if (attestationResult.ok) {
        attestations.push(attestationResult.value);
      }
    }
    if (this.merchantKeyPair) {
      const attestationResult = attestMandate(
        "MERCHANT",
        hash as Hash,
        this.merchantKeyPair.privateKey,
        this.merchantKeyPair.publicKey,
      );
      if (attestationResult.ok) {
        attestations.push(attestationResult.value);
      }
    }

    // 6. Persist Mandate
    const storedRecord: StoredMandateRecord = {
      terms,
      hash,
      attestations,
      status: "ISSUED",
    };

    try {
      await this.mandateRepo.createMandate({
        id: mandateId,
        kind: "CART",
        correlationId,
        principalId: input.principalId,
        agentId,
        terms,
        hash,
        attestations,
        status: "ISSUED",
        expiresAt,
        createdAt: notBefore,
      });
    } catch (dbError) {
      return err({
        kind: "PERSISTENCE_FAILED",
        message: `Failed to persist Cart Mandate: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
        details: dbError,
      });
    }

    // 7. Atomic Evidence Ledger Recording
    if (this.appendLedgerEvent) {
      await this.appendLedgerEvent.execute({
        correlationId,
        type: "PROPOSAL_CREATED",
        actor: { type: "agent", id: agentId },
        payload: {
          mandateId,
          mandateHash: hash,
          proposal,
          prompt: input.prompt,
        },
      });

      await this.appendLedgerEvent.execute({
        correlationId,
        type: "MANDATE_ISSUED",
        actor: { type: "system", id: "authority" },
        payload: {
          mandateId,
          mandateHash: hash,
          terms,
        },
      });
    }

    const products: ProposedProductView[] = [];
    for (const item of proposal.items) {
      const seen = recordingCatalog.seen.get(item.sku);
      if (seen) products.push(toProductView(seen));
    }

    return ok({
      mandate: storedRecord,
      proposal,
      evaluation,
      products,
    });
  }
}
