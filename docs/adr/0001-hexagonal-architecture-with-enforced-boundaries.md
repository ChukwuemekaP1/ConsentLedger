# ADR-0001: Hexagonal architecture with enforced boundaries

Status: Accepted · Date: 2026-10-09

## Context
The security-critical logic (mandates, Gate, ledger, verifier) must be provable and testable without a database, a network or a framework. AI-assisted coding tends to blur layers unless the rules are mechanical.

## Decision
Use ports and adapters. `domain` is pure. `application` holds use cases and port interfaces. `infrastructure` implements ports. `interface` and `app` are thin. A composition root wires everything. Layer rules are enforced by `dependency-cruiser` in CI, and a fixture test proves the rule fails on a bad import.

## Consequences
+ Domain tests are fast and deterministic. The offline verifier reuses domain code unchanged.
+ Swapping PayPal, Gemini or the database touches one adapter.
− More files and indirection than a flat Next.js app. Accepted: the indirection is the product's credibility.

## Alternatives considered
- Flat Next.js route handlers calling SDKs directly: fastest to start, but untestable and impossible to defend in review.
- Full DDD with event sourcing: heavier than needed. The ledger already gives us the audit trail.
