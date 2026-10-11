/**
 * Request ID helper.
 *
 * Reads the `x-request-id` header from an incoming request, or generates
 * a fresh UUID through the injected IdGenerator if none is present.
 *
 * The request ID is propagated to all log lines via childLogger({ requestId }).
 *
 * ARCHITECTURE.md §16: "Every line carries requestId."
 */

import type { IdGenerator } from "../../domain/shared/clock.js";

export function getOrCreateRequestId(request: Request, idGenerator: IdGenerator): string {
  return request.headers.get("x-request-id") ?? idGenerator.uuid();
}
