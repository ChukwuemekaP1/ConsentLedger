# ConsentLedger

> Agents propose. Humans sign. PayPal settles. Everything is provable.

A control plane for AI agents that spend money — built for the **PayPal AI Hackathon**.

[![CI](https://github.com/ChukwuemekaP1/ConsentLedger/actions/workflows/ci.yml/badge.svg)](https://github.com/ChukwuemekaP1/ConsentLedger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What is this?

ConsentLedger is a payments control plane that solves a real problem with AI agents that
spend money on your behalf: **how do you verify that exactly what you approved is exactly
what was charged?**

- An AI agent browses and proposes a purchase — it cannot settle or sign anything.
- The human reviews the exact mandate (amount, merchant, items) and signs it with a
  passkey on their device.
- PayPal settles only against the signed terms — not against request input.
- Every state change is written to a tamper-evident ledger. A third party can verify the
  full chain offline, without trusting the server.

The architecture is built to be hostile-code-review-proof: strict TypeScript, enforced
layer boundaries, property tests, and a Gate that fails closed on any ambiguity.

---

## Status

| Issue | Milestone | Status |
|---|---|---|
| #1 Foundation & guardrails | M1 | ✅ Done |
| #2 Domain kernel | M1 | 🔜 Next |
| #3 Evidence ledger (Postgres) | M1 | ⏳ Queued |
| #4 Passkey identity & consent | M1 | ⏳ Queued |
| #5 Agent-to-cart mandate | M2 | ⏳ Queued |
| #6 PayPal settlement gateway | M2 | ⏳ Queued |
| #7–21 … | M2–M4 | ⏳ Queued |

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full plan.

---

## Quickstart

**Requirements:** Node 20+, pnpm 9+, Docker (for local Postgres)

```bash
# 1. Use the pinned Node version
nvm use          # reads .nvmrc (Node 24)

# 2. Install dependencies
pnpm install

# 3. Copy env file — defaults work for local dev, no secrets needed yet
cp .env.example .env.local

# 4. Start Postgres
pnpm db:up

# 5. Start the dev server
pnpm dev
# → http://localhost:3000      placeholder home page
# → http://localhost:3000/api/v1/health   {"status":"ok","version":"0.1.0",...}
```

---

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit`, strict mode |
| `pnpm lint` | ESLint (type-aware) + Prettier check |
| `pnpm arch` | dependency-cruiser layer boundary check |
| `pnpm test:unit` | Vitest unit tests — no I/O, no DB |
| `pnpm test:int` | Integration tests — requires `DATABASE_URL` |
| `pnpm verify` | typecheck → lint → arch → test:unit → test:int → build |
| `pnpm db:up` | Start Postgres 16 via Docker Compose |
| `pnpm db:down` | Stop Postgres |

`pnpm verify` is the single gate. It must be green before any PR merges.

---

## Architecture

```
src/
  domain/          # Pure TypeScript. No I/O, no framework, no env, no clock.
  application/     # Use cases and port interfaces. Imports domain only.
  infrastructure/  # Adapters: db, paypal, llm, webauthn, config, logging, clock.
  interface/       # HTTP helpers, Zod schemas, error mapping, MCP server.
  app/             # Next.js routes and pages. Thin.
  ui/              # React components.
  container.ts     # Composition root — the only file that wires adapters.
```

Layer boundaries are enforced mechanically by `dependency-cruiser` on every CI run.
A violation is a build failure.

The domain is pure — no `Date.now()`, no `Math.random()`, no `process.env`. ESLint rules
ban them at the file level. `Clock` and `IdGenerator` are injected, so every test is
deterministic.

---

## Key design decisions

| Decision | Why |
|---|---|
| Passkey consent bound to mandate hash | The WebAuthn challenge *is* the hash. A signature for mandate A cannot be replayed against mandate B. |
| Money as integer minor units only | `MinorUnits` is a branded type. No floats anywhere in domain or application code. |
| Fail-closed Gate | Unknown outcome → `UNKNOWN`, never success. Resolved only by querying PayPal. |
| Tamper-evident ledger | Hash-chained events per correlation ID. DB trigger blocks UPDATE/DELETE. Signed Merkle checkpoints anchor history. |
| Agent isolation | `dependency-cruiser` rule: `infrastructure/llm` and `interface/mcp` may only import `propose`, `catalog`, `status` ports. No payment or signing code. |

Full details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/INVARIANTS.md`](docs/INVARIANTS.md).

---

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | The laws the code must never violate |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, protocols, data model, state machines |
| [`docs/CODING.md`](docs/CODING.md) | How code is written here |
| [`docs/DESIGN.md`](docs/DESIGN.md) | UI system: tokens, components, interaction principles |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | What we defend, and what we honestly don't claim |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | Product pitch and hackathon context |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Issues, milestones, cut line, risks |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`AGENTS.md`](AGENTS.md) | Rules for AI coding agents working in this repo |

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 6 (strict + noUncheckedIndexedAccess) |
| Database | Postgres 16 via Drizzle ORM |
| Auth | WebAuthn / Passkeys (`@simplewebauthn/server`) |
| Payments | PayPal Orders v2 REST API |
| AI | Google Gemini (function calling) |
| Logging | pino (JSON, with central redaction) |
| Validation | Zod v4 |
| Testing | Vitest 5 (unit + integration), fast-check (property tests) |
| CI | GitHub Actions |

---

## License

MIT — see [LICENSE](LICENSE).
