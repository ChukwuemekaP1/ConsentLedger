/**
 * GET /api/v1/health
 *
 * Liveness and version endpoint. No authentication required.
 * `time` comes from the injected Clock so the response is testable.
 *
 * Response:
 *   { status: "ok", version: string, commit: string, time: string }
 *
 * ARCHITECTURE.md §13 and §16.
 */

import { container } from "../../../../container.js";
import { getOrCreateRequestId } from "../../../../interface/http/request-id.js";
import { toProblemResponse, fromUnknown } from "../../../../interface/http/problem.js";
import packageJson from "../../../../../package.json" with { type: "json" };

export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    const body = {
      status: "ok" as const,
      version: packageJson.version,
      commit: container.config.COMMIT,
      time: container.clock.now(),
    };

    log.info({ event: "health.ok", version: body.version }, "health check");

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    log.error({ event: "health.error", error }, "health check failed");
    return toProblemResponse(fromUnknown(new URL(request.url).pathname));
  }
}
