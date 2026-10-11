# Coding standards

These are enforced by tooling where possible and by review otherwise. If a rule is wrong, change the rule through a PR. Do not ignore it.

## 1. TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`.
- No `any`. No non-null `!` outside tests. No `@ts-ignore`. `@ts-expect-error` only in tests that prove a type-level guarantee, with a comment.
- **Branded types** for domain primitives: `MinorUnits`, `Hash`, `Uuid`, `Timestamp`, `GateApproval`, `VerifiedConsent`. Create them only through validating constructors.
- **Discriminated unions** for states and events. Every `switch` on a union ends with an exhaustive `never` check.
- `readonly` by default. Prefer plain objects and functions over classes in `domain`.
- Use `import type` for types. No default exports except where Next.js requires them.

## 2. Errors

- **Expected failures are values.** Domain and application functions return `Result<T, E>`. Do not throw for denials, validation or illegal transitions.
- **Programmer errors throw** (`AssertionError`-style, via `invariant()`), and are never caught to hide them.
- Infrastructure converts provider and DB failures into typed `InfraError` values at the adapter edge.
- The HTTP layer maps errors to RFC 9457 problem+json with a stable `code`. One mapping file. No ad hoc `new Response(...)` for errors.
- Never include secrets, full prompts or stack traces in responses.

## 3. Boundaries and validation

- Every external input (HTTP, webhook, LLM output, env, DB JSON) is parsed with Zod at the edge. **Parse, do not cast.**
- Request schemas live in `interface/http`. Domain schemas live beside domain types.
- LLM output is untrusted input, always.

## 4. Purity, time and randomness

- `domain` and `application` never call `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()` or read `process.env`. Inject `Clock` and `IdGenerator`. Lint rules enforce this.
- Cryptographic randomness (`randomBytes`) is behind `IdGenerator` or `NonceGenerator` as well, so tests are deterministic.

## 5. Money

- `MinorUnits` is a branded safe integer. Currency exponents come from one table (USD 2, EUR 2, GBP 2, JPY 0). Formatting to PayPal's string happens only at the provider adapter, through one function.
- No floating-point arithmetic, no `toFixed` in money paths.

## 6. Database

- Drizzle schema is the source of truth. Generate migrations (`pnpm db:generate`). **Never edit an applied migration.**
- Parameterised queries only. Raw SQL goes through the `sql` template tag.
- Transactions are opened by use cases through a `UnitOfWork` port, never inside repositories.
- Constraints carry invariants (`UNIQUE`, `CHECK`, triggers). Do not rely on application code alone.
- Row locks use `SELECT … FOR UPDATE`. Advisory locks use a single helper that documents the key scheme.
- Money columns are `bigint`. Timestamps are `timestamptz`, stored UTC.

## 7. Cryptography

- Use `node:crypto` and `@simplewebauthn/server`. No hand-rolled primitives.
- Compare secrets and hashes with `timingSafeEqual`.
- Always hash canonical bytes. Never hash `JSON.stringify` output.
- Every signature function documents **what is signed** in its JSDoc.
- Keys are loaded once at boot, validated, and never logged. Log `keyId` only.

## 8. Logging

- `pino` only. No `console.*` outside scripts.
- Log events, not prose: `{ event: 'gate.denied', code, correlationId }`.
- Redaction list is central. Add a field to the list when you add a secret.

## 9. Testing

- **Test first** for domain and gate logic. A bug fix starts with a failing test.
- Name tests by behaviour: `rejects consent whose challenge differs from the mandate hash`.
- Arrange, act, assert. One concept per test.
- Property tests (fast-check) for anything with an algebraic law: canonicalisation, hashing, money round trips, chain tamper detection, Merkle proofs.
- Known-answer tests for crypto and canonicalisation.
- Integration tests use real Postgres, wrapped per test. No mocking the database.
- Mock only at ports. Use fakes (`FakePaymentProvider`, `FakeLlmClient`, `FixedClock`) that live in `tests/fakes`.
- Time-dependent tests use `FixedClock`. No sleeps.
- Coverage floor: `domain` ≥ 95% lines, ≥ 90% branches. The invariants table is the real target.
- Never snapshot secrets, keys or live PayPal tokens. Fixtures are scrubbed.

## 10. Structure and naming

- Files named by concept, kebab-case: `execute-payment.ts`, `mandate-state.ts`.
- One public concept per file. Re-export through `index.ts` per module only.
- Names come from the domain: `Mandate`, `Gate`, `Consent`, `Checkpoint`. Avoid `Manager`, `Helper`, `Util`, `Service` (use cases are named by verb: `ExecutePayment`).
- Functions ≤ 40 lines where practical. Files ≤ 300 lines. Split before they grow.
- Comments explain **why**. Delete comments that restate code.

## 10b. UI

- Follow `docs/DESIGN.md`. Components are presentational, with data fetching in route or server components.
- Every screen has empty, loading, error and success states. Keyboard accessible. Visible focus rings.
- No colour-only status signals. Pair colour with an icon or label.
- Hashes and IDs render in mono with a copy affordance. Money uses tabular figures.

## 11. Git and PRs

- Branch: `issue-<n>-<slug>`.
- Commits: Conventional Commits (`feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `build`, `ci`), scope = layer or module.
- One issue per PR. Keep PRs reviewable. If it grows, split the issue.
- PR description follows `.github/PULL_REQUEST_TEMPLATE.md`.
- No force-push after review starts. Squash on merge. The squash title is the Conventional Commit.

## 12. Dependencies

- Prefer the platform and what we already use. A new runtime dependency needs a justification in the PR: what it does, why not existing code, maintenance and security signals, bundle impact.
- Pin via lockfile. Review `pnpm audit --omit=dev` output.
- Domain imports are limited to the allowlist in `.dependency-cruiser.cjs`. Changing it needs an ADR.

## 13. Security checklist (per PR)

- [ ] New input validated with Zod
- [ ] New route has authn, authz and an ownership check
- [ ] No secret in logs, errors, fixtures or client code
- [ ] New external call has a timeout, a retry policy and an idempotency story
- [ ] New table has constraints that carry the invariant
- [ ] Threat model updated if a trust boundary moved

## 14. Documentation

- Behaviour change means a docs change in the same PR.
- A new architectural decision means a new ADR (`docs/adr/NNNN-title.md`). Format: Context, Decision, Consequences, Alternatives.
- `.env.example` lists every variable with a one-line comment.
