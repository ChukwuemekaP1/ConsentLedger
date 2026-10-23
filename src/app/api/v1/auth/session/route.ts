/**
 * Auth Session Route: /api/v1/auth/session
 *
 * Provides dedicated session issuance and verification for the single authorized
 * executive principal (Alex Vance).
 *
 * Implements Invariant I-07 and Invariant I-12:
 * Signed HMAC-SHA256 session cookie (cl_session).
 */

import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";
import { fromAppError, toProblemResponse } from "../../../../../interface/http/problem.js";

export const DEFAULT_PRINCIPAL_ID = "a11ce000-0000-4000-8000-000000000001";
export const DEFAULT_DISPLAY_NAME = "Alex Vance";

/**
 * GET: Check current session status
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
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
      return new Response(
        JSON.stringify({
          authenticated: false,
          principalId: null,
          displayName: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    }

    let displayName = DEFAULT_DISPLAY_NAME;
    try {
      const overview = await container.getDashboardQuery().getOverview(authenticatedPrincipalId);
      if (overview.workspace.displayName) {
        displayName = overview.workspace.displayName;
      }
    } catch {
      // Fallback to default
    }

    let hasRegisteredPasskey = false;
    try {
      const credentials = await container
        .getPasskeyRepo()
        .listCredentialsByPrincipalId(authenticatedPrincipalId);
      hasRegisteredPasskey = credentials.length > 0;
    } catch {
      // Fallback
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        principalId: authenticatedPrincipalId,
        displayName,
        hasRegisteredPasskey,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  } catch (error) {
    log.error({ error }, "Error checking session status");
    return toProblemResponse(
      fromAppError(
        { code: "INTERNAL", message: "Failed to verify session" },
        new URL(request.url).pathname,
      ),
    );
  }
}

/**
 * POST: Establish authenticated session for the dedicated executive persona
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    let principalId = DEFAULT_PRINCIPAL_ID;
    let displayName = DEFAULT_DISPLAY_NAME;

    try {
      const body = (await request.json()) as
        { principalId?: unknown; displayName?: unknown } | null | undefined;
      if (body && typeof body.principalId === "string") {
        principalId = body.principalId;
      }
      if (body && typeof body.displayName === "string") {
        displayName = body.displayName;
      }
    } catch {
      // Body is optional; fallback to defaults
    }

    const sessionToken = container.getSessionService().sign(principalId, 86400); // 24-hour session
    const isProd = container.config.NODE_ENV === "production";
    const secureFlag = isProd ? "; Secure" : "";

    const headers = new Headers();
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set(
      "set-cookie",
      `cl_session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureFlag}`,
    );

    log.info({ principalId, displayName }, "Session successfully established for principal");

    return new Response(
      JSON.stringify({
        status: "ok",
        authenticated: true,
        principalId,
        displayName,
      }),
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    log.error({ error }, "Error issuing session");
    return toProblemResponse(
      fromAppError(
        { code: "INTERNAL", message: "Failed to establish session" },
        new URL(request.url).pathname,
      ),
    );
  }
}

/**
 * DELETE: Terminate session (sign out)
 */
export async function DELETE(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  log.info("Terminating session");
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("set-cookie", "cl_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");

  return new Response(
    JSON.stringify({
      status: "ok",
      authenticated: false,
    }),
    {
      status: 200,
      headers,
    },
  );
}
