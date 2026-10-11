# ADR-0006: Write-ahead execution and reconciliation

Status: Accepted · Date: 2026-10-09

## Context
PayPal calls cannot join a database transaction. A crash or timeout between "decide to pay" and "record the result" can double-charge or lose a payment. PayPal's Orders v2 idempotency keys (`PayPal-Request-Id`, 1 to 108 characters) are stored for 6 hours by default, so a retry after that window is not protected, and simultaneous requests with the same key may fail the second one.

## Decision
Use **intent-then-effect**:
1. Commit the decision (Gate pass, budget reservation, `PaymentMandate` with stored request IDs, ledger event) **before** calling PayPal.
2. Call PayPal with the stored `PayPal-Request-Id`.
3. Commit the result in a separate transaction.
4. A recovery job and the reconcile use case resolve `AUTHORIZED`, `CAPTURE_REQUESTED` and `UNKNOWN` states by **querying PayPal**, never by blind retry.

Our own uniqueness (DB constraints, state machine, row locks) is the primary double-spend guard. PayPal's idempotency is defence in depth.

## Consequences
+ Every crash point has a defined recovery (see ARCHITECTURE.md, section 6).
+ Reconciliation doubles as the demo's proof of "exactly one capture".
− More states and more tests than a naive "create and capture".

## Alternatives considered
- Naive create-then-capture in one handler: loses the outcome on crash.
- Outbox and queue: stronger at scale, heavier than we need. On the evolution path.
