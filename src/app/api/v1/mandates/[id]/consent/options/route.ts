/**
 * POST /api/v1/mandates/:id/consent/options
 *
 * Generates WebAuthn authentication options for mandate consent.
 * The challenge is cryptographically bound to the exact mandate hash.
 *
 * ARCHITECTURE.md §4.2, §13, INVARIANTS I-05, I-11, I-12.
 */

import { container } from "../../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../../interface/http/problem.js";

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
    if (cookieHeader && container.config.SESSION_SECRET) {
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
        { event: "mandate.consent.options.unauthenticated" },
        "Missing or invalid session cookie",
      );
      return toProblemResponse(
        fromAppError(
          {
            code: "UNAUTHENTICATED",
            message: "Authentication required to generate consent options",
          },
          url.pathname,
        ),
      );
    }

    const rpId = container.config.WEBAUTHN_RP_ID ?? url.hostname;
    const trustedKeys = container.getTrustedKeys();

    const useCase = container.getGenerateConsentOptions();
    const result = await useCase.execute({
      mandateId,
      authenticatedPrincipalId,
      rpId,
      trustedKeys,
    });

    if (!result.ok) {
      log.warn(
        { event: "mandate.consent.options.error", errorKind: result.error.kind },
        result.error.message,
      );
      let code: "NOT_FOUND" | "FORBIDDEN" | "MANDATE_EXPIRED" | "VALIDATION_FAILED" =
        "VALIDATION_FAILED";
      if (result.error.kind === "MANDATE_NOT_FOUND" || result.error.kind === "POLICY_NOT_FOUND") {
        code = "NOT_FOUND";
      } else if (result.error.kind === "FORBIDDEN") {
        code = "FORBIDDEN";
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

    return new Response(JSON.stringify(result.value.options), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    log.error(
      { event: "mandate.consent.options.unhandled", error },
      "Unhandled error in consent options",
    );
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
