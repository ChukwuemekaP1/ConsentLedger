# ConsentLedger

> Agents propose. Humans sign. PayPal settles. Everything is provable.

A control plane for AI agents that spend money, built for the PayPal AI Hackathon.

![CI](https://github.com/your-org/consentledger/actions/workflows/ci.yml/badge.svg)

**Status: foundation only.** The architecture, guardrails and shared kernel are in place.
Product features are built issue by issue — see [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Quickstart

```bash
# 1. Use the pinned Node version (requires nvm)
nvm use

# 2. Install dependencies
pnpm install

# 3. Start Postgres (requires Docker)
pnpm db:up

# 4. Copy and edit environment variables
cp .env.example .env.local
# Edit .env.local — minimum required for local dev: nothing extra, all default.

# 5. Start the dev server
pnpm dev
# → http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm lint` | ESLint + Prettier check |
| `pnpm arch` | dependency-cruiser layer rules |
| `pnpm test:unit` | Vitest unit tests (no I/O) |
| `pnpm test:int` | Integration tests (needs `DATABASE_URL`) |
| `pnpm verify` | typecheck + lint + arch + test:unit + test:int + build |
| `pnpm db:up` | Start Postgres via Docker Compose |
| `pnpm db:down` | Stop Postgres |

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/INVARIANTS.md`](docs/INVARIANTS.md) | The laws the code must obey |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layers, protocols, data model |
| [`docs/CODING.md`](docs/CODING.md) | How code is written here |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The UI system |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | What we defend, and what we don't claim |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What it is and why it can win |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Issues, milestones, cut line, risks |
| [`docs/adr/`](docs/adr) | Architecture decision records |
| [`AGENTS.md`](AGENTS.md) | Rules for AI coding agents |

## Architecture at a glance

```
src/
  domain/          # Pure TypeScript. No I/O, no framework, no env.
  application/     # Use cases and port interfaces. Depends on domain only.
  infrastructure/  # Adapters: db, paypal, llm, webauthn, config, logging, clock.
  interface/       # HTTP helpers, Zod schemas, error mapping, MCP server.
  app/             # Next.js routes and pages. Thin.
  ui/              # React components.
  container.ts     # Composition root — the only file that wires adapters.
```

Layer boundaries are enforced by `dependency-cruiser` (`pnpm arch`).
A red `arch` check is a failed task.

## License

MIT — see [LICENSE](LICENSE).
