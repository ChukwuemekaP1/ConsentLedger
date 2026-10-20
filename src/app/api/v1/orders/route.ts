/**
 * POST /api/v1/orders
 *
 * Initiates an authorized checkout order with PayPal Orders v2 for an approved mandate.
 * Enforces Gate verification (I-01) and write-ahead atomic transitions (ADR-0006).
 *
 * ARCHITECTURE.md §6, §13.
 */

import { z } from "zod";
import { container } from "../../../../container.js";
import { getOrCreateRequestId } from "../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../interface/http/problem.js";

const CreateOrderBodySchema = z
  .object({
    mandateId: z.string().uuid("mandateId must be a valid UUID"),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
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
      log.warn({ event: "orders.unauthenticated" }, "Missing or invalid session cookie");
      return toProblemResponse(
        fromAppError(
          {
            code: "UNAUTHENTICATED",
            message: "Authentication required to initiate checkout order",
          },
          url.pathname,
        ),
      );
    }

    // 2. Parse request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: "Request body must be valid JSON",
          },
          url.pathname,
        ),
      );
    }

    const parseResult = CreateOrderBodySchema.safeParse(body);
    if (!parseResult.success) {
      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: parseResult.error.issues.map((i) => i.message).join("; "),
          },
          url.pathname,
        ),
      );
    }

    // 3. Execute CreateOrderUseCase
    const useCase = container.getCreateOrder();
    const result = await useCase.execute({
      mandateId: parseResult.data.mandateId,
    });

    if (!result.ok) {
      log.warn({ event: "orders.creation_failed", error: result.error }, "Order creation rejected");

      switch (result.error.kind) {
        case "MANDATE_NOT_FOUND":
          return toProblemResponse(
            fromAppError(
              {
                code: "MANDATE_NOT_FOUND",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "CONSENT_MISSING":
          return toProblemResponse(
            fromAppError(
              {
                code: "CONSENT_MISSING",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "CONSENT_INVALID":
          return toProblemResponse(
            fromAppError(
              {
                code: "CONSENT_INVALID",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "GATE_DENIED":
          return toProblemResponse(
            fromAppError(
              {
                code: result.error.code,
                message: `Gate denied order execution: ${result.error.message}`,
              },
              url.pathname,
            ),
          );

        case "PROVIDER_OUTCOME_UNKNOWN":
          return toProblemResponse(
            fromAppError(
              {
                code: "INTERNAL",
                message: "Payment provider outcome unknown; reconciliation needed",
              },
              url.pathname,
            ),
          );

        case "PROVIDER_ERROR":
        case "PAYMENT_FAILED":
        case "POLICY_NOT_FOUND":
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
        orderId: result.value.orderId,
        paymentMandateId: result.value.paymentMandateId,
        status: result.value.status,
      },
      "PayPal order created successfully",
    );

    return Response.json(
      {
        orderId: result.value.orderId,
        paymentMandateId: result.value.paymentMandateId,
        status: result.value.status,
        links: result.value.links,
      },
      {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (error) {
    log.error({ error }, "Unexpected error in POST /api/v1/orders");
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
