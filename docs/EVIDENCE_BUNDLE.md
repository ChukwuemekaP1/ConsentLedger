# Evidence Bundle and Offline Verifier (v1)

ConsentLedger transactions export into portable, self-verifying evidence bundles. An independent auditor, merchant, buyer or dispute investigator can verify the end-to-end cryptographic and state integrity of any transaction offline without contacting the ConsentLedger application server or database, and without holding private keys.

This implements **Invariant I-09** ("Evidence verifies offline") and **Invariant I-04** ("Tamper-evident ledger").

---

## 1. Trust Model

An offline verifier must not rely on trust claims asserted solely within the bundle being verified. Otherwise, an adversary who fabricated a fraudulent bundle could generate their own key pair, sign the fake bundle, embed their public key, and claim authenticity.

### Root of Trust: The Trust Store

The verifier accepts an independent `trust-store.json` specifying authoritative public keys:

```jsonc
{
  "version": 1,
  "trustedKeys": [
    {
      "keyId": "dd88cfe5a543d49ed89ef947d34be20c32ba493f61921f00fa8e62d473489112",
      "role": "AUTHORITY",
      "publicKeyJwk": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "...",
      },
      "description": "ConsentLedger Gateway Primary Authority Key",
    },
    {
      "keyId": "5a27891cf237a67123985b8813bc32e1858e8b3985ec92f08a98d36184a413d7",
      "role": "MERCHANT",
      "publicKeyJwk": {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": "...",
      },
      "merchantId": "merchant-tech-store",
      "description": "Tech Store Certified Merchant Agent Key",
    },
  ],
}
```

- **Authority Key**: Verifies gateway attestations on mandates, derived payment mandates, Merkle checkpoints, and provider snapshot captures.
- **Merchant Key**: Verifies counter-signatures on Cart mandates (ADR-0002).
- **Key Rotation**: The trust store supports multiple keys per role. As long as an attestation matches a key in the trust store, verification succeeds.
- **Fail-Closed**: If no trust store is provided or if a key is not present in the trust store, the verifier rejects the bundle with `AUTHORITY_KEY_UNTRUSTED` or `MERCHANT_KEY_UNTRUSTED`.

---

## 2. Bundle Schema (`v1`)

```jsonc
{
  "bundleVersion": 1,
  "generatedAt": "2026-10-15T12:00:00.000Z",
  "correlationId": "d5f309b6-8575-4d6b-bd85-056345ec48f5",
  "authority": {
    "keyId": "<64-hex-spki-sha256-thumbprint>",
    "publicKeyJwk": {/* ... */},
  },
  "principal": {
    "id": "p-12345678-1234-4000-8000-1234567890ab",
    "credentials": [
      {
        "credentialId": "cred-passkey-1",
        "publicKeySpkiB64": "<base64-der-spki>",
        "alg": -7,
        "rpId": "localhost",
        "origin": "http://localhost:3000",
      },
    ],
  },
  "mandates": [
    {
      "id": "m-12345678-1234-4000-8000-1234567890ab",
      "terms": {
        "kind": "CART",
        "mandateId": "m-12345678-1234-4000-8000-1234567890ab",
        "principalId": "p-12345678-1234-4000-8000-1234567890ab",
        "agentId": "agent-gemini-1",
        "amountMinor": 4999,
        "currency": "USD",
        "merchant": { "id": "m-1", "name": "Tech Store" },
        "items": [/* ... */],
        "nonce": "<64-hex-entropy>",
        "validity": { "notBefore": "...", "expiresAt": "..." },
        "policy": { "pinnedHash": "...", "stepUpAboveMinor": 10000 },
      },
      "hash": "<sha256-hex-of-canonical-terms>",
      "attestations": [
        { "role": "AUTHORITY", "keyId": "...", "signature": "<base64url-ed25519>" },
        { "role": "MERCHANT", "keyId": "...", "signature": "<base64url-ed25519>" },
      ],
      "consent": {
        "credentialId": "cred-passkey-1",
        "authenticatorData": "<base64url>",
        "clientDataJSON": "<base64url>",
        "signature": "<base64url>",
        "verifiedAt": "2026-10-15T12:00:00.000Z",
      },
    },
  ],
  "paymentMandates": [
    {
      "id": "pm-1",
      "mandateId": "m-12345678-1234-4000-8000-1234567890ab",
      "sequence": 1,
      "terms": {
        "mandateId": "m-12345678-1234-4000-8000-1234567890ab",
        "sequence": 1,
        "amountMinor": 4999,
        "currency": "USD",
        "merchant": { "id": "m-1", "name": "Tech Store" },
      },
      "hash": "<sha256-hex-of-canonical-terms>",
      "authoritySignature": "<base64url-ed25519>",
    },
  ],
  "ledger": {
    "events": [
      {
        "seq": 1,
        "id": "...",
        "correlationId": "...",
        "type": "PROPOSAL_CREATED",
        "actor": { "type": "system", "id": "gateway" },
        "payload": {/* ... */},
        "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
        "hash": "...",
        "createdAt": "...",
      },
    ],
    "checkpoint": {
      "size": 1,
      "root": "<64-hex-merkle-root>",
      "signature": "<base64url-ed25519-over-root>",
      "keyId": "...",
      "createdAt": "...",
    },
    "inclusionProof": {
      "leafIndex": 0,
      "steps": [/* ... */],
    },
  },
  "provider": {
    "paypalOrderId": "ORDER-12345",
    "paypalCaptureIds": ["CAPTURE-12345"],
    "snapshots": [
      {
        "source": "orders.get",
        "fetchedAt": "2026-10-15T12:05:00.000Z",
        "body": {/* PayPal Orders v2 JSON */},
        "snapshotHash": "<sha256-hex-canonical-body>",
        "authoritySignature": "<base64url-ed25519-over-hash>",
      },
    ],
  },
}
```

