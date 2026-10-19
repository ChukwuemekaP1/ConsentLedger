/**
 * Merkle tree for ledger checkpoints.
 *
 * Domain separation (RFC 6962 §2.1 approach):
 *   leafHash(x)   = sha256(0x00 || data)   — prefix 0x00
 *   nodeHash(l,r) = sha256(0x01 || l || r) — prefix 0x01
 *
 * This prevents second-preimage attacks where an internal node is presented as a leaf.
 *
 * Odd-node handling: the last unpaired node is promoted (not duplicated).
 * This differs from some RFC 6962 implementations. No RFC 6962 compatibility is claimed.
 *
 * Leaf definition (ARCHITECTURE.md §8.2):
 *   leafHash(correlationId, headHash) = sha256(0x00 || sha256(correlationId || headHash))
 *
 * INVARIANT: I-04 — checkpoints anchor history.
 * ADR-0003.
 */

import { sha256Hex } from "../crypto/hash.js";
import { invariant } from "../shared/invariant.js";
import { type Result, ok, err } from "../shared/result.js";

// ─── Domain-separated hash functions ─────────────────────────────────────────

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/**
 * leafHash — compute the leaf hash for a correlation's chain head.
 * leafHash = sha256(0x00 || sha256(correlationId || headHash))
 */
export function leafHash(correlationId: string, headHash: string): string {
  const inner = sha256Hex(correlationId + headHash);
  const innerBuf = Buffer.from(inner, "hex");
  return sha256Hex(Buffer.concat([LEAF_PREFIX, innerBuf]));
}

/**
 * nodeHash — combine two child hashes.
 * nodeHash = sha256(0x01 || left || right)
 */
function nodeHash(left: string, right: string): string {
  const leftBuf = Buffer.from(left, "hex");
  const rightBuf = Buffer.from(right, "hex");
  return sha256Hex(Buffer.concat([NODE_PREFIX, leftBuf, rightBuf]));
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

export interface MerkleTree {
  readonly leaves: readonly string[];
  readonly root: string;
  /** levels[0] = leaf level, levels[last] = [root]. Used for proof generation. */
  readonly levels: readonly (readonly string[])[];
}

/** Build a Merkle tree from leaf hashes (64-char hex each). */
export function buildTree(leaves: readonly string[]): MerkleTree {
  if (leaves.length === 0) {
    return { leaves: [], root: "0".repeat(64), levels: [] };
  }

  const levels: string[][] = [Array.from(leaves)];
  let current: string[] = Array.from(leaves);

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      invariant(left !== undefined, `current[${i}] must exist`);
      if (i + 1 < current.length) {
        const right = current[i + 1];
        invariant(right !== undefined, `current[${i + 1}] must exist`);
        next.push(nodeHash(left, right));
      } else {
        // Odd node: promote without pairing
        next.push(left);
      }
    }
    levels.push(next);
    current = next;
  }

  const rootNode = current[0];
  invariant(rootNode !== undefined, "root must exist after tree construction");

  return { leaves, root: rootNode, levels };
}

// ─── Inclusion proof ──────────────────────────────────────────────────────────

export interface ProofStep {
  readonly sibling: string;
  readonly siblingIsLeft: boolean;
}

export interface InclusionProof {
  readonly leafIndex: number;
  readonly steps: readonly ProofStep[];
}

/** Generate a Merkle inclusion proof for the leaf at `index`. */
export function proveInclusion(
  tree: MerkleTree,
  index: number,
): Result<InclusionProof, { reason: string }> {
  if (tree.leaves.length === 0) {
    return err({ reason: "Empty tree" });
  }
  if (index < 0 || index >= tree.leaves.length) {
    return err({ reason: `Index ${index} out of range [0, ${tree.leaves.length})` });
  }

  const steps: ProofStep[] = [];
  let currentIndex = index;

  for (let level = 0; level < tree.levels.length - 1; level++) {
    const levelNodes = tree.levels[level];
    invariant(levelNodes !== undefined, `level ${level} must exist`);
    const sibling = getSibling(levelNodes, currentIndex);
    if (sibling !== null) {
      steps.push(sibling);
    }
    currentIndex = Math.floor(currentIndex / 2);
  }

  return ok({ leafIndex: index, steps });
}

function getSibling(level: readonly string[], index: number): ProofStep | null {
  if (index % 2 === 0) {
    // Current is left; sibling is right
    if (index + 1 < level.length) {
      const sib = level[index + 1];
      invariant(sib !== undefined, "sibling must exist");
      return { sibling: sib, siblingIsLeft: false };
    }
    // Promoted node — no sibling
    return null;
  } else {
    // Current is right; sibling is left
    const sib = level[index - 1];
    invariant(sib !== undefined, "left sibling must exist for right node");
    return { sibling: sib, siblingIsLeft: true };
  }
}

/**
 * Verify that a leaf is included in the tree with the given root.
 */
export function verifyInclusion(leaf: string, proof: InclusionProof, root: string): boolean {
  let current = leaf;

  for (const step of proof.steps) {
    if (step.siblingIsLeft) {
      current = nodeHash(step.sibling, current);
    } else {
      current = nodeHash(current, step.sibling);
    }
  }

  return current === root;
}
