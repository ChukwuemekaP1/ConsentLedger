/**
 * POST /api/v1/orders/[id]/capture
 *
 * Captures an approved PayPal Orders v2 payment attempt under Gate protection (ADR-0006).
 * Treats the order ID as an untrusted reference, re-verifies mandate terms, consent,
 * and policy, reserves the capture attempt (TX3: CAPTURE_REQUESTED), calls PayPal,
 * and commits the verified outcome (TX4: CAPTURED, SETTLED, CAPTURE_COMPLETED).
 *
 * ARCHITECTURE.md §6, §13.
 */

import { z } from "zod";
import { container } from "../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../interface/http/problem.js";

const CaptureBodySchema = z
  .object({
    mandateId: z.string().uuid("mandateId must be a valid UUID").optional(),
  })
  .strict()
  .optional();

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
      log.warn({ event: "orders.capture.unauthenticated" }, "Missing or invalid session cookie");
      return toProblemResponse(
        fromAppError(
          {
            code: "UNAUTHENTICATED",
            message: "Authentication required to capture payment order",
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
            message: "Order ID parameter is required",
          },
          url.pathname,
        ),
      );
    }

    // 3. Parse optional request body
    let mandateId: string | undefined;
    const textBody = await request.text().catch(() => "");
    if (textBody.trim().length > 0) {
      let jsonBody: unknown;
      try {
        jsonBody = JSON.parse(textBody);
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

      const parseResult = CaptureBodySchema.safeParse(jsonBody);
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
      mandateId = parseResult.data?.mandateId;
    }

    // 4. Execute CaptureOrderUseCase
    const useCase = container.getCaptureOrder();
    const result = await useCase.execute({
      orderId,
      mandateId,
    });

    if (!result.ok) {
      log.warn(
        { event: "orders.capture.failed", orderId, error: result.error },
        "Order capture rejected",
      );

      switch (result.error.kind) {
        case "ORDER_NOT_FOUND":
          return toProblemResponse(
            fromAppError(
              {
                code: "NOT_FOUND",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

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

        case "MANDATE_EXPIRED":
          return toProblemResponse(
            fromAppError(
              {
                code: "MANDATE_EXPIRED",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "MANDATE_REVOKED":
          return toProblemResponse(
            fromAppError(
              {
                code: "MANDATE_REVOKED",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "MANDATE_STATE_INVALID":
        case "INVALID_STATE":
          return toProblemResponse(
            fromAppError(
              {
                code: "MANDATE_STATE_INVALID",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "MANDATE_MISMATCH":
        case "TERMS_MISMATCH":
          return toProblemResponse(
            fromAppError(
              {
                code: "TERMS_MISMATCH",
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

        case "POLICY_NOT_FOUND":
        case "POLICY_DENIED":
          return toProblemResponse(
            fromAppError(
              {
                code: "POLICY_DENIED",
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
                message: `Gate denied capture: ${result.error.message}`,
              },
              url.pathname,
            ),
          );

        case "CONCURRENT_CAPTURE":
        case "REPLAY_DETECTED":
          return toProblemResponse(
            fromAppError(
              {
                code: "REPLAY_DETECTED",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "PROVIDER_OUTCOME_UNKNOWN":
        case "RECONCILIATION_REQUIRED":
          return toProblemResponse(
            fromAppError(
              {
                code: "PROVIDER_OUTCOME_UNKNOWN",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "PROVIDER_PENDING":
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
        orderId: result.value.orderId,
        captureId: result.value.captureId,
        status: result.value.status,
      },
      "PayPal order captured successfully",
    );

    return Response.json(
      {
        orderId: result.value.orderId,
        captureId: result.value.captureId,
        status: result.value.status,
        alreadyCaptured: result.value.alreadyCaptured,
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
    log.error({ error }, "Unexpected error in POST /api/v1/orders/[id]/capture");
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
