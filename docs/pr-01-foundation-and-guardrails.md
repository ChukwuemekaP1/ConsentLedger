# PR: Issue #1 — Foundation and Guardrails

Branch: `issue-1-foundation-and-guardrails`

---

## Summary

Bootstraps the ConsentLedger repository from the documentation kit. Adds strict TypeScript 6.0.3, enforced hexagonal layer boundaries (dependency-cruiser), ESLint pure-layer guardrails, Vitest with unit/integration split, pino logging with central redaction, Zod env validation, RFC 9457 problem+json, a health endpoint, Docker Compose for Postgres, and GitHub Actions CI. No product features. Every guardrail has a test that proves it bites before any product code is added.

---

## Design decisions

**TypeScript 6.0.3 instead of 7.0.2 (latest)**
`@typescript-eslint` v8.71.1 declares `peerDependencies: { typescript: ">=4.8.4 <6.1.0" }`. TypeScript 7.0 shipped with a new `tsgo` native compiler; the entire typescript-eslint/ESLint ecosystem is currently blocked on it (open issue: github.com/eslint/eslint/issues/21070, read 2026-10-11). Using TS7 would mean the type-aware lint rules — the primary invariant guardrails — may silently misfire. Rejected option B (force TS7 + legacy peer deps) because a linter that can't parse its host language is worse than no linter. Follow-up: upgrade when typescript-eslint v9 ships TS7 support.

**`"type": "module"` in package.json**
`verbatimModuleSyntax` in tsconfig requires all `.ts` files to be treated as ESM or CJS consistently. Without `"type": "module"`, TypeScript emits TS1295/TS1287 errors on every `import`/`export`. All tooling (Next.js 16, Vitest 5, pino 10) supports ESM. The dependency-cruiser config stays `.cjs` (it must use `module.exports`), and `.gitattributes` normalises LF endings.

**`projectService: true` instead of `project: "./tsconfig.json"` in ESLint**
The old `project` option spins up a full TypeScript language service for every file ESLint processes. On this project it caused a hard hang (>60s, no output). `projectService` (typescript-eslint v8+) shares one language service instance, reducing overhead dramatically. Trade-off: slightly looser caching on first run, but it finishes in ~5s.

**Prettier scoped to `src/`, `tests/`, and root config files**
`prettier --check .` formatted the pre-existing docs/issues/prompts Markdown which we must not modify (per AGENTS.md). Scoped the check to files we own. The pre-existing kit files are untouched.

**Fixture dep-cruiser config uses path substring matching, not `^src/`**
The `cruise()` API resolves module paths relative to `process.cwd()`, so a file at `tests/fixtures/arch-violation/src/domain/bad-import.ts` has `domain` in its path but does not start with `^src/domain`. Using substring matching (`path: "domain"`) makes the rule portable regardless of where the fixture lives. The real config uses `^src/domain` which is correct for the real tree.

**`parseWith()` in config tests is synchronous, not `async`**
The original version used `import('zod')` dynamically inside `async` tests, which caused the first test to timeout at 5000ms (the dynamic import + Vite transform pipeline adds ~6s). Since `zod` is already a top-level static import available to the module, and Zod v4 validation is synchronous, making the test helper synchronous eliminates the timeout entirely and makes the tests faster.

**Prettier glob excludes `.sh` files**
`scripts/bootstrap-github.sh` is a bash script that Prettier cannot parse (`No parser could be inferred`). Scoped the glob to `scripts/**/*.{ts,mjs,js}`.

---

## Invariants touched

| Invariant | Proven by |
|---|---|
| I-10 (partial, types only) | `brand.ts` `Brand<T,Name>` prevents accidental primitive mix-ups at compile time |
| I-12 (env isolation, logger redaction) | `tests/unit/infrastructure/config.test.ts` — `error message contains variable names but never their values` · `tests/unit/infrastructure/logger.test.ts` — every field in REDACT_PATHS produces `[REDACTED]` |

---

## Verification

```
pnpm typecheck       ✓ (0 errors)
pnpm lint            ✓ (ESLint 0 errors, Prettier all matched files)
pnpm arch            ✓ (28 modules, 29 dependencies, 0 violations)
pnpm test:unit       ✓ (50/50 tests, 6 test files, 4.19s)
test:int             ✓ (skipped — DATABASE_URL not set locally, as expected)
pnpm build           ✓ (Next.js 16.4.0 Turbopack, routes: / ○  /api/v1/health ƒ)

Full verify output:
> pnpm typecheck && pnpm lint && pnpm arch && pnpm test:unit && node scripts/verify-int.mjs && pnpm build
[all steps pass — see above]
```

