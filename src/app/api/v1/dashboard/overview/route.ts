/**
 * GET /api/v1/dashboard/overview
 *
 * Returns authoritative business budget and activity summary for the authenticated workspace.
 *
 * ARCHITECTURE.md §12, §13
 * INVARIANTS: I-02, I-03, I-10, I-11.
 */

import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../interface/http/problem.js";

export async function GET(request: Request): Promise<Response> {
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

    const requestedWorkspaceId = url.searchParams.get("workspaceId");
    const isDemoRequested =
      requestedWorkspaceId === "demo-northstar" || url.searchParams.get("demo") === "true";

    // 2. Enforce workspace authorization (Requirement 7)
    if (!isDemoRequested) {
      if (!authenticatedPrincipalId) {
        log.warn({ event: "dashboard.overview.unauthenticated" }, "Missing session cookie");
        return toProblemResponse(
          fromAppError(
            {
              code: "UNAUTHENTICATED",
              message: "Authentication required to view business overview",
            },
            url.pathname,
          ),
        );
      }

      if (requestedWorkspaceId && requestedWorkspaceId !== authenticatedPrincipalId) {
        log.warn(
          {
            event: "dashboard.overview.forbidden",
            requestedWorkspaceId,
            authenticatedPrincipalId,
          },
          "Workspace access denied",
        );
        return toProblemResponse(
          fromAppError(
            {
              code: "FORBIDDEN",
              message: "Workspace authorization failed: cannot access records of another business",
            },
            url.pathname,
          ),
        );
      }
    }

    const principalId = isDemoRequested ? "demo-northstar" : (authenticatedPrincipalId ?? "");

    // 3. Query authoritative overview
    const query = container.getDashboardQuery();
    const overview = await query.getOverview(principalId, isDemoRequested);

    return Response.json(overview, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
    });
  } catch (err: unknown) {
    log.error({ event: "dashboard.overview.error", err }, "Failed to fetch dashboard overview");
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
