/**
 * POST /api/v1/orders/[id]/reconcile
 *
 * Reconciles an order's payment status against authoritative PayPal state.
 * Transitions pending/unknown outcomes to CAPTURED or FAILED atomically.
 *
 * ARCHITECTURE.md §6, §12.
 */

import { container } from "../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../interface/http/problem.js";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: orderId } = await params;
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    // 1. Authenticate principal via session cookie
    const cookieHeader = request.headers.get("cookie");
    let authenticatedPrincipalId: string | undefined;
    if (cookieHeader && (container.config.SESSION_SECRET || container.config.NODE_ENV === "test")) {
      const match = cookieHeader.match(/cl_session=([^;]+)/);
      if (match && match[1]) {
        const sessionResult = container.getSessionService().verify(match[1]);
        if (sessionResult.ok) {
          authenticatedPrincipalId = sessionResult.value.sub;
        }
      }
    }

    if (!authenticatedPrincipalId) {
      log.warn({ event: "orders.reconcile.unauthenticated" }, "Missing or invalid session cookie");
      return toProblemResponse(
        fromAppError(
          {
            code: "UNAUTHENTICATED",
            message: "Authentication required to reconcile payment order",
          },
          url.pathname,
        ),
      );
    }

    // 2. Validate order ID parameter
    if (!orderId || orderId.trim().length === 0) {
      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: "Missing or invalid order ID route parameter",
          },
          url.pathname,
        ),
      );
    }

    // 3. Execute reconciliation use case
    const useCase = container.getReconcilePayment();
    const result = await useCase.execute({ orderId });

    if (!result.ok) {
      log.warn(
        { orderId, error: result.error, event: "orders.reconcile.failed" },
        "Order reconciliation failed",
      );

      switch (result.error.kind) {
        case "ORDER_NOT_FOUND":
        case "MANDATE_NOT_FOUND":
          return toProblemResponse(
            fromAppError(
              {
                code: "NOT_FOUND",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "PROVIDER_ERROR":
          return toProblemResponse(
            fromAppError(
              {
                code: "PROVIDER_ERROR",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "PERSISTENCE_FAILED":
        default:
          return toProblemResponse(
            fromAppError(
              {
                code: "INTERNAL",
                message: result.error.message,
              },
              url.pathname,
            ),
          );
      }
    }

    log.info(
      {
        orderId,
        status: result.value.status,
        event: "orders.reconcile.success",
      },
      "Order reconciled successfully",
    );

    return Response.json(
      {
        orderId: result.value.orderId,
        status: result.value.status,
        reconciled: result.value.reconciled,
        details: result.value.details,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (error) {
    log.error(
      { error, orderId, event: "orders.reconcile.exception" },
      "Unhandled exception in reconcile endpoint",
    );
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
