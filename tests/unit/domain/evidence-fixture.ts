/**
 * Test fixture generator for offline evidence bundle verification.
 */

import { generateKeyPairSync, createHash, sign as cryptoSign } from "node:crypto";
import { sha256Hex, ZERO_HASH, type Hash } from "../../../src/domain/crypto/hash.js";
import { canonicalize } from "../../../src/domain/crypto/canonical.js";
import { signHash, keyId, exportPublicJwk } from "../../../src/domain/crypto/signing.js";
import { appendToChain } from "../../../src/domain/ledger/chain.js";
import { leafHash, buildTree, proveInclusion } from "../../../src/domain/ledger/merkle.js";
import type { LedgerEvent } from "../../../src/domain/ledger/events.js";
import type { EvidenceBundle, TrustStore } from "../../../src/domain/evidence/types.js";
import type { Timestamp, Uuid } from "../../../src/domain/shared/clock.js";
import type { CartMandateTerms } from "../../../src/domain/mandate/types.js";

export function createValidBundleFixture() {
  const correlationId = "d5f309b6-8575-4d6b-bd85-056345ec48f5";
  const mandateId = "m-12345678-1234-4000-8000-1234567890ab";
  const principalId = "p-12345678-1234-4000-8000-1234567890ab";
  const agentId = "agent-gemini-1";
  const credentialId = "cred-passkey-1";
  const origin = "http://localhost:3000";
  const rpId = "localhost";
  const now = "2026-10-15T12:00:00.000Z";

  // 1. Generate cryptographic keys
  const authKeys = generateKeyPairSync("ed25519");
  const merchKeys = generateKeyPairSync("ed25519");
  const passkeyKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

  const authKeyId = keyId(authKeys.publicKey);
  const merchKeyId = keyId(merchKeys.publicKey);

  const authJwk = exportPublicJwk(authKeys.publicKey);
  const merchJwk = exportPublicJwk(merchKeys.publicKey);
  const passkeySpkiB64 = passkeyKeys.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

  // 2. Mandate terms & signatures
  const cartTerms: CartMandateTerms = {
    v: 1,
    kind: "CART",
    id: mandateId,
    correlationId,
    principalId,
    agent: {
      id: agentId,
      model: "gemini-2.5-flash",
    },
    payee: {
      merchantId: "merchant-tech-store",
      displayName: "Tech Store",
    },
    payment: {
      amountMinor: 4999,
      currency: "USD",
    },
    items: [
      {
        sku: "item-1",
        description: "USB-C Fast Charger",
        quantity: 1,
        unitAmountMinor: 4999,
      },
    ],
    promptPlayback: "Buy a USB-C fast charger under $50",
    nonce: "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00",
    validity: {
      notBefore: "2026-10-15T11:00:00.000Z",
      expiresAt: "2026-10-15T13:00:00.000Z",
    },
    policy: {
      id: "policy-default",
      hash: "0".repeat(64),
    },
  };

  const cartCanonical = canonicalize(cartTerms);
  if (!cartCanonical.ok) throw new Error("cart terms canonical failed");
  const cartHash = sha256Hex(cartCanonical.value);

  const authAttestationSig = signHash(cartHash as Hash, authKeys.privateKey);
  const merchAttestationSig = signHash(cartHash as Hash, merchKeys.privateKey);
  if (!authAttestationSig.ok || !merchAttestationSig.ok) throw new Error("attestation sign failed");

  // 3. Passkey assertion consent (challenge = cartHash)
  const clientDataObj = {
    type: "webauthn.get",
    challenge: cartHash,
    origin,
  };
  const clientDataRaw = Buffer.from(JSON.stringify(clientDataObj), "utf8");
  const clientDataJSON = clientDataRaw.toString("base64url");

  const rpIdHash = createHash("sha256").update(rpId).digest();
  const flags = 0x01 | 0x04; // UP=1, UV=1
  const signCount = Buffer.alloc(4);
  signCount.writeUInt32BE(1, 0);
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), signCount]);
  const authenticatorData = authData.toString("base64url");

  const clientDataHash = createHash("sha256").update(clientDataRaw).digest();
  const signedConsentPayload = Buffer.concat([authData, clientDataHash]);
  const passkeySignature = cryptoSign(
    "sha256",
    signedConsentPayload,
    passkeyKeys.privateKey,
  ).toString("base64url");

  // 4. Payment mandate
  const paymentTerms = {
    mandateId,
    sequence: 1,
    amountMinor: 4999,
    currency: "USD",
    merchant: {
      id: "merchant-tech-store",
      name: "Tech Store",
      paypalReceiverId: "TECH-PAYPAL-1",
    },
    purpose: "Order checkout",
    idempotencyKey: "idemp-pm-1",
  };
  const paymentCanonical = canonicalize(paymentTerms);
  if (!paymentCanonical.ok) throw new Error("payment terms canonical failed");
  const paymentHash = sha256Hex(paymentCanonical.value);
  const paymentSig = signHash(paymentHash as Hash, authKeys.privateKey);
  if (!paymentSig.ok) throw new Error("payment sig failed");

  // 5. Ledger chain
  let chainHead: { hash: string; seq: number } | null = null;
  const events: LedgerEvent[] = [];

  const rawEvents = [
    { type: "PROPOSAL_CREATED" as const, payload: { mandateId, proposalId: "prop-1" } },
    { type: "CONSENT_RECORDED" as const, payload: { mandateId, credentialId } },
    { type: "PAYPAL_ORDER_CREATED" as const, payload: { mandateId, paypalOrderId: "ORDER-12345" } },
    { type: "CAPTURE_COMPLETED" as const, payload: { mandateId, captureId: "CAPTURE-12345" } },
  ];

  let step = 0;
  for (const raw of rawEvents) {
    const appendRes = appendToChain(
      chainHead,
      {
        correlationId,
        type: raw.type,
        actor: { type: "system", id: "gateway" },
        payload: raw.payload,
      },
      `00000000-0000-4000-8000-00000000000${step + 1}` as Uuid,
      `2026-10-15T12:0${step}:00.000Z` as Timestamp,
    );
    if (!appendRes.ok) throw new Error("chain append failed");
    events.push(appendRes.value);
    chainHead = { hash: appendRes.value.hash, seq: appendRes.value.seq };
    step++;
  }

  // 6. Checkpoint & Merkle inclusion proof
  const lastEvent = events.at(-1);
  if (!lastEvent) throw new Error("no events");
  const leaf = leafHash(correlationId, lastEvent.hash);
  const tree = buildTree([leaf]);
  const root = tree.root;
  const cpSig = signHash(root as Hash, authKeys.privateKey);
  if (!cpSig.ok) throw new Error("cp sign failed");

  const proofRes = proveInclusion(tree, 0);
  if (!proofRes.ok) throw new Error("proof inclusion failed");

  // 7. Provider Snapshot
  const snapshotBody = {
    id: "ORDER-12345",
    status: "COMPLETED",
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: "default",
        amount: {
          currency_code: "USD",
          value: "49.99",
        },
        payments: {
          captures: [
            {
              id: "CAPTURE-12345",
              status: "COMPLETED",
              amount: {
                currency_code: "USD",
                value: "49.99",
              },
            },
          ],
        },
      },
    ],
  };
  const snapCanonical = canonicalize(snapshotBody);
  if (!snapCanonical.ok) throw new Error("snapshot canonical failed");
  const snapshotHash = sha256Hex(snapCanonical.value);
  const snapSig = signHash(snapshotHash as Hash, authKeys.privateKey);
  if (!snapSig.ok) throw new Error("snap sig failed");

  // 8. Assemble complete EvidenceBundle
  const bundle: EvidenceBundle = {
    bundleVersion: 1,
    generatedAt: now,
    correlationId,
    authority: {
      keyId: authKeyId,
      publicKeyJwk: authJwk,
    },
    principal: {
      id: principalId,
      credentials: [
        {
          credentialId,
          publicKeySpkiB64: passkeySpkiB64,
          alg: -7,
          rpId,
          origin,
        },
      ],
    },
    mandates: [
      {
        id: mandateId,
        terms: cartTerms,
        hash: cartHash,
        attestations: [
          { role: "AUTHORITY", keyId: authKeyId, signature: authAttestationSig.value },
          { role: "MERCHANT", keyId: merchKeyId, signature: merchAttestationSig.value },
        ],
        consent: {
          credentialId,
          authenticatorData,
          clientDataJSON,
          signature: passkeySignature,
          verifiedAt: now,
        },
      },
    ],
    merchants: [
      {
        merchantId: "merchant-tech-store",
        keyId: merchKeyId,
        publicKeyJwk: merchJwk,
      },
    ],
    paymentMandates: [
      {
        id: "pm-1",
        mandateId,
        sequence: 1,
        terms: paymentTerms,
        hash: paymentHash,
        authoritySignature: paymentSig.value,
      },
    ],
    ledger: {
      events,
      checkpoint: {
        size: 1,
        root,
        signature: cpSig.value,
        keyId: authKeyId,
        createdAt: now,
      },
      inclusionProof: proofRes.value,
    },
    provider: {
      paypalOrderId: "ORDER-12345",
      paypalCaptureIds: ["CAPTURE-12345"],
      snapshots: [
        {
          source: "orders.get",
          fetchedAt: now,
          body: snapshotBody,
          snapshotHash,
          authoritySignature: snapSig.value,
        },
      ],
    },
  };

  const trustStore: TrustStore = {
    version: 1,
    trustedKeys: [
      {
        role: "AUTHORITY",
        keyId: authKeyId,
        publicKeyJwk: authJwk,
        description: "ConsentLedger Gateway Authority Primary Key",
      },
      {
        role: "MERCHANT",
        keyId: merchKeyId,
        publicKeyJwk: merchJwk,
        merchantId: "merchant-tech-store",
        description: "Tech Store Merchant Signing Key",
      },
    ],
  };

  return { bundle, trustStore, authKeys, merchKeys, passkeyKeys };
}