Architecture fixture test (showing the rule bites):
```
✓ real src/ has zero architecture violations 2433ms
✓ fixture with domain→infrastructure import triggers an error violation 51ms
```

Lint-rule test (showing Date.now() is banned in domain):
```
✓ flags Date.now() with no-restricted-properties 2652ms
✓ flags new Date() with no-restricted-syntax
✓ flags Math.random() with no-restricted-properties
✓ flags process.env with no-restricted-syntax
✓ flags console.log() with no-restricted-properties
```

Logger redaction (28 tests, one per REDACT_PATHS field + headers):
```
✓ tests/unit/infrastructure/logger.test.ts (28 tests) 46ms
```

---

## External docs consulted

| Doc | URL | Date read |
|---|---|---|
| Next.js 16 release notes | https://nextjs.org/blog/next-16 | 2026-10-11 |
| Next.js 16 changelog | https://next-changelog.malezjaa.tech/ (v16.3.8 latest at time) | 2026-10-11 |
| TypeScript 7 + @typescript-eslint conflict | https://dev.to/dev_encyclopedia/why-your-typescript-7-upgrade-broke-eslint-ts-jest-and-ts-morph-385k | 2026-10-11 |
| ESLint TS7 issue | https://github.com/eslint/eslint/issues/21070 | 2026-10-11 |
| typescript-eslint v8 announcement | https://typescript-eslint.io/blog/announcing-typescript-eslint-v8 | 2026-10-11 |
| Vitest 5 blog | https://main.vitest.dev/blog/vitest-5 | 2026-10-11 |
| Zod v4 migration guide | https://zod.dev/v4/changelog | 2026-10-11 |
| pino redaction docs | https://github.com/pinojs/pino/blob/master/docs/redaction.md | 2026-10-11 |
| dependency-cruiser options | https://github.com/sverweij/dependency-cruiser/blob/develop/doc/options-reference.md | 2026-10-11 |
| TruffleHog OSS v3.99.2 | https://github.com/trufflesecurity/trufflehog/releases/tag/v3.99.2 | 2026-10-11 |

---

## Security notes

- `src/infrastructure/config/env.ts` is the only file that reads `process.env`. The lint rule `no-restricted-syntax` bans `process.env` access in `src/domain/**` and `src/application/**`. Tests prove the ban fires.
- `src/infrastructure/logging/redact.ts` centralises all secret field names. Every secret added to the app must also be added here. The logger test covers the full list.
- No secrets committed: `.gitignore` excludes `.env`, `.env.local`, `.env.*.local`.
- TruffleHog OSS scans every push/PR, pinned to commit SHA `e76dff8` (v3.99.2) to prevent supply-chain substitution.
- `LAB_ENABLED` defaults to `false`. Lab routes (attack surface) are off unless explicitly enabled.

---

## Screenshots / recording

Home page (`/`): dark `#0B0D10` background, "ConsentLedger" in `var(--text)`, "Foundation. No product features yet." in `var(--text-dim)`, version string in monospace. No interactive elements.

Health endpoint:
```json
{"status":"ok","version":"0.1.0","commit":"unknown","time":"2026-10-11T..."}
```

---

## Docs updated

- [x] `README.md` — replaced stub with quickstart, commands, doc index, architecture diagram
- [ ] ARCHITECTURE / INVARIANTS / THREAT_MODEL — no changes needed (foundation matches docs exactly)
- [ ] ADR — no new decisions (ADR-0001 was the relevant existing one)
- [x] `.env.example` — all 20 variables documented with issue references

---

## Known limitations and follow-ups

1. **TypeScript 6.0.3 pinned.** Will upgrade to TS7 when `@typescript-eslint` v9 ships TS7 support. Track: github.com/typescript-eslint/typescript-eslint.
2. **ESLint `--fix` not run in CI.** Prettier is check-only; a failing format is a CI failure. Developers must run `pnpm exec prettier --write` locally before committing. A pre-commit hook (issue #1 follow-up) would eliminate this friction.
3. **Dep-cruiser fixture uses substring matching** (`path: "domain"`) instead of anchored `^src/domain` because cruise paths are relative to cwd. The real config uses anchored paths which are correct for `src/`. This divergence is documented in the fixture config's comments.
4. **Coverage thresholds not enforced yet.** `src/domain/**` is nearly empty (shared kernel only). Thresholds will become meaningful from issue #2 onward; running `pnpm vitest run --project unit --coverage` currently passes trivially.
5. **`@types/react` pinned at 19.1.8.** Next.js 16 bundles its own React 19.3.0 types; we pin `@types/react` separately only because `src/app/layout.tsx` references `React.ReactNode`. This can be removed once the layout uses the React 19 automatic JSX runtime types exclusively.

Closes #1
