# Threat model

Method: STRIDE over the trust boundaries below. Each threat names a mitigation, the invariant or test that proves it, and the **residual risk we accept and state openly**.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Principal's authority (the ability to authorise spend) | The thing being protected |
| Authority signing key | Forges attestations and checkpoints |
| PayPal credentials and webhook ID | Moves or reads money |
| Evidence ledger | The source of truth in a dispute |
| Passkey public keys | Bind consent to a person's device |
| Prompts and agent outputs | May contain personal data |

## 2. Actors and trust boundaries

```
 [Principal + device] ─TB1─ [Browser] ─TB2─ [Gateway] ─TB3─ [Postgres]
                                              │  │
                                  TB4 ────────┘  └──────── TB5
                               [Gemini / agent]      [PayPal]
                       [Merchant content in catalog] ─TB6─▶ [Agent]
                                [Verifier, offline] ─ reads bundles only
```

| Boundary | Trust assumption |
|---|---|
| TB1 device and browser | The platform authenticator is honest. A malicious page cannot extract passkey private keys. |
| TB2 browser to gateway | Client input is **hostile** (amounts, IDs, terms). |
| TB3 gateway to database | The DB is trusted for availability, **not** for history integrity. |
| TB4 gateway to model | Model output is **untrusted input**. |
| TB5 gateway to PayPal | PayPal is authoritative for settlement. Webhooks are unauthenticated until verified. |
| TB6 catalog to agent | Merchant text is **hostile** (prompt injection). |

## 3. Threats and mitigations

### Spoofing

| Threat | Mitigation | Proof | Residual |
|---|---|---|---|
| Attacker impersonates the principal | Passkey with `userVerification: required`. Consent is per mandate, not per session. | I-05 `consent.uv-required.test` | A stolen unlocked device. Out of scope. |
| Attacker impersonates an agent | Hashed, scoped API keys. Intent spends check agent ID against the mandate. | `intent.wrong-agent.test` | Key theft; rotate keys. |
| Forged PayPal webhook | `verify-webhook-signature` on raw body. Reject and log. | I-06 `webhook.forged.test` | Depends on PayPal's verification endpoint. |

### Tampering

| Threat | Mitigation | Proof | Residual |
|---|---|---|---|
| Client changes amount or payee in the execute request | Orders are built from stored terms. The request is compared to stored terms (`TERMS_MISMATCH`). | I-02 `order-request.property.test`, Lab: tamper | None known. |
| Mandate edited in the DB | Hash and authority signature re-verified in the Gate. | I-01 `gate.hash-mismatch.test` | An attacker holding the authority key can re-sign. |
| Ledger event edited or deleted | Immutability trigger, hash chain, signed checkpoints. | I-04 | **DB-level attacker can rewrite history after the last checkpoint.** Mitigated by frequent checkpoints and publishing roots externally. |
| Quote altered between the Merchant Agent and the mandate (price or payee swapped) | Merchant attestation over the final mandate hash; the Gate verifies it (`MERCHANT_SIGNATURE_INVALID`) | `gate.merchant-signature.test`, Lab: quote tamper | Demo merchant is our own endpoint. A real merchant key would be held by the merchant. |
| Replay of a consent to a different mandate | Challenge equals the mandate hash. | I-05 `consent.binding.test` | None. |
| Replay of an execute request | Single-use unique index, PayPal request ID, state machine. | I-03, Lab: replay | None known. |

### Repudiation

| Threat | Mitigation | Proof | Residual |
|---|---|---|---|
| "I never approved this" | Stored passkey assertion over the mandate hash, verifiable offline. | I-09 `verify-bundle.offline.test` | A passkey proves a user-verified device approved. It does not prove legal identity. |
| "The gateway made this up" | Passkey signature is by the user's key. The gateway cannot forge it. | I-05 | Enrolment trust: the binding of a passkey to a person is out of scope. |

### Information disclosure

| Threat | Mitigation | Proof | Residual |
|---|---|---|---|
| Secrets in logs or client bundle | Config isolation, `pino` redaction, build scan | I-12 | Human error in new code; CI scan helps. |
| Personal data to Gemini free tier (used for product improvement) | Fake sandbox data only. Documented. | README, `LLM_MODE=mock` | Users must not enter real data. |
| IDOR across principals | Ownership check inside every use case | `idor.test` | |

### Denial of service

| Threat | Mitigation | Proof | Residual |
|---|---|---|---|
| Gemini 429 or outage | Backoff, mock mode, clear error, demo fixtures | `llm.backoff.test` | Live demo uses mock if quota is gone. |
| Webhook flood | Verification before heavy work, dedupe table, rate limit | `webhook.flood.test` | Platform-level DDoS out of scope. |
| Cold start on free hosting | Wake before demo. PayPal retries. | n/a | Latency, not correctness. |

### Elevation of privilege

| Threat | Mitigation | Proof | Residual |
|---|---|---|---|
| Prompt injection makes the agent overspend | Agent has two tools and no money capability. Output goes through policy then a human signature, or an intent mandate's hard limits. | I-07, Lab: injection | The agent can still *propose* something bad. The human and the Gate are the control. |
| Agent exceeds an intent budget by racing | Atomic budget `UPDATE`, DB `CHECK` | I-03 `budget.concurrency.int.test`, Lab: race | None known. |
| Policy loosened after signing | Mandate pins policy hash. Execution also checks current policy. | `gate.policy-drift.test` | Tightening denies. Loosening does not retroactively widen a mandate. |
| Lab endpoints abused in production | `LAB_ENABLED` flag, off by default in production | `lab.disabled.test` | |

## 4. What we do not claim

- Not production-ready, not PCI-scoped, sandbox only.
- Not AP2-conformant (see ADR-0005).
- Not tamper-proof. Tamper-**evident**, with a stated window.
- Not an identity system.
- The offline verifier cannot prove PayPal's data is true. It proves the authority attested that it fetched that data, and that the signed amounts match.
