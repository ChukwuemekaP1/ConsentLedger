# ADR-0003: Per-correlation hash-chained ledger with Merkle checkpoints

Status: Accepted · Date: 2026-10-09

## Context
We need an audit trail that is tamper-evident, concurrent, and exportable as a self-verifying slice. A single global chain forces a global lock and makes a per-case export non-contiguous.

## Decision
- One hash chain **per correlation ID**. Appends take `pg_advisory_xact_lock(hashtext(correlationId))`.
- Events are append-only, enforced by a DB trigger that blocks `UPDATE`, `DELETE` and `TRUNCATE`.
- On demand and on a schedule, build a **Merkle tree over chain heads** (`sha256(correlationId || headHash)`), sign the root with the authority key, and store it as a checkpoint.
- Bundles carry a Merkle inclusion proof against a checkpoint.

## Consequences
+ Different cases never contend. A case export verifies by itself.
+ Checkpoints protect history older than the latest checkpoint from a DB-only attacker.
− Hashes are unkeyed, so a DB-level attacker can rewrite one chain after the last checkpoint. We state this plainly and recommend publishing roots externally.
− Merkle tree code adds surface. Mitigated by property tests.

## Alternatives considered
- Global chain: simplest, but a global lock and non-contiguous slices.
- Keyed HMAC chain: protects against outsiders but not against whoever holds the key, and it is not independently verifiable.
- External transparency log: strongest, out of scope for the hackathon. Listed in the evolution path.
