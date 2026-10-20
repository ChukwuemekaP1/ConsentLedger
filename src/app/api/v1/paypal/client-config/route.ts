/**
 * GET /api/v1/paypal/client-config
 *
 * Exposes safe, public PayPal client configuration to the browser.
 * Never leaks the client secret (I-12).
 *
 * ARCHITECTURE.md §6, §13.
 */

import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";

export async function GET(request: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(request, container.idGenerator);

  const clientId =
    container.config.NEXT_PUBLIC_PAYPAL_CLIENT_ID || container.config.PAYPAL_CLIENT_ID || "";

  return Response.json(
    {
      clientId,
      currency: "USD",
      environment: container.config.PAYPAL_ENV,
      // Non-secret mode flags so the UI can label demo data and simulated settlement honestly.
      settlementMode: container.config.SETTLEMENT_MODE,
      catalogMode: container.config.CATALOG_MODE,
    },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
        "X-Request-Id": requestId,
      },
    },
  );
}
