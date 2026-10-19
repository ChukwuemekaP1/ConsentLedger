/**
 * POST /api/v1/passkeys/registration/options
 *
 * Generates WebAuthn registration options.
 *
 * ARCHITECTURE.md §13.
 */

import { z } from "zod";
import { container } from "../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../interface/http/problem.js";

const registrationOptionsSchema = z.object({
  displayName: z.string().min(1).max(255),
});

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    const rawBody = await request.json().catch(() => ({}));
    const parseResult = registrationOptionsSchema.safeParse(rawBody);

    if (!parseResult.success) {
      log.warn({ event: "passkey.registration.options.invalid_input" }, "Validation failed");
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

    // Check if caller has an existing session
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

    const rpId = container.config.WEBAUTHN_RP_ID ?? url.hostname;
    const rpName = "ConsentLedger";
    const origin = container.config.WEBAUTHN_ORIGIN ?? url.origin;

    const useCase = container.getGenerateRegistrationOptions();
    const result = await useCase.execute({
      principalId: authenticatedPrincipalId,
      displayName: parseResult.data.displayName,
      rpId,
      rpName,
      origin,
    });

    if (!result.ok) {
      log.warn(
        { event: "passkey.registration.options.error", errorKind: result.error.kind },
        result.error.message,
      );
      return toProblemResponse(
        fromAppError(
          {
            code: result.error.kind === "PRINCIPAL_NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_FAILED",
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
      { event: "passkey.registration.options.unhandled", error },
      "Unhandled error in registration options",
    );
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
