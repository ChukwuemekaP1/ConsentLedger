# ADR-0008: Consent verification lives in pure domain code

Status: Accepted · Date: 2026-10-10

## Context
The Gate (I-01, I-05) and the offline verifier (I-09) must verify a WebAuthn assertion. The verifier also has to run in a browser (issue 18) and in a CLI with no server. Pulling a large WebAuthn library into `domain` breaks purity, bloats the browser bundle and ties the verifier to a library's API.

## Decision
- **Registration and option generation** use a maintained library (`@simplewebauthn`) in `infrastructure/webauthn`. At registration the credential's public key is converted to **SPKI DER** and stored (with the COSE algorithm identifier).
- **Assertion verification** is implemented in `domain/consent` using `node:crypto` (and a `CryptoProvider` abstraction for the browser later). It checks: `type = webauthn.get`, challenge equals the mandate (or policy) hash as base64url, origin and `rpIdHash`, UP and UV flags, `crossOrigin` not true, and the signature over `authenticatorData || SHA-256(clientDataJSON)` for ES256, EdDSA and RS256.
- ES256 signatures arrive DER-encoded in WebAuthn. Convert as needed per provider.
- We **differentially test** our verifier against the library on generated assertions, so any divergence is caught.

## Consequences
+ One verifier for the Gate, the CLI and the browser page.
+ Evidence bundles carry plain SPKI keys, not CBOR.
− We own security-critical parsing code (authenticator data, flags). Mitigated by differential tests, known vectors and mutation tests, and by keeping the surface small (no attestation parsing in the domain).
− Attestation statements are not verified offline. We state this in the threat model: enrolment trust is out of scope.

## Alternatives considered
- Use the library inside the domain: not pure, heavy for the browser.
- Verify only server-side: the offline claim (I-09) would be weaker.
