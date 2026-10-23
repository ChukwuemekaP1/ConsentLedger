/**
 * POST /api/v1/lab/verify-bundle
 *
 * Runs the pure domain offline evidence verifier (verifyEvidenceBundle) on valid,
 * tampered, or custom evidence bundles.
 *
 * ARCHITECTURE.md §11, ADR-0002, ADR-0003
 * INVARIANTS: I-04, I-05, I-09.
 */

import { z } from "zod";
import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../interface/http/problem.js";
import {
  verifyEvidenceBundle,
  createValidBundleFixture,
} from "../../../../../domain/evidence/index.js";
import type { TrustStore, EvidenceBundle } from "../../../../../domain/evidence/types.js";
import { labDisabledResponse } from "../../../../../interface/http/lab-guard.js";

const VerifyBundleBodySchema = z
  .object({
    mode: z.enum(["valid", "tampered", "custom"]).default("valid"),
    tamperType: z.enum(["terms", "hash", "signature"]).optional().default("terms"),
    bundle: z.unknown().optional(),
    trustStore: z.unknown().optional(),
  })
  .strict();

export function formatTerminalOutput(
  mode: string,
  result: ReturnType<typeof verifyEvidenceBundle>,
  correlationId?: string,
): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("  CONSENTLEDGER OFFLINE EVIDENCE VERIFIER (v1)");
  lines.push("================================================================================");
  lines.push(`  Target Mode:  ${mode.toUpperCase()}`);
  lines.push("  Network:      OFFLINE (0 network calls, 0 database queries, 0 private keys)");
  lines.push("--------------------------------------------------------------------------------");

  const checks = result.ok ? result.value.checks : result.error.checks;
  for (const check of checks) {
    const tag = `[${check.status}]`.padEnd(8, " ");
    lines.push(`  ${tag} ${check.id}: ${check.name}`);
    if (check.details) {
      lines.push(`           ${check.details}`);
    }
  }

  lines.push("--------------------------------------------------------------------------------");

  if (result.ok) {
    lines.push("  RESULT: VERIFIED VALID OFFLINE");
    lines.push(`  Correlation ID: ${result.value.correlationId}`);
    lines.push(`  Summary:        ${result.value.summary}`);
    lines.push("");
    lines.push("  NOTICE: Offline verification proves cryptographic integrity, passkey consent");
    lines.push(
      "  binding, and ledger consistency. It does NOT prove external merchant fulfillment",
    );
    lines.push("  or independent PayPal server state.");
  } else {
    lines.push("  RESULT: VERIFICATION FAILED");
    lines.push(`  Failed Check:   ${result.error.failedCheck}`);
    lines.push(`  Reason Code:    ${result.error.code}`);
    lines.push(`  Message:        ${result.error.message}`);
  }

  lines.push("================================================================================");
  return lines.join("\n");
}

export async function POST(request: Request): Promise<Response> {
  if (!container.isLabEnabled()) return labDisabledResponse();
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);

  try {
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch {
      return toProblemResponse(
        fromAppError(
          { code: "VALIDATION_FAILED", message: "Request body must be valid JSON" },
          url.pathname,
        ),
      );
    }

    const parseResult = VerifyBundleBodySchema.safeParse(body);
    if (!parseResult.success) {
      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues.map((i) => i.message).join("; "),
          },
          url.pathname,
        ),
      );
    }

    const {
      mode,
      tamperType,
      bundle: customBundle,
      trustStore: customTrustStore,
    } = parseResult.data;

    let targetBundle: unknown;
    let targetTrustStore: TrustStore | null = null;
    let correlationId: string = "unknown";

    if (mode === "valid") {
      const fixture = createValidBundleFixture();
      targetBundle = fixture.bundle;
      targetTrustStore = fixture.trustStore;
      correlationId = fixture.bundle.correlationId;
    } else if (mode === "tampered") {
      const fixture = createValidBundleFixture();
      const tampered = JSON.parse(JSON.stringify(fixture.bundle)) as EvidenceBundle;
      correlationId = tampered.correlationId;

      if (tamperType === "terms") {
        // Tamper terms: modify amount from $49.99 to $999.00
        const firstMandate = tampered.mandates[0];
        if (firstMandate && firstMandate.terms.kind === "CART") {
          (firstMandate.terms as { payment: { amountMinor: number } }).payment.amountMinor = 99900;
        }
      } else if (tamperType === "hash") {
        // Tamper ledger hash chain
        if (tampered.ledger.events[0]) {
          (tampered.ledger.events[0] as { hash: string }).hash =
            "0000000000000000000000000000000000000000000000000000000000000000";
        }
      } else {
        // Tamper authority signature
        const firstMandate = tampered.mandates[0];
        if (firstMandate) {
          (firstMandate as { attestations: unknown }).attestations = [
            {
              signerRole: "AUTHORITY",
              keyId: "tampered-key",
              signature: "invalid-signature-bytes",
              signedAt: "2026-10-15T12:00:00.000Z",
            },
          ];
        }
      }

      targetBundle = tampered;
      targetTrustStore = fixture.trustStore;
    } else {
      if (!customBundle) {
        return toProblemResponse(
          fromAppError(
            { code: "VALIDATION_FAILED", message: "Bundle data required for custom mode" },
            url.pathname,
          ),
        );
      }
      targetBundle = customBundle;
      targetTrustStore = (customTrustStore as TrustStore | null | undefined) ?? null;
      if (typeof customBundle === "object" && "correlationId" in customBundle) {
        correlationId = String((customBundle as { correlationId: unknown }).correlationId);
      }
    }

    // Execute pure domain verification
    const verificationResult = verifyEvidenceBundle(targetBundle, targetTrustStore);
    const terminalOutput = formatTerminalOutput(
      mode === "tampered" ? `tampered (${tamperType})` : mode,
      verificationResult,
      correlationId,
    );

    return Response.json(
      {
        mode,
        tamperType: mode === "tampered" ? tamperType : undefined,
        valid: verificationResult.ok,
        failedCheck: verificationResult.ok ? undefined : verificationResult.error.failedCheck,
        code: verificationResult.ok ? undefined : verificationResult.error.code,
        message: verificationResult.ok
          ? verificationResult.value.summary
          : verificationResult.error.message,
        checks: verificationResult.ok
          ? verificationResult.value.checks
          : verificationResult.error.checks,
        terminalOutput,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  } catch {
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
