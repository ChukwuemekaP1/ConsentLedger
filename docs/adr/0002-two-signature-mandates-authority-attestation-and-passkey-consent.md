# ADR-0002: Two-signature mandates: authority attestation plus passkey consent

Status: Accepted · Date: 2026-10-09

## Context
A server-side signature alone proves only what the server says it showed. AP2 describes mandates signed by the user with a hardware-backed device key. We need consent a third party can verify without trusting us.

## Decision
Each mandate carries two signatures:
1. **Authority attestation**: Ed25519 over the mandate hash, by the gateway.
2. **Consent**: a WebAuthn assertion whose **challenge equals the mandate hash**, with `userVerification: required`.

We store `authenticatorData`, `clientDataJSON`, `signature`, the credential public key (COSE), `rpId` and `origin`, so the assertion can be re-verified offline. The mandate includes a 32-byte random nonce, so the challenge has full entropy.

**Update 2026-10-10:** Cart mandates also require a **merchant attestation** (Ed25519 by the Merchant Agent, own key, own process boundary), mirroring AP2's merchant-signed cart. The Gate verifies every attestation role the mandate kind requires. Intent and payment mandates need the authority attestation only.

## Consequences
+ A DB or server compromise cannot forge consent.
+ Offline verification is possible (I-09).
− The consent is bound to an `rpId` and `origin`. A bundle must include them, and a change of domain needs care.
− Some authenticators return `signCount = 0`. We record the counter but do not rely on it.
− A passkey proves a user-verified device approved the hash. It is not legal identity proof (stated in the threat model).

## Alternatives considered
- Server-only HMAC or signature: not independently verifiable. Weaker claim.
- Wallet or JWS-based user keys: more portable, but a worse UX and no hardware backing by default.
- WebAuthn for login only: does not bind consent to the specific mandate.
