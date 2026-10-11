# ADR-0005: AP2-aligned mandate model, not AP2-conformant

Status: Accepted · Date: 2026-10-09

## Context
AP2 defines Intent, Cart and Payment mandates as signed Verifiable Credentials. The public page we reviewed names the fields in prose and does not fix a serialization, signature algorithm or TTL rules for cart and payment mandates. PayPal's AP2 post describes mandate APIs as planned, without endpoints.

## Decision
Model the same three concepts with the same actors and intent. Serialize as VC-shaped JSON, canonicalised with RFC 8785 JCS, signed with Ed25519 (authority) and WebAuthn (principal). Document the mapping in `PRODUCT.md`. **Do not claim conformance.**

## Consequences
+ We can build real, verifiable behaviour today and explain how it maps to AP2.
+ If PayPal or Google publish concrete schemas, the mandate serializer is one module to change.
− Interop with other AP2 implementations is not guaranteed.

## Alternatives considered
- Wait for official schemas: no demo.
- Claim "AP2 compliant": not honest, and judges can check.
