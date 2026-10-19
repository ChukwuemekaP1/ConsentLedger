/**
 * Hash-chained ledger: appendToChain, verifyChain.
 *
 * hash = sha256(prevHash || canonicalJson({id, correlationId, seq, type, actor, payload, createdAt}))
 *
 * First event: prevHash = 64 zeros.
 * Each subsequent event's prevHash must equal the previous event's hash.
 *
 * verifyChain checks:
 *   1. Non-empty
 *   2. seq contiguous from 1
 *   3. All events share the same correlationId
 *   4. prevHash links form an unbroken chain
 *   5. Each event's hash recomputes correctly
 *
 * INVARIANT: I-04 — tamper-evident ledger.
 * ARCHITECTURE.md §8.
 */

import { sha256Hex, ZERO_HASH } from "../crypto/hash.js";
import { canonicalize } from "../crypto/canonical.js";
import { type Result, ok, err } from "../shared/result.js";
import { invariant } from "../shared/invariant.js";
import type { LedgerEvent, LedgerEventDraft } from "./events.js";
import type { Timestamp, Uuid } from "../shared/clock.js";

export interface ChainHead {
  readonly hash: string;
  readonly seq: number;
}

export interface AppendError {
  readonly kind: "PAYLOAD_NOT_CANONICAL" | "ID_CONFLICT";
  readonly message: string;
}

/**
 * Append a new event to the chain.
 *
 * hash = sha256(prevHash || canonicalJson({id, correlationId, seq, type, actor, payload, createdAt}))
 */
export function appendToChain(
  prev: ChainHead | null,
  draft: LedgerEventDraft,
  id: Uuid,
  now: Timestamp,
): Result<LedgerEvent, AppendError> {
  const seq = prev !== null ? prev.seq + 1 : 1;
  const prevHash = prev !== null ? prev.hash : ZERO_HASH;

  // Validate payload is canonicalisable
  const payloadCheck = canonicalize(draft.payload);
  if (!payloadCheck.ok) {
    return err({
      kind: "PAYLOAD_NOT_CANONICAL",
      message: `Payload contains non-canonical values: ${payloadCheck.error.kind}`,
    });
  }

  const createdAt = now;

  const hashable = {
    id,
    correlationId: draft.correlationId,
    seq,
    type: draft.type,
    actor: draft.actor,
    payload: draft.payload,
    createdAt,
  };

  const canonical = canonicalize(hashable);
  if (!canonical.ok) {
    return err({
      kind: "PAYLOAD_NOT_CANONICAL",
      message: `Hash input contains non-canonical values: ${canonical.error.kind}`,
    });
  }

  const hash = sha256Hex(prevHash + canonical.value);

  const event: LedgerEvent = {
    seq,
    id,
    correlationId: draft.correlationId,
    type: draft.type,
    actor: draft.actor,
    payload: draft.payload,
    prevHash,
    hash,
    createdAt,
  };

  return ok(event);
}

// ─── verifyChain ──────────────────────────────────────────────────────────────

export interface ChainVerificationOk {
  readonly length: number;
  readonly headHash: string;
}

export interface ChainVerificationErr {
  readonly brokenAtSeq: number;
  readonly reason:
    "SEQ_GAP" | "WRONG_PREV_HASH" | "HASH_MISMATCH" | "CORRELATION_ID_MISMATCH" | "EMPTY_CHAIN";
  readonly details?: string;
}

/**
 * Verify an entire chain of ledger events.
 */
export function verifyChain(
  events: readonly LedgerEvent[],
): Result<ChainVerificationOk, ChainVerificationErr> {
  if (events.length === 0) {
    return err({ brokenAtSeq: 0, reason: "EMPTY_CHAIN" });
  }

  // events[0] is safe — we checked length > 0 above
  const first = events[0];
  invariant(first !== undefined, "events[0] must exist after length check");
  const correlationId = first.correlationId;
  let prevHash: string = ZERO_HASH;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    invariant(event !== undefined, `events[${i}] must exist`);
    const expectedSeq = i + 1;

    if (event.seq !== expectedSeq) {
      return err({
        brokenAtSeq: event.seq,
        reason: "SEQ_GAP",
        details: `Expected seq ${expectedSeq}, got ${event.seq}`,
      });
    }

    if (event.correlationId !== correlationId) {
      return err({
        brokenAtSeq: event.seq,
        reason: "CORRELATION_ID_MISMATCH",
        details: `Expected ${correlationId}, got ${event.correlationId}`,
      });
    }

    if (event.prevHash !== prevHash) {
      return err({
        brokenAtSeq: event.seq,
        reason: "WRONG_PREV_HASH",
        details: `Expected prevHash ${prevHash}, got ${event.prevHash}`,
      });
    }

    const hashable = {
      id: event.id,
      correlationId: event.correlationId,
      seq: event.seq,
      type: event.type,
      actor: event.actor,
      payload: event.payload,
      createdAt: event.createdAt,
    };
    const canonical = canonicalize(hashable);
    if (!canonical.ok) {
      return err({
        brokenAtSeq: event.seq,
        reason: "HASH_MISMATCH",
        details: "Payload is not canonicalisable",
      });
    }
    const expectedHash = sha256Hex(event.prevHash + canonical.value);
    if (expectedHash !== event.hash) {
      return err({
        brokenAtSeq: event.seq,
        reason: "HASH_MISMATCH",
        details: `Expected ${expectedHash}, got ${event.hash}`,
      });
    }

    prevHash = event.hash;
  }

  const last = events[events.length - 1];
  invariant(last !== undefined, "last event must exist");

  return ok({ length: events.length, headHash: last.hash });
}
