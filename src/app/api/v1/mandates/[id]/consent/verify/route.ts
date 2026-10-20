/**
 * POST /api/v1/mandates/:id/consent/verify
 *
 * Verifies a passkey assertion, mints VerifiedConsent capability, transitions mandate status
 * from ISSUED to SIGNED, and appends CONSENT_RECORDED to the evidence ledger.
 *
 * ARCHITECTURE.md §4.2, §13, INVARIANTS I-04, I-05, I-11, I-12.
 */

import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { container } from "../../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../../interface/http/problem.js";

const consentVerifySchema = z.object({
  assertion: z.record(z.string(), z.unknown()),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: mandateId } = await params;
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    // 1. Authenticate principal via session cookie
    const cookieHeader = request.headers.get("cookie");
    let authenticatedPrincipalId: string | undefined;
    if (
      cookieHeader &&
      (container.config.SESSION_SECRET || container.config.NODE_ENV !== "production")
    ) {
      const match = cookieHeader.match(/cl_session=([^;]+)/);
      if (match && match[1]) {
        const sessionResult = container.getSessionService().verify(match[1]);
        if (sessionResult.ok) {
          authenticatedPrincipalId = sessionResult.value.sub;
        }
      }
    }

    if (!authenticatedPrincipalId) {
      log.warn(
        { event: "mandate.consent.verify.unauthenticated" },
        "Missing or invalid session cookie",
      );
      return toProblemResponse(
        fromAppError(
          {
            code: "UNAUTHENTICATED",
            message: "Authentication required to verify consent",
          },
          url.pathname,
        ),
      );
    }

    // 2. Parse request body
    const rawBody = await request.json().catch(() => null);
    const parseResult = consentVerifySchema.safeParse(rawBody);

    if (!parseResult.success) {
      log.warn({ event: "mandate.consent.verify.invalid_input" }, "Validation failed");
      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
          url.pathname,
        ),
      );
    }

    const rpId = container.config.WEBAUTHN_RP_ID ?? url.hostname;
    const origin = container.config.WEBAUTHN_ORIGIN ?? url.origin;
    const trustedKeys = container.getTrustedKeys();

    const useCase = container.getRecordConsent();
    const result = await useCase.execute({
      mandateId,
      authenticatedPrincipalId,
      assertion: parseResult.data.assertion as unknown as AuthenticationResponseJSON,
      expectedOrigin: origin,
      expectedRPID: rpId,
      trustedKeys,
    });

    if (!result.ok) {
      log.warn(
        { event: "mandate.consent.verify.error", errorKind: result.error.kind },
        result.error.message,
      );
      let code:
        | "NOT_FOUND"
        | "FORBIDDEN"
        | "REPLAY_DETECTED"
        | "CONSENT_INVALID"
        | "MANDATE_STATE_INVALID"
        | "VALIDATION_FAILED" = "VALIDATION_FAILED";

      if (result.error.kind === "MANDATE_NOT_FOUND" || result.error.kind === "POLICY_NOT_FOUND") {
        code = "NOT_FOUND";
      } else if (result.error.kind === "FORBIDDEN" || result.error.kind === "PRINCIPAL_MISMATCH") {
        code = "FORBIDDEN";
      } else if (
        result.error.kind === "CHALLENGE_EXPIRED" ||
        result.error.kind === "CHALLENGE_NOT_FOUND" ||
        result.error.kind === "CONSENT_ALREADY_RECORDED"
      ) {
        code = "REPLAY_DETECTED";
      } else if (result.error.kind === "VERIFICATION_FAILED") {
        code = "CONSENT_INVALID";
      } else if (
        result.error.kind === "ILLEGAL_STATE_TRANSITION" ||
        result.error.kind === "GATE_DENIED"
      ) {
        code = "MANDATE_STATE_INVALID";
      }

      return toProblemResponse(
        fromAppError(
          {
            code,
            message: result.error.message,
          },
          url.pathname,
        ),
      );
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        mandateId: result.value.mandateId,
        mandateHash: result.value.mandateHash,
        credentialId: result.value.credentialId,
        mandateStatus: result.value.status,
        verifiedAt: result.value.verifiedAt,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  } catch (error) {
    log.error(
      { event: "mandate.consent.verify.unhandled", error },
      "Unhandled error in consent verify",
    );
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
