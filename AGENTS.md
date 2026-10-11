# AGENTS.md: operating rules for AI coding agents

You are working on **ConsentLedger**, a control plane for AI agents that spend money: agents propose, humans sign with passkeys, PayPal settles, and a tamper-evident ledger makes everything verifiable offline.

This repository is judged on **engineering quality and evidence**, not on how fast code appears. Slow down where money, signatures or the ledger are involved.

Read this file in full before every task.

## 1. Mandatory reading order

1. `docs/INVARIANTS.md`: the laws. Never violate.
2. `docs/ARCHITECTURE.md`: layers, protocols, data model.
3. `docs/CODING.md`: how code is written here.
4. The GitHub issue and the matching file in `prompts/`.
5. Relevant ADRs in `docs/adr/`.
6. `docs/THREAT_MODEL.md`: whenever you touch a trust boundary.
7. `docs/DESIGN.md`: whenever you touch UI.

## 2. Precedence when documents disagree

Invariants > ADRs > ARCHITECTURE > CODING > DESIGN > issue text > prompt text.
If an issue or prompt asks for something an invariant forbids, **stop and say so**. Do not improvise around it.

## 3. Repository map

```
src/domain/          pure TypeScript. No I/O, no framework, no env, no clock, no randomness.
src/application/     use cases and ports (interfaces). Depends on domain only.
src/infrastructure/  adapters: db, paypal, llm, webauthn, config, logging. Implements ports.
src/interface/       http helpers, Zod request schemas, error mapping, MCP server.
src/app/             Next.js routes and pages. Thin. Calls interface/application only.
src/ui/              React components.
src/container.ts     composition root. The only file that wires adapters to use cases.
tests/               unit, integration, e2e, fixtures.
docs/  issues/  prompts/  scripts/
```

Dependency rules are enforced by `pnpm arch`. A red `arch` check is a failed task.

## 4. Non-negotiable rules

1. **Money** is integer minor units. Never a float.
2. **The client is never trusted for payment terms.** PayPal orders are built from stored, signed terms.
3. **The agent can only propose.** No payment credentials, no signing keys, no settlement port in agent code.
4. **Every state change and its ledger event commit in one transaction.**
5. **Fail closed.** Unknown means deny, or `UNKNOWN`. It never means success.
6. **Time and randomness are injected** (`Clock`, `IdGenerator`). Never call `Date.now()`, `new Date()` or `Math.random()` in `domain` or `application`.
7. **Secrets** are read only in `infrastructure/config`. Never log them. Never send them to the client.
8. **Validate at every boundary** with Zod. Parse, do not cast.
9. **External APIs (PayPal, Gemini, WebAuthn libraries) change.** Read the *current* official docs before writing code against them. Put the URL and the date you read it in the PR. Wrap each behind a port so a change touches one file.
10. **Never weaken, skip or delete a test to make it pass.** If a test is wrong, say why in the PR.

## 5. Workflow for every issue

1. **Orient.** Read the issue, the prompt and the code that exists now. Do not assume what earlier PRs built.
2. **Plan.** Write a short plan in the PR draft: slices, risks, assumptions. If an assumption affects an invariant, stop and ask.
3. **Branch.** `issue-<number>-<slug>` from `main`.
4. **Test first** for domain and gate logic. Write failing tests, then implement.
5. **Slice vertically.** Small commits, each green. Conventional Commits (`feat(domain): ...`, `test(gate): ...`, `docs(adr): ...`).
6. **Verify.** Run `pnpm verify` and paste real output in the PR. See section 7.
7. **Update docs.** If behaviour, architecture or an invariant changed, update docs and ADRs in the same PR.
8. **Write the PR** using `.github/PULL_REQUEST_TEMPLATE.md`. The write-up is a deliverable (section 8).

## 6. Stop and ask when

- An invariant, ADR or the threat model would have to change.
- You need a new runtime dependency (justify it: why not what exists, bundle and security cost).
- A PayPal or Gemini doc contradicts this repo's docs.
- A test can pass only by loosening an assertion.
- The task needs a secret, an account or a console action you cannot perform. List exactly what you need.
- You are about to touch more than one layer's contract at once.

## 7. Commands

| Command | Meaning |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm db:up` / `pnpm db:down` | Local Postgres via docker compose |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations. Never edit an applied migration. |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm lint` | ESLint (type-aware) and Prettier check |
| `pnpm arch` | dependency-cruiser layer rules |
| `pnpm test:unit` | Vitest unit and property tests (no I/O) |
| `pnpm test:int` | Vitest integration tests (needs `DATABASE_URL`) |
| `pnpm test:e2e` | Playwright (virtual authenticator for passkeys) |
| `pnpm verify` | typecheck + lint + arch + unit + integration + build. **Required green before a PR.** |
| `pnpm verify:bundle <file>` | Offline evidence verifier |

## 8. Definition of Done

A task is done only when all of these are true:

- [ ] Acceptance criteria in the issue are met, each mapped to a test or a demonstrated behaviour.
- [ ] `pnpm verify` is green. Output pasted in the PR.
- [ ] Every invariant touched has a named test proving it.
- [ ] No new `any`, `@ts-ignore`, `eslint-disable` or `TODO` without a linked issue.
- [ ] Docs, ADRs and `.env.example` updated if affected.
- [ ] No secrets in code, logs, fixtures or screenshots.
- [ ] UI changes include screenshots or a short recording, in all states: empty, loading, error, success.
- [ ] The PR write-up is complete and honest about limits.

## 9. PR write-up standard

The PR description is what a reviewer, a judge or an interviewer reads. It must contain:

1. **Summary**: what changed and why, in 3 to 5 sentences.
2. **Design decisions**: each with the alternative you rejected and why.
3. **Invariants touched** and the test names that prove them.
4. **Verification**: commands run and real output. Include timings for slow tests.
5. **External docs consulted**: URL and date.
6. **Security notes**: new trust boundaries, new secrets, new attack surface.
7. **Screenshots or recording** for UI.
8. **Known limitations and follow-ups**: honest. Link issues.
9. `Closes #<n>`.

Write for a smart reader who has not seen the diff. No filler, no marketing.

## 10. Style of working

- Prefer boring, explicit code. Name things after domain concepts (`Mandate`, `Gate`, `Consent`), not mechanisms.
- Small modules, small functions, exhaustive `switch` with a `never` check.
- Comments explain **why**, never **what**.
- When uncertain about behaviour, write a test that pins it down before writing code.
- Report honestly. If something does not work, say so, with the evidence.
