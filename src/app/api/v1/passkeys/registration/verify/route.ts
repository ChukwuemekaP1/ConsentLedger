/**
 * POST /api/v1/passkeys/registration/verify
 *
 * Verifies WebAuthn registration response and establishes passkey identity and session.
 *
 * ARCHITECTURE.md §13, §15, INVARIANTS I-05, I-12.
 */

import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { container } from "../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../interface/http/problem.js";

const registrationVerifySchema = z.object({
  displayName: z.string().optional(),
  response: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    const rawBody = await request.json().catch(() => null);
    const parseResult = registrationVerifySchema.safeParse(rawBody);

    if (!parseResult.success) {
      log.warn({ event: "passkey.registration.verify.invalid_input" }, "Validation failed");
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

    // Check existing session
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

    const rpId = container.config.WEBAUTHN_RP_ID ?? url.hostname;
    const origin = container.config.WEBAUTHN_ORIGIN ?? url.origin;

    const useCase = container.getRegisterPasskey();
    const result = await useCase.execute({
      response: parseResult.data.response as unknown as RegistrationResponseJSON,
      authenticatedPrincipalId,
      displayName: parseResult.data.displayName,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });

    if (!result.ok) {
      log.warn(
        { event: "passkey.registration.verify.error", errorKind: result.error.kind },
        result.error.message,
      );
      let code: "VALIDATION_FAILED" | "FORBIDDEN" | "REPLAY_DETECTED" | "NOT_FOUND" =
        "VALIDATION_FAILED";
      if (
        result.error.kind === "CHALLENGE_EXPIRED" ||
        result.error.kind === "CHALLENGE_NOT_FOUND"
      ) {
        code = "REPLAY_DETECTED";
      } else if (result.error.kind === "PRINCIPAL_MISMATCH") {
        code = "FORBIDDEN";
      } else if (result.error.kind === "CREDENTIAL_ALREADY_EXISTS") {
        code = "VALIDATION_FAILED";
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

    // Issue signed session JWT cookie
    const headers = new Headers();
    headers.set("content-type", "application/json; charset=utf-8");

    if (container.config.SESSION_SECRET || container.config.NODE_ENV !== "production") {
      const sessionToken = container.getSessionService().sign(result.value.principalId);
      const isProd = container.config.NODE_ENV === "production";
      const secureFlag = isProd ? "; Secure" : "";
      headers.set(
        "set-cookie",
        `cl_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secureFlag}`,
      );
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        principalId: result.value.principalId,
        credentialId: result.value.credentialId,
      }),
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    log.error(
      { event: "passkey.registration.verify.unhandled", error },
      "Unhandled error in registration verify",
    );
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
