# Invariants

These are the laws of the system. Code that violates one is a bug, even if every test passes. Tests must **prove** them, not merely exercise them.

Precedence: **Invariants > ADRs > ARCHITECTURE > CODING > DESIGN > issue text > prompt text.**
If an issue or prompt conflicts with an invariant, stop and raise it. Do not work around it.

| ID | Invariant | Enforced by (defence in depth) | Proven by (test names, to be created) |
|---|---|---|---|
| **I-01** | **No provider call without a Gate pass.** The settlement port accepts only a `GateApproval`, a branded capability that only `domain/gate` can mint. | Type system, Gate, arch rule: only `application/usecases/execute-payment` imports the settlement port | `gate.capability.test` (including a `@ts-expect-error` compile test), `execute-payment.no-provider-call-on-denial.test` |
| **I-02** | **The amount PayPal receives equals the signed terms.** Orders are built from a stored `PaymentMandate`, never from request input. | `buildOrderRequest(paymentMandate)` signature, DB `CHECK` | `order-request.property.test` (for any mandate, wire amount string equals `format(terms)`) |
| **I-03** | **Single spend.** A cart mandate yields at most one payment mandate. For an intent mandate, `spent + reserved <= total` at all times. | `UNIQUE(mandate_id, sequence)`, `CHECK`, atomic `UPDATE ... WHERE` budget reserve | `budget.concurrency.int.test` (50 concurrent spends against a budget for 10), `cart.single-use.int.test` |
| **I-04** | **The ledger is tamper-evident.** Every state change commits with its event in the same transaction. Events are append-only. Chains verify. Checkpoints anchor history. | Same-transaction append, DB trigger blocks `UPDATE`, `DELETE` and `TRUNCATE`, `verifyChain`, signed Merkle checkpoints | `chain.tamper.property.test`, `ledger.immutable.int.test`, `checkpoint.anchor.test` |
| **I-05** | **Consent is bound to one hash.** A consent is valid only if the passkey assertion's challenge equals the mandate hash, user verification is set, and rpId and origin match. | `verifyConsent` mints `VerifiedConsent` (branded). The Gate requires it. | `consent.binding.test` (consent for hash A fails for hash B), `consent.uv-required.test` |
| **I-06** | **Webhooks are idempotent and order-insensitive.** | `UNIQUE(paypal_event_id)`, a state machine that tolerates any arrival order | `webhook.duplicate.int.test`, `webhook.reorder.property.test` |
| **I-07** | **The agent is isolated.** Agent and LLM code can reach only the `propose`, `catalog` and `status` ports. It holds no PayPal or signing secrets. | `dependency-cruiser` rule, separate port interfaces, env access only in `infrastructure/config` | `arch.agent-isolation.test` |
| **I-08** | **The operator is grounded.** Every factual claim cites an event ID that exists in the evidence set. Otherwise: "insufficient evidence". | Server-side citation validation | `operator.fabricated-citation.test`, `operator.empty-evidence.test` |
| **I-09** | **Evidence verifies offline.** Verifying a bundle needs no network and no database, in the CLI and in the public browser page. | Verifier lives in `domain/evidence`, uses only bundle contents, and runs unchanged in Node and the browser | `verify-bundle.offline.test` (network access stubbed to throw), `verify-bundle.mutation.test`, `verify-page.parity.test` (same verdicts as the CLI) |
| **I-10** | **Money is integer minor units.** No floats anywhere in domain or application code. | Branded `MinorUnits`, currency exponent table, ESLint ban on arithmetic on `parseFloat` results in money paths | `money.property.test` (round trips, rejects floats) |
| **I-11** | **Fail closed.** Any Gate error, unknown state or ambiguous provider outcome is treated as deny or `UNKNOWN`, never as success. `UNKNOWN` is resolved only by querying the provider. | `Result` types, exhaustive `switch`, recovery job | `gate.fail-closed.test`, `execute-payment.timeout-unknown.test` |
| **I-12** | **Secrets stay server-side.** Never logged, never in the client bundle. | Config module is the only `process.env` reader, `pino` redaction, build-output scan | `secrets.client-bundle.test`, `logger.redaction.test` |

## How to add or change an invariant

1. Open an issue labelled `invariant-change`.
2. Write an ADR explaining why.
3. Update this file, the tests and the threat model in the same PR.

## Reason codes (stable, part of the public API)

`MANDATE_NOT_FOUND` · `MANDATE_EXPIRED` · `MANDATE_REVOKED` · `MANDATE_STATE_INVALID` · `HASH_MISMATCH` · `AUTHORITY_SIGNATURE_INVALID` · `MERCHANT_SIGNATURE_INVALID` · `CONSENT_MISSING` · `CONSENT_INVALID` · `POLICY_DENIED` · `POLICY_DRIFT` · `BUDGET_EXCEEDED` · `TX_CAP_EXCEEDED` · `STEP_UP_REQUIRED` · `REPLAY_DETECTED` · `MERCHANT_NOT_ALLOWED` · `CURRENCY_NOT_ALLOWED` · `TERMS_MISMATCH` · `WEBHOOK_SIGNATURE_INVALID` · `WEBHOOK_DUPLICATE` · `PROVIDER_ERROR` · `PROVIDER_OUTCOME_UNKNOWN` · `RECONCILIATION_MISMATCH` · `INSUFFICIENT_EVIDENCE`

Adding a code is a normal change. Renaming or removing one is a breaking change.