---

## 3. The 9 Verification Checks (V0 to V8)

| Check  | Name                                     | What It Verifies                                                                                                                                                                                                                                                                             |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V0** | **Schema & Version Integrity**           | Bundle conforms to Zod `evidenceBundleSchema`, `bundleVersion === 1`, and trust store conforms to `trustStoreSchema`.                                                                                                                                                                        |
| **V1** | **Mandate Hash & Parent Binding**        | `sha256(canonical(terms)) === hash` for all mandates and payment mandates. Payment mandates match parent terms (CART amounts match exactly; INTENT spends fit within limits).                                                                                                                |
| **V2** | **Attestation Signatures & Trust Store** | Authority and Merchant Ed25519 signatures over mandate hashes verify under trusted keys in `trustStore`. SPKI SHA-256 thumbprints match `keyId`.                                                                                                                                             |
| **V3** | **Passkey Consent Verification**         | Pure domain WebAuthn verification (I-05, ADR-0008): `clientDataJSON.type === "webauthn.get"`, `clientDataJSON.challenge === mandate.hash`, `origin` and `rpId` match, `UP === 1`, `UV === 1` (user verified required), and cryptographic signature verifies under the credential public key. |
| **V4** | **Ledger Chain Integrity**               | Sequence is contiguous from 1 (`seq = 1..N`), all events share `correlationId`, first event `prevHash` is 64 zeros, each event `prevHash` matches previous event's `hash`, and each event hash recomputes correctly over canonical fields (I-04).                                            |
| **V5** | **Checkpoint & Merkle Proof**            | Checkpoint authority signature over `root` verifies under trusted key. Merkle inclusion proof correctly computes from `leafHash(correlationId, headHash)` to the checkpoint root.                                                                                                            |
| **V6** | **Payment Terms & Provider Consistency** | Payment mandate `amountMinor` and `currency` match the captured amount and currency in the provider snapshot.                                                                                                                                                                                |
| **V7** | **Provider Snapshot Attestation**        | Snapshot canonical hash recomputes, and authority signature over `snapshotHash` verifies under trusted key.                                                                                                                                                                                  |
| **V8** | **State Machine Consistency**            | Event sequence enforces state machine laws: no order created without prior passkey consent (I-01), no capture without created order.                                                                                                                                                         |

---

## 4. CLI Usage

### Basic Command

```bash
pnpm verify:bundle --bundle <path-to-bundle.json> --trust-store <path-to-trust-store.json>
```

Alternatively, use positional arguments:

```bash
pnpm verify:bundle <path-to-bundle.json> <path-to-trust-store.json>
```

### Exit Codes

- **`0`**: **VERIFIED VALID OFFLINE**. All checks (V0 through V8) passed.
- **`1`**: **VERIFICATION FAILED**. Malformed schema, invalid signature, broken hash chain, tampered terms, untrusted key, or file not found.

### Example Success Output

```
================================================================================
  CONSENTLEDGER OFFLINE EVIDENCE VERIFIER (v1)
================================================================================
  Bundle:       bundle.json
  Trust Store:  trust-store.json
--------------------------------------------------------------------------------
  [PASS]   V0: Schema & Version Integrity
           Bundle v1 schema validated; correlationId=d5f309b6-8575-4d6b-bd85-056345ec48f5
  [PASS]   V1: Mandate Hash & Parent Binding
           1 mandate(s) and 1 payment mandate(s) re-hashed and bound
  [PASS]   V2: Attestation Signatures & Trust Store
           All authority and merchant attestations verified against independent trust store
  [PASS]   V3: Passkey Consent Verification
           1 passkey consent assertion(s) verified (UP=1, UV=1, bound to mandate hash)
  [PASS]   V4: Ledger Chain Integrity
           Chain head a7c46126292dfe44... verified across 4 event(s)
  [PASS]   V5: Checkpoint & Merkle Inclusion
           Checkpoint root 40d6278dd53a6f4a... and Merkle inclusion proof verified under authority key
  [PASS]   V6: Payment Terms & Provider Consistency
           Payment mandate terms match 1 provider snapshot(s)
  [PASS]   V7: Provider Snapshot Attestation
           1 provider snapshot(s) verified under authority signature. (Note: Proves server fetch attestation; does not independently verify PayPal internal servers offline).
  [PASS]   V8: State Machine Consistency
           Event ordering matches state machine rules (proposal -> mandate -> consent -> order -> capture)
--------------------------------------------------------------------------------
  RESULT: VERIFIED VALID OFFLINE
  Correlation ID: d5f309b6-8575-4d6b-bd85-056345ec48f5
  Summary:        All offline cryptographic and state consistency checks passed successfully.

  NOTICE: Offline verification proves cryptographic integrity, passkey consent
  binding, and ledger consistency. It does NOT prove external merchant fulfillment
  or independent PayPal server state.
================================================================================
```

---

## 5. Security & Limitations

1. **Self-Contained Verification**: The verifier imports only pure domain modules and `node:crypto`. It makes zero network calls and touches no database.
2. **Honest Limits on Provider Proofs**: The verifier proves that the gateway authority attested having fetched a specific PayPal snapshot at a recorded timestamp. The verifier **cannot and does not claim** to independently verify PayPal's internal truth offline without contacting PayPal.
3. **No Private Secrets in Bundles**: Evidence bundles contain public keys, signatures, terms, and hashes. They contain no private keys, client secrets, API keys, or session tokens.
