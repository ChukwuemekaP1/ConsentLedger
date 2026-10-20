/**
 * BuildEvidenceBundle use case.
 *
 * Assembles an exportable, self-verifying EvidenceBundle (v1) for a given correlation ID.
 * Follows ARCHITECTURE.md §11, ADR-0002, ADR-0003, and Invariant I-09.
 */

import type { Clock } from "../../domain/shared/clock.js";
import { type Result, ok, err } from "../../domain/shared/result.js";
import type {
  EvidenceBundle,
  BundleAuthority,
  BundlePrincipal,
  BundleMandate,
  BundleMerchant,
  BundlePaymentMandate,
  ProviderSnapshot,
} from "../../domain/evidence/types.js";
import type { LedgerRepo } from "../ports/ledger-repo.js";
import { leafHash, buildTree, proveInclusion } from "../../domain/ledger/merkle.js";

export interface BuildEvidenceBundleInput {
  readonly correlationId: string;
  readonly authority: BundleAuthority;
  readonly principal: BundlePrincipal;
  readonly mandates: readonly BundleMandate[];
  readonly merchants?: readonly BundleMerchant[] | undefined;
  readonly paymentMandates?: readonly BundlePaymentMandate[] | undefined;
  readonly providerSnapshots?: readonly ProviderSnapshot[] | undefined;
  readonly paypalOrderId?: string | undefined;
  readonly paypalCaptureIds?: readonly string[] | undefined;
  readonly checkpoint?:
    | {
        readonly size: number;
        readonly root: string;
        readonly signature: string;
        readonly keyId: string;
        readonly createdAt: string;
      }
    | undefined;
}

export type BuildBundleError =
  | { readonly kind: "NO_EVENTS_FOUND"; readonly message: string }
  | { readonly kind: "BUILD_FAILED"; readonly message: string };

export class BuildEvidenceBundle {
  constructor(
    private readonly clock: Clock,
    private readonly ledgerRepo: LedgerRepo,
  ) {}

  async execute(
    input: BuildEvidenceBundleInput,
  ): Promise<Result<EvidenceBundle, BuildBundleError>> {
    // 1. Retrieve all ledger events for this correlation
    const events = await this.ledgerRepo.getEvents(input.correlationId);
    if (events.length === 0) {
      return err({
        kind: "NO_EVENTS_FOUND",
        message: `No ledger events found for correlation ${input.correlationId}`,
      });
    }

    // 2. Compute inclusion proof if checkpoint is present
    let inclusionProof = undefined;
    if (input.checkpoint) {
      const heads = await this.ledgerRepo.getAllHeads();
      const leaves = heads.map((h) => leafHash(h.correlationId, h.headHash));
      const tree = buildTree(leaves);

      const targetHead = heads.find((h) => h.correlationId === input.correlationId);
      if (targetHead) {
        const targetLeaf = leafHash(targetHead.correlationId, targetHead.headHash);
        const index = leaves.indexOf(targetLeaf);
        if (index >= 0) {
          const proofRes = proveInclusion(tree, index);
          if (proofRes.ok) {
            inclusionProof = proofRes.value;
          }
        }
      }
    }

    // 3. Assemble bundle
    const bundle: EvidenceBundle = {
      bundleVersion: 1,
      generatedAt: this.clock.now(),
      correlationId: input.correlationId,
      authority: input.authority,
      principal: input.principal,
      mandates: input.mandates,
      ...(input.merchants && input.merchants.length > 0 ? { merchants: input.merchants } : {}),
      ...(input.paymentMandates && input.paymentMandates.length > 0
        ? { paymentMandates: input.paymentMandates }
        : {}),
      ledger: {
        events,
        ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
        ...(inclusionProof ? { inclusionProof } : {}),
      },
      ...(input.paypalOrderId ||
      input.paypalCaptureIds ||
      (input.providerSnapshots && input.providerSnapshots.length > 0)
        ? {
            provider: {
              ...(input.paypalOrderId ? { paypalOrderId: input.paypalOrderId } : {}),
              ...(input.paypalCaptureIds ? { paypalCaptureIds: input.paypalCaptureIds } : {}),
              ...(input.providerSnapshots && input.providerSnapshots.length > 0
                ? { snapshots: input.providerSnapshots }
                : {}),
            },
          }
        : {}),
    };

    return ok(bundle);
  }
}
