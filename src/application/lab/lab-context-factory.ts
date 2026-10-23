/**
 * Lab Context Factory.
 *
 * Instantiates deterministic in-memory context for running security lab scenarios.
 * ARCHITECTURE.md §5, §6
 * INVARIANTS: I-01, I-02, I-03, I-04, I-05, I-07, I-09, I-11.
 */

import { generateDeterministicKeys, createStandardPolicy } from "./fixtures.js";
import { InstrumentedPaymentProvider } from "./instrumented-payment-provider.js";
import type { LabContext } from "./types.js";
import type { Clock, IdGenerator } from "../../domain/shared/clock.js";
import type { MandateRepo, StoredMandateConsent } from "../ports/mandate-repo.js";
import type {
  PaymentMandateRepo,
  StoredPaymentMandateRecord,
  PaymentMandateStatus,
} from "../ports/payment-mandate-repo.js";
import type {
  PasskeyRepo,
  StoredPrincipal,
  StoredWebAuthnChallenge,
  StoredPasskeyCredential,
} from "../ports/passkey-repo.js";
import type { StoredMandateRecord } from "../../domain/gate/index.js";
import type { PolicyDocument } from "../../domain/policy/policy.js";
import type { UnitOfWork, TxContext } from "../ports/unit-of-work.js";
import type { LedgerRepo } from "../ports/ledger-repo.js";
import type { LedgerEvent, ChainHead } from "../../domain/ledger/index.js";
import { AppendLedgerEvent } from "../usecases/append-ledger-event.js";

class InMemoryLedgerRepo implements LedgerRepo {
  private events: LedgerEvent[] = [];

  async lockCorrelation(_correlationId: string): Promise<void> {}

  async getHead(correlationId: string): Promise<ChainHead | null> {
    const list = this.events.filter((e) => e.correlationId === correlationId);
    if (list.length === 0) return null;
    const last = list[list.length - 1];
    if (!last) return null;
    return { seq: last.seq, hash: last.hash };
  }

  async append(event: LedgerEvent): Promise<void> {
    this.events.push(event);
  }

  async getEvents(correlationId: string): Promise<readonly LedgerEvent[]> {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  async getAllHeads(): Promise<ReadonlyArray<{ correlationId: string; headHash: string }>> {
    const map = new Map<string, string>();
    for (const ev of this.events) {
      map.set(ev.correlationId, ev.hash);
    }
    return Array.from(map.entries()).map(([correlationId, headHash]) => ({
      correlationId,
      headHash,
    }));
  }
}

class InMemoryMandateRepo implements MandateRepo {
  public mandates: Map<string, StoredMandateRecord> = new Map();
  public policies: Map<string, PolicyDocument> = new Map();
  public consents: Map<string, StoredMandateConsent> = new Map();

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

class InMemoryPaymentMandateRepo implements PaymentMandateRepo {
  public records: Map<string, StoredPaymentMandateRecord> = new Map();

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

  async lockPaymentMandate(_id: string): Promise<void> {}

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
      paypalOrderId?: string | undefined;
      captureRequestId?: string | undefined;
      paypalCaptureId?: string | undefined;
    },
  ): Promise<void> {
    const existing = this.records.get(id);
    if (existing) {
      this.records.set(id, {
        ...existing,
        status: update.status,
        paypalOrderId: (update.paypalOrderId ?? existing.paypalOrderId) as string | null,
        captureRequestId: (update.captureRequestId ?? existing.captureRequestId) as string | null,
        paypalCaptureId: (update.paypalCaptureId ?? existing.paypalCaptureId) as string | null,
      });
    }
  }
}

class InMemoryPasskeyRepo implements PasskeyRepo {
  principals = new Map<string, StoredPrincipal>();
  challenges = new Map<string, StoredWebAuthnChallenge>();
  credentials = new Map<string, StoredPasskeyCredential>();

  async findPrincipalById(id: string): Promise<StoredPrincipal | null> {
    return this.principals.get(id) ?? null;
  }

  async createPrincipal(principal: {
    id: string;
    displayName: string;
    createdAt: string;
  }): Promise<StoredPrincipal> {
    const record: StoredPrincipal = { ...principal };
    this.principals.set(principal.id, record);
    return record;
  }

  async saveChallenge(challenge: {
    id: string;
    challenge: string;
    purpose: "registration" | "authentication" | "consent";
    principalId?: string | undefined;
    expiresAt: string;
    createdAt: string;
  }): Promise<StoredWebAuthnChallenge> {
    const record: StoredWebAuthnChallenge = { ...challenge };
    this.challenges.set(challenge.challenge, record);
    return record;
  }

  async findAndConsumeChallenge(challenge: string): Promise<StoredWebAuthnChallenge | null> {
    const record = this.challenges.get(challenge);
    if (!record) return null;
    this.challenges.delete(challenge);
    return record;
  }

  async findCredentialByCredentialId(
    credentialId: string,
  ): Promise<StoredPasskeyCredential | null> {
    return this.credentials.get(credentialId) ?? null;
  }

  async listCredentialsByPrincipalId(principalId: string): Promise<StoredPasskeyCredential[]> {
    return Array.from(this.credentials.values()).filter((c) => c.principalId === principalId);
  }

  async saveCredential(credential: {
    id: string;
    principalId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports?: string[] | undefined;
    createdAt: string;
  }): Promise<StoredPasskeyCredential> {
    const record: StoredPasskeyCredential = { ...credential };
    this.credentials.set(credential.credentialId, record);
    return record;
  }

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    const existing = this.credentials.get(credentialId);
    if (existing) {
      this.credentials.set(credentialId, { ...existing, counter });
    }
  }
}

class FakeUnitOfWork implements UnitOfWork {
  constructor(
    private readonly ledger: InMemoryLedgerRepo,
    private readonly mandates: InMemoryMandateRepo,
    private readonly paymentMandates: InMemoryPaymentMandateRepo,
  ) {}

  async run<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return fn({
      ledger: this.ledger,
      mandates: this.mandates,
      paymentMandates: this.paymentMandates,
    });
  }
}

export function createDeterministicLabContext(clock: Clock, idGenerator: IdGenerator): LabContext {
  const keys = generateDeterministicKeys();

  const ledgerRepo = new InMemoryLedgerRepo();
  const mandateRepo = new InMemoryMandateRepo();
  const paymentMandateRepo = new InMemoryPaymentMandateRepo();
  const passkeyRepo = new InMemoryPasskeyRepo();

  const { policy } = createStandardPolicy();
  mandateRepo.policies.set(policy.id, policy);
  mandateRepo.policies.set("policy-default", policy);
  const uow = new FakeUnitOfWork(ledgerRepo, mandateRepo, paymentMandateRepo);
  const appendLedgerEvent = new AppendLedgerEvent(clock, idGenerator, uow);

  const paymentProvider = new InstrumentedPaymentProvider("ORDER-LAB-MOCK-1234");

  return {
    clock,
    idGenerator,
    mandateRepo,
    paymentMandateRepo,
    passkeyRepo,
    ledgerRepo,
    unitOfWork: uow,
    appendLedgerEvent,
    paymentProvider,
    trustedKeys: keys.trustedKeys,
    authorityKeyPair: keys.authorityKeyPair,
    merchantKeyPair: keys.merchantKeyPair,
  };
}
