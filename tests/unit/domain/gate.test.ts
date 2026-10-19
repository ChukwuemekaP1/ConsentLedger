/**
 * Tests for src/domain/gate — evaluateGate()
 *
 * Proves I-01: GateApproval cannot be constructed outside domain/gate.
 * Proves I-11: fail-closed on every unknown/missing input.
 * Proves I-05: consent must match the mandate hash.
 *
 * One denial test per check, in documented order.
 * Check ordering: an input failing check 3 AND 6 reports check 3.
 * Happy path: cart and intent mandates.
 * Policy drift test.
 * Replay test.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  evaluateGate,
  type GateInput,
  type TrustedKeys,
  type StoredMandateRecord,
  type BudgetSnapshot,
  type IntentSpendRequest,
} from "../../../src/domain/gate/index.js";
import {
  buildCartMandate,
  buildIntentMandate,
  attestMandate,
  type CartMandateTerms,
  type IntentMandateTerms,
  type Attestation,
} from "../../../src/domain/mandate/index.js";
import {
  evaluatePolicy,
  hashPolicy,
  type PolicyDocument,
} from "../../../src/domain/policy/index.js";
import { keyId as computeKeyId } from "../../../src/domain/crypto/signing.js";
import { makeVerifiedConsent } from "../../fakes/make-verified-consent.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";
import type { Timestamp, Uuid } from "../../../src/domain/shared/clock.js";
import type { Hash } from "../../../src/domain/crypto/hash.js";

// ─── Test setup ───────────────────────────────────────────────────────────────

let authorityPrivKey: KeyObject;
let authorityPubKey: KeyObject;
let merchantPrivKey: KeyObject;
let merchantPubKey: KeyObject;
let authorityKeyId: string;
let merchantKeyId: string;

const ids = new SequentialIdGenerator("f");

const T0 = "2026-10-20T10:00:00.000Z" as Timestamp;
const T_NOW = "2026-10-20T10:02:00.000Z" as Timestamp; // within window
const T5 = "2026-10-20T10:05:00.000Z" as Timestamp;
const T30D = "2026-11-19T10:00:00.000Z" as Timestamp;

beforeAll(() => {
  const authPair = generateKeyPairSync("ed25519");
  authorityPrivKey = authPair.privateKey;
  authorityPubKey = authPair.publicKey;
  authorityKeyId = computeKeyId(authorityPubKey);

  const merchPair = generateKeyPairSync("ed25519");
  merchantPrivKey = merchPair.privateKey;
  merchantPubKey = merchPair.publicKey;
  merchantKeyId = computeKeyId(merchantPubKey);
});

function makeTrustedKeys(): TrustedKeys {
  return new Map([
    [authorityKeyId, { role: "AUTHORITY" as const, publicKey: authorityPubKey }],
    [merchantKeyId, { role: "MERCHANT" as const, publicKey: merchantPubKey }],
  ]);
}

function makePolicy(overrides: Partial<PolicyDocument["rules"]> = {}): PolicyDocument {
  return { id: "policy-v1", version: 1, rules: { maxPerTxMinor: 100000, ...overrides } };
}

// Build a signed cart mandate with all required attestations
function buildSignedCartMandate(
  overrides: { notBefore?: Timestamp; expiresAt?: Timestamp; amountMinor?: number } = {},
) {
  const input = {
    id: ids.uuid(),
    correlationId: ids.uuid(),
    principalId: "principal-1",
    agent: { id: "agent-1", model: "gemini-1.5-pro" },
    payee: { merchantId: "shopx", displayName: "ShopX" },
    payment: { amountMinor: overrides.amountMinor ?? 8500, currency: "USD" as const },
    items: [
      {
        sku: "KB-75",
        description: "keyboard",
        quantity: 1,
        unitAmountMinor: overrides.amountMinor ?? 8500,
      },
    ],
    promptPlayback: "Buy keyboard",
    policy: { id: "policy-v1", hash: "" as string },
    validity: { notBefore: overrides.notBefore ?? T0, expiresAt: overrides.expiresAt ?? T5 },
    nonce: "n".repeat(64),
  };

  const policy = makePolicy();
  const ph = hashPolicy(policy);
  if (!ph.ok) throw new Error("policy hash failed");
  input.policy = { id: "policy-v1", hash: ph.value };

  const built = buildCartMandate(input);
  if (!built.ok) throw new Error(`Cart build failed: ${JSON.stringify(built.error)}`);

  const authAtt = attestMandate(
    "AUTHORITY",
    built.value.hash as Hash,
    authorityPrivKey,
    authorityPubKey,
  );
  const merchAtt = attestMandate(
    "MERCHANT",
    built.value.hash as Hash,
    merchantPrivKey,
    merchantPubKey,
  );
  if (!authAtt.ok || !merchAtt.ok) throw new Error("attestation failed");

  return {
    terms: built.value.terms,
    hash: built.value.hash,
    attestations: [authAtt.value, merchAtt.value],
  };
}

// Build a signed intent mandate
function buildSignedIntentMandate() {
  const policy = makePolicy();
  const ph = hashPolicy(policy);
  if (!ph.ok) throw new Error("policy hash failed");

  const input = {
    id: ids.uuid(),
    correlationId: ids.uuid(),
    principalId: "principal-1",
    agent: { id: "agent-1", model: "gemini-1.5-pro" },
    scope: { merchantIds: ["cloudco"], categories: ["cloud-credits"], currency: "USD" as const },
    limits: {
      totalBudgetMinor: 12000,
      perTxMaxMinor: 5000,
      maxTransactions: 6,
      stepUpAboveMinor: 4000,
    },
    promptPlayback: "Handle cloud credits",
    policy: { id: "policy-v1", hash: ph.value },
    validity: { notBefore: T0, expiresAt: T30D },
    nonce: "m".repeat(64),
  };

  const built = buildIntentMandate(input);
  if (!built.ok) throw new Error(`Intent build failed: ${JSON.stringify(built.error)}`);

  const authAtt = attestMandate(
    "AUTHORITY",
    built.value.hash as Hash,
    authorityPrivKey,
    authorityPubKey,
  );
  if (!authAtt.ok) throw new Error("attestation failed");

  return {
    terms: built.value.terms,
    hash: built.value.hash,
    attestations: [authAtt.value],
  };
}

function makeCartGateInput(
  overrides: {
    signed?: ReturnType<typeof buildSignedCartMandate>;
    status?: string;
    consent?: ReturnType<typeof makeVerifiedConsent> | null;
    attestations?: Attestation[];
    trustedKeys?: TrustedKeys;
    now?: Timestamp;
    pinnedPolicy?: PolicyDocument;
    currentPolicy?: PolicyDocument;
    spendRequest?: CartMandateTerms;
    existingPaymentMandateCount?: number;
  } = {},
): GateInput {
  const signed = overrides.signed ?? buildSignedCartMandate();
  const policy = makePolicy();
  const consent =
    overrides.consent !== undefined ? overrides.consent : makeVerifiedConsent(signed.hash);
  return {
    mandate: {
      terms: signed.terms,
      hash: signed.hash,
      attestations: overrides.attestations ?? signed.attestations,
      status: overrides.status ?? "SIGNED",
    },
    consent,
    trustedKeys: overrides.trustedKeys ?? makeTrustedKeys(),
    pinnedPolicy: overrides.pinnedPolicy ?? policy,
    currentPolicy: overrides.currentPolicy ?? policy,
    now: overrides.now ?? T_NOW,
    spendRequest: overrides.spendRequest ?? {
      ...signed.terms,
      payment: signed.terms.payment,
      payee: signed.terms.payee,
    },
    budgetSnapshot: null,
    existingPaymentMandateCount: overrides.existingPaymentMandateCount ?? 0,
    sequence: 1,
    paymentMandateId: ids.uuid(),
  };
}

function makeIntentGateInput(
  overrides: {
    signed?: ReturnType<typeof buildSignedIntentMandate>;
    status?: string;
    consent?: ReturnType<typeof makeVerifiedConsent> | null;
    attestations?: Attestation[];
    trustedKeys?: TrustedKeys;
    now?: Timestamp;
    pinnedPolicy?: PolicyDocument;
    currentPolicy?: PolicyDocument;
    spendRequest?: IntentSpendRequest;
    budgetSnapshot?: BudgetSnapshot | null;
    existingPaymentMandateCount?: number;
  } = {},
): GateInput {
  const signed = overrides.signed ?? buildSignedIntentMandate();
  const policy = makePolicy();
  const consent =
    overrides.consent !== undefined ? overrides.consent : makeVerifiedConsent(signed.hash);
  const defaultBudget: BudgetSnapshot = {
    totalBudgetMinor: 12000,
    spentMinor: 0,
    reservedMinor: 0,
    txCount: 0,
    maxTransactions: 6,
    perTxMaxMinor: 5000,
  };
  return {
    mandate: {
      terms: signed.terms,
      hash: signed.hash,
      attestations: overrides.attestations ?? signed.attestations,
      status: overrides.status ?? "ACTIVE",
    },
    consent,
    trustedKeys: overrides.trustedKeys ?? makeTrustedKeys(),
    pinnedPolicy: overrides.pinnedPolicy ?? policy,
    currentPolicy: overrides.currentPolicy ?? policy,
    now: overrides.now ?? T_NOW,
    spendRequest: overrides.spendRequest ?? {
      merchantId: "cloudco",
      amountMinor: 3000,
      currency: "USD",
    },
    budgetSnapshot:
      overrides.budgetSnapshot !== undefined ? overrides.budgetSnapshot : defaultBudget,
    existingPaymentMandateCount: overrides.existingPaymentMandateCount ?? 0,
    sequence: 1,
    paymentMandateId: ids.uuid(),
  };
}

// ─── Check 1: Status ──────────────────────────────────────────────────────────

describe("Gate check 1: mandate status", () => {
  it("denies DRAFTED status with MANDATE_STATE_INVALID", () => {
    const input = makeCartGateInput({ status: "DRAFTED" });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MANDATE_STATE_INVALID");
      expect(r.error.check).toBe(1);
    }
  });

  it("denies REVOKED status with MANDATE_REVOKED", () => {
    const input = makeCartGateInput({ status: "REVOKED" });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MANDATE_REVOKED");
      expect(r.error.check).toBe(1);
    }
  });

  it("denies ISSUED (not yet consented) with MANDATE_STATE_INVALID", () => {
    const input = makeCartGateInput({ status: "ISSUED" });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MANDATE_STATE_INVALID");
      expect(r.error.check).toBe(1);
    }
  });
});

// ─── Check 2: Validity ────────────────────────────────────────────────────────

describe("Gate check 2: validity window", () => {
  it("denies when now is past expiresAt with MANDATE_EXPIRED", () => {
    const input = makeCartGateInput({
      now: "2026-10-20T10:06:00.000Z" as Timestamp, // after T5
    });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MANDATE_EXPIRED");
      expect(r.error.check).toBe(2);
    }
  });

  it("denies when now is before notBefore with MANDATE_EXPIRED", () => {
    const input = makeCartGateInput({
      now: "2026-10-19T09:00:00.000Z" as Timestamp,
    });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MANDATE_EXPIRED");
      expect(r.error.check).toBe(2);
    }
  });
});

// ─── Check 3: Hash mismatch ───────────────────────────────────────────────────

describe("Gate check 3: hash integrity", () => {
  it("denies when stored hash does not match recomputed hash with HASH_MISMATCH", () => {
    const signed = buildSignedCartMandate();
    const policy = makePolicy();
    // Tamper the stored hash (but keep terms intact)
    const input: GateInput = {
      mandate: {
        terms: signed.terms,
        hash: "a".repeat(64), // wrong hash
        attestations: signed.attestations,
        status: "SIGNED",
      },
      consent: makeVerifiedConsent("a".repeat(64)),
      trustedKeys: makeTrustedKeys(),
      pinnedPolicy: policy,
      currentPolicy: policy,
      now: T_NOW,
      spendRequest: signed.terms,
      budgetSnapshot: null,
      existingPaymentMandateCount: 0,
      sequence: 1,
      paymentMandateId: ids.uuid(),
    };
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("HASH_MISMATCH");
      expect(r.error.check).toBe(3);
    }
  });

  it("check 3 fires before check 6: input failing both reports check 3", () => {
    const signed = buildSignedCartMandate();
    const policy = makePolicy();
    const stricterPolicy = makePolicy({ maxPerTxMinor: 1 }); // check 6 would fire
    const input: GateInput = {
      mandate: {
        terms: signed.terms,
        hash: "b".repeat(64), // wrong hash triggers check 3
        attestations: signed.attestations,
        status: "SIGNED",
      },
      consent: makeVerifiedConsent("b".repeat(64)),
      trustedKeys: makeTrustedKeys(),
      pinnedPolicy: policy,
      currentPolicy: stricterPolicy,
      now: T_NOW,
      spendRequest: signed.terms,
      budgetSnapshot: null,
      existingPaymentMandateCount: 0,
      sequence: 1,
      paymentMandateId: ids.uuid(),
    };
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.check).toBe(3); // not 6
    }
  });
});

// ─── Check 4: Attestations ────────────────────────────────────────────────────

describe("Gate check 4: attestations", () => {
  it("denies missing AUTHORITY attestation with AUTHORITY_SIGNATURE_INVALID", () => {
    const signed = buildSignedCartMandate();
    const noAuthAtts = signed.attestations.filter((a) => a.role !== "AUTHORITY");
    const input = makeCartGateInput({ signed, attestations: noAuthAtts });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("AUTHORITY_SIGNATURE_INVALID");
      expect(r.error.check).toBe(4);
    }
  });

  it("denies missing MERCHANT attestation on a cart with MERCHANT_SIGNATURE_INVALID", () => {
    const signed = buildSignedCartMandate();
    const policy = makePolicy();
    const noMerchantAtts = signed.attestations.filter((a) => a.role !== "MERCHANT");
    const input: GateInput = {
      mandate: {
        terms: signed.terms,
        hash: signed.hash,
        attestations: noMerchantAtts,
        status: "SIGNED",
      },
      consent: makeVerifiedConsent(signed.hash),
      trustedKeys: makeTrustedKeys(),
      pinnedPolicy: policy,
      currentPolicy: policy,
      now: T_NOW,
      spendRequest: signed.terms,
      budgetSnapshot: null,
      existingPaymentMandateCount: 0,
      sequence: 1,
      paymentMandateId: ids.uuid(),
    };
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MERCHANT_SIGNATURE_INVALID");
      expect(r.error.check).toBe(4);
    }
  });

  it("denies invalid AUTHORITY signature with AUTHORITY_SIGNATURE_INVALID", () => {
    const signed = buildSignedCartMandate();
    const corruptedAtts = signed.attestations.map((a) =>
      a.role === "AUTHORITY"
        ? {
            ...a,
            signature:
              "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }
        : a,
    );
    const input = makeCartGateInput({ signed, attestations: corruptedAtts });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("AUTHORITY_SIGNATURE_INVALID");
      expect(r.error.check).toBe(4);
    }
  });

  it("denies when merchant key is used for authority role (role scoping)", () => {
    const signed = buildSignedCartMandate();
    // Swap the authority attestation's keyId to the merchant's
    const swappedAtts = signed.attestations.map((a) =>
      a.role === "AUTHORITY" ? { ...a, keyId: merchantKeyId } : a,
    );
    // Supply keys where merchant key is tagged MERCHANT only
    const strictKeys: TrustedKeys = new Map([
      [authorityKeyId, { role: "AUTHORITY" as const, publicKey: authorityPubKey }],
      [merchantKeyId, { role: "MERCHANT" as const, publicKey: merchantPubKey }],
    ]);
    const input = makeCartGateInput({ signed, attestations: swappedAtts, trustedKeys: strictKeys });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("AUTHORITY_SIGNATURE_INVALID");
      expect(r.error.check).toBe(4);
    }
  });

  it("denies when authority key is used for merchant role (role scoping)", () => {
    const signed = buildSignedCartMandate();
    const swappedAtts = signed.attestations.map((a) =>
      a.role === "MERCHANT" ? { ...a, keyId: authorityKeyId } : a,
    );
    const strictKeys: TrustedKeys = new Map([
      [authorityKeyId, { role: "AUTHORITY" as const, publicKey: authorityPubKey }],
      [merchantKeyId, { role: "MERCHANT" as const, publicKey: merchantPubKey }],
    ]);
    const input = makeCartGateInput({ signed, attestations: swappedAtts, trustedKeys: strictKeys });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MERCHANT_SIGNATURE_INVALID");
      expect(r.error.check).toBe(4);
    }
  });
});

// ─── Check 5: Consent ─────────────────────────────────────────────────────────

describe("Gate check 5: consent", () => {
  it("denies missing consent with CONSENT_MISSING", () => {
    const input = makeCartGateInput({ consent: null });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("CONSENT_MISSING");
      expect(r.error.check).toBe(5);
    }
  });

  it("denies consent for a different hash with CONSENT_INVALID (I-05)", () => {
    const wrongConsent = makeVerifiedConsent("d".repeat(64)); // different hash
    const input = makeCartGateInput({ consent: wrongConsent });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("CONSENT_INVALID");
      expect(r.error.check).toBe(5);
    }
  });
});

// ─── Check 6: Policy ─────────────────────────────────────────────────────────

describe("Gate check 6: policy", () => {
  it("denies when pinned policy hash does not match with POLICY_DRIFT", () => {
    const signed = buildSignedCartMandate();
    const policy = makePolicy();
    // A different policy (different id) — its hash won't match what's in terms
    const wrongPolicy = { ...policy, id: "policy-v99", version: 99 };
    const input = makeCartGateInput({ pinnedPolicy: wrongPolicy });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("POLICY_DRIFT");
      expect(r.error.check).toBe(6);
    }
  });

  it("denies when current policy is stricter than at signing time with POLICY_DRIFT", () => {
    const stricterPolicy = makePolicy({ maxPerTxMinor: 1 }); // only $0.01 allowed, 8500 fails
    const input = makeCartGateInput({ currentPolicy: stricterPolicy });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("POLICY_DRIFT");
      expect(r.error.check).toBe(6);
    }
  });

  it("denies when pinned policy denies with POLICY_DENIED", () => {
    const restrictivePolicy = makePolicy({ maxPerTxMinor: 5000 });
    const ph = hashPolicy(restrictivePolicy);
    if (!ph.ok) throw new Error("hash failed");

    const built = buildCartMandate({
      id: ids.uuid(),
      correlationId: ids.uuid(),
      principalId: "principal-1",
      agent: { id: "agent-1", model: "gemini-1.5-pro" },
      payee: { merchantId: "shopx", displayName: "ShopX" },
      payment: { amountMinor: 8500, currency: "USD" as const },
      items: [{ sku: "KB-75", description: "keyboard", quantity: 1, unitAmountMinor: 8500 }],
      promptPlayback: "Buy keyboard",
      policy: { id: restrictivePolicy.id, hash: ph.value },
      validity: { notBefore: T0, expiresAt: T5 },
      nonce: "n".repeat(64),
    });
    if (!built.ok) throw new Error("build failed");
    const authAtt = attestMandate(
      "AUTHORITY",
      built.value.hash as Hash,
      authorityPrivKey,
      authorityPubKey,
    );
    const merchAtt = attestMandate(
      "MERCHANT",
      built.value.hash as Hash,
      merchantPrivKey,
      merchantPubKey,
    );
    if (!authAtt.ok || !merchAtt.ok) throw new Error("attestation failed");

    const input = makeCartGateInput({
      signed: {
        terms: built.value.terms,
        hash: built.value.hash,
        attestations: [authAtt.value, merchAtt.value],
      },
      pinnedPolicy: restrictivePolicy,
      currentPolicy: restrictivePolicy,
    });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("POLICY_DENIED");
      expect(r.error.check).toBe(6);
    }
  });
});

// ─── Check 7: Terms match ─────────────────────────────────────────────────────

describe("Gate check 7: terms match", () => {
  it("denies cart with wrong amount with TERMS_MISMATCH", () => {
    const signed = buildSignedCartMandate();
    const wrongTerms = {
      ...signed.terms,
      payment: { ...signed.terms.payment, amountMinor: 9999 },
    } as CartMandateTerms;
    const input = makeCartGateInput({ spendRequest: wrongTerms });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TERMS_MISMATCH");
      expect(r.error.check).toBe(7);
    }
  });

  it("denies cart with mismatched currency with TERMS_MISMATCH", () => {
    const signed = buildSignedCartMandate();
    const wrongTerms = {
      ...signed.terms,
      payment: { ...signed.terms.payment, currency: "EUR" as const },
    } as CartMandateTerms;
    const input = makeCartGateInput({ spendRequest: wrongTerms });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TERMS_MISMATCH");
      expect(r.error.check).toBe(7);
    }
  });

  it("denies cart with mismatched payee merchantId with TERMS_MISMATCH", () => {
    const signed = buildSignedCartMandate();
    const wrongTerms = {
      ...signed.terms,
      payee: { ...signed.terms.payee, merchantId: "other-merchant" },
    } as CartMandateTerms;
    const input = makeCartGateInput({ spendRequest: wrongTerms });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TERMS_MISMATCH");
      expect(r.error.check).toBe(7);
    }
  });

  it("denies intent spend with merchant not allowed with MERCHANT_NOT_ALLOWED", () => {
    const signed = buildSignedIntentMandate();
    const spend: IntentSpendRequest = {
      merchantId: "unapproved-merchant",
      amountMinor: 1000,
      currency: "USD",
    };
    const input = makeIntentGateInput({ signed, spendRequest: spend });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MERCHANT_NOT_ALLOWED");
      expect(r.error.check).toBe(7);
    }
  });

  it("denies intent spend with currency not allowed with CURRENCY_NOT_ALLOWED", () => {
    const signed = buildSignedIntentMandate();
    const spend: IntentSpendRequest = {
      merchantId: "cloudco",
      amountMinor: 1000,
      currency: "EUR" as const,
    };
    const input = makeIntentGateInput({ signed, spendRequest: spend });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("CURRENCY_NOT_ALLOWED");
      expect(r.error.check).toBe(7);
    }
  });

  it("denies intent spend exceeding per-transaction cap with TX_CAP_EXCEEDED", () => {
    const signed = buildSignedIntentMandate(); // perTxMaxMinor is 5000
    const spend: IntentSpendRequest = {
      merchantId: "cloudco",
      amountMinor: 5001,
      currency: "USD",
    };
    const input = makeIntentGateInput({ signed, spendRequest: spend });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TX_CAP_EXCEEDED");
      expect(r.error.check).toBe(7);
    }
  });

  it("denies intent spend requiring step-up approval with STEP_UP_REQUIRED", () => {
    const signed = buildSignedIntentMandate(); // stepUpAboveMinor is 4000, perTxMaxMinor is 5000
    const spend: IntentSpendRequest = {
      merchantId: "cloudco",
      amountMinor: 4001,
      currency: "USD",
    };
    const input = makeIntentGateInput({ signed, spendRequest: spend });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("STEP_UP_REQUIRED");
      expect(r.error.check).toBe(7);
    }
  });
});

// ─── Check 8: Single-use / budget ────────────────────────────────────────────

describe("Gate check 8: replay / budget", () => {
  it("denies a replayed cart (existingPaymentMandateCount > 0) with REPLAY_DETECTED", () => {
    const input = makeCartGateInput({ existingPaymentMandateCount: 1 });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("REPLAY_DETECTED");
      expect(r.error.check).toBe(8);
    }
  });

  it("denies intent with exceeded budget with BUDGET_EXCEEDED", () => {
    const signed = buildSignedIntentMandate();
    const policy = makePolicy();
    const budget: BudgetSnapshot = {
      totalBudgetMinor: 12000,
      spentMinor: 11000,
      reservedMinor: 1500, // 11000 + 1500 + 1000 = 13500 > 12000
      txCount: 2,
      maxTransactions: 6,
      perTxMaxMinor: 5000,
    };
    const spend: IntentSpendRequest = { merchantId: "cloudco", amountMinor: 1000, currency: "USD" };
    const input: GateInput = {
      mandate: {
        terms: signed.terms,
        hash: signed.hash,
        attestations: signed.attestations,
        status: "ACTIVE",
      },
      consent: makeVerifiedConsent(signed.hash),
      trustedKeys: makeTrustedKeys(),
      pinnedPolicy: policy,
      currentPolicy: policy,
      now: T_NOW,
      spendRequest: spend,
      budgetSnapshot: budget,
      existingPaymentMandateCount: 2,
      sequence: 3,
      paymentMandateId: ids.uuid(),
    };
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("BUDGET_EXCEEDED");
      expect(r.error.check).toBe(8);
    }
  });

  it("denies intent when transaction count cap is reached with TX_CAP_EXCEEDED", () => {
    const signed = buildSignedIntentMandate();
    const budget: BudgetSnapshot = {
      totalBudgetMinor: 12000,
      spentMinor: 2000,
      reservedMinor: 0,
      txCount: 6, // max reached: 6 >= 6
      maxTransactions: 6,
      perTxMaxMinor: 5000,
    };
    const spend: IntentSpendRequest = { merchantId: "cloudco", amountMinor: 1000, currency: "USD" };
    const input = makeIntentGateInput({ signed, spendRequest: spend, budgetSnapshot: budget });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("TX_CAP_EXCEEDED");
      expect(r.error.check).toBe(8);
    }
  });

  it("prioritizes budget-exceeded failure over transaction-cap failure when both fail in check 8", () => {
    const signed = buildSignedIntentMandate();
    const budget: BudgetSnapshot = {
      totalBudgetMinor: 12000,
      spentMinor: 11500,
      reservedMinor: 0,
      txCount: 6, // also at cap
      maxTransactions: 6,
      perTxMaxMinor: 5000,
    };
    const spend: IntentSpendRequest = { merchantId: "cloudco", amountMinor: 1000, currency: "USD" };
    const input = makeIntentGateInput({ signed, spendRequest: spend, budgetSnapshot: budget });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("BUDGET_EXCEEDED");
      expect(r.error.check).toBe(8);
    }
  });
});

// ─── Check ordering precedence ───────────────────────────────────────────────

describe("Gate check ordering precedence", () => {
  it("check 1 fires before check 2: revoked status with expired validity reports check 1", () => {
    const input = makeCartGateInput({
      status: "REVOKED",
      now: "2026-10-20T10:06:00.000Z" as Timestamp, // expired (check 2)
    });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MANDATE_REVOKED");
      expect(r.error.check).toBe(1);
    }
  });

  it("check 4 fires before check 5: missing attestation and missing consent reports check 4", () => {
    const signed = buildSignedCartMandate();
    const noMerchantAtts = signed.attestations.filter((a) => a.role !== "MERCHANT");
    const input = makeCartGateInput({
      signed,
      attestations: noMerchantAtts,
      consent: null, // missing consent (check 5)
    });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MERCHANT_SIGNATURE_INVALID");
      expect(r.error.check).toBe(4);
    }
  });

  it("check 7 fires before check 8: merchant not allowed and budget exceeded reports check 7", () => {
    const signed = buildSignedIntentMandate();
    const budget: BudgetSnapshot = {
      totalBudgetMinor: 12000,
      spentMinor: 11500,
      reservedMinor: 0,
      txCount: 0,
      maxTransactions: 6,
      perTxMaxMinor: 5000,
    };
    const spend: IntentSpendRequest = {
      merchantId: "unapproved",
      amountMinor: 2000,
      currency: "USD",
    };
    const input = makeIntentGateInput({ signed, spendRequest: spend, budgetSnapshot: budget });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("MERCHANT_NOT_ALLOWED");
      expect(r.error.check).toBe(7);
    }
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("Gate happy path", () => {
  it("approves a valid cart mandate", () => {
    const input = makeCartGateInput();
    const r = evaluateGate(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.paymentMandateTerms.modality).toBe("HP");
    expect(r.value.paymentMandateTerms.payment.amountMinor).toBe(8500);
    expect(r.value.approvedAt).toBe(T_NOW);
  });

  it("approves a valid intent mandate spend", () => {
    const signed = buildSignedIntentMandate();
    const policy = makePolicy();
    const budget: BudgetSnapshot = {
      totalBudgetMinor: 12000,
      spentMinor: 0,
      reservedMinor: 0,
      txCount: 0,
      maxTransactions: 6,
      perTxMaxMinor: 5000,
    };
    const spend: IntentSpendRequest = { merchantId: "cloudco", amountMinor: 3000, currency: "USD" };
    const input: GateInput = {
      mandate: {
        terms: signed.terms,
        hash: signed.hash,
        attestations: signed.attestations,
        status: "ACTIVE",
      },
      consent: makeVerifiedConsent(signed.hash),
      trustedKeys: makeTrustedKeys(),
      pinnedPolicy: policy,
      currentPolicy: policy,
      now: T_NOW,
      spendRequest: spend,
      budgetSnapshot: budget,
      existingPaymentMandateCount: 0,
      sequence: 1,
      paymentMandateId: ids.uuid(),
    };
    const r = evaluateGate(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.paymentMandateTerms.modality).toBe("HNP");
    expect(r.value.paymentMandateTerms.payment.amountMinor).toBe(3000);
  });

  it("approves intent spend at exact step-up threshold boundary without requiring step up", () => {
    const signed = buildSignedIntentMandate(); // stepUpAboveMinor is 4000
    const spend: IntentSpendRequest = { merchantId: "cloudco", amountMinor: 4000, currency: "USD" };
    const input = makeIntentGateInput({ signed, spendRequest: spend });
    const r = evaluateGate(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.paymentMandateTerms.payment.amountMinor).toBe(4000);
  });
});

// ─── Fail-closed tests ────────────────────────────────────────────────────────

describe("Gate fail-closed (I-11)", () => {
  it("denies when no budget snapshot is supplied for an intent mandate", () => {
    const signed = buildSignedIntentMandate();
    const policy = makePolicy();
    const spend: IntentSpendRequest = { merchantId: "cloudco", amountMinor: 1000, currency: "USD" };
    const input: GateInput = {
      mandate: {
        terms: signed.terms,
        hash: signed.hash,
        attestations: signed.attestations,
        status: "ACTIVE",
      },
      consent: makeVerifiedConsent(signed.hash),
      trustedKeys: makeTrustedKeys(),
      pinnedPolicy: policy,
      currentPolicy: policy,
      now: T_NOW,
      spendRequest: spend,
      budgetSnapshot: null, // missing
      existingPaymentMandateCount: 0,
      sequence: 1,
      paymentMandateId: ids.uuid(),
    };
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BUDGET_EXCEEDED");
  });

  it("denies when trusted keys map is empty (no keys to verify against)", () => {
    const input = makeCartGateInput({ trustedKeys: new Map() });
    const r = evaluateGate(input);
    expect(r.ok).toBe(false);
  });
});
