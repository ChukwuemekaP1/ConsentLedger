/**
 * POST /api/v1/paypal/webhooks
 *
 * Server-only webhook endpoint for PayPal event notifications.
 * Verifies webhook signature authenticity with PayPal, persists deliveries for
 * deduplication, updates payment and mandate states safely, and records tamper-evident
 * ledger events (I-04, I-06, ADR-0006).
 *
 * ARCHITECTURE.md §6, §9, §12.
 */

import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../interface/http/problem.js";

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    // 1. Extract required PayPal signature headers
    const authAlgo = request.headers.get("paypal-auth-algo");
    const certUrl = request.headers.get("paypal-cert-url");
    const transmissionId = request.headers.get("paypal-transmission-id");
    const transmissionSig = request.headers.get("paypal-transmission-sig");
    const transmissionTime = request.headers.get("paypal-transmission-time");

    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      log.warn(
        {
          event: "webhook.missing_headers",
          hasAuthAlgo: Boolean(authAlgo),
          hasCertUrl: Boolean(certUrl),
          hasTransmissionId: Boolean(transmissionId),
          hasTransmissionSig: Boolean(transmissionSig),
          hasTransmissionTime: Boolean(transmissionTime),
        },
        "Rejecting webhook request missing PayPal signature headers",
      );

      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: "Missing required PayPal webhook signature headers",
          },
          url.pathname,
        ),
      );
    }

    // 2. Parse request body JSON
    let rawBody: Record<string, unknown>;
    try {
      const text = await request.text();
      rawBody = JSON.parse(text);
    } catch {
      return toProblemResponse(
        fromAppError(
          {
            code: "VALIDATION_FAILED",
            message: "Invalid or malformed JSON payload in webhook request",
          },
          url.pathname,
        ),
      );
    }

    // 3. Execute webhook processing use case
    const useCase = container.getProcessWebhook();
    const result = await useCase.execute({
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      rawBody,
    });

    if (!result.ok) {
      log.warn(
        {
          event: "webhook.processing_failed",
          error: result.error,
        },
        "Webhook processing failed",
      );

      switch (result.error.kind) {
        case "WEBHOOK_CONFIG_MISSING":
          return toProblemResponse(
            fromAppError(
              {
                code: "INTERNAL",
                message: "Webhook configuration missing on server",
              },
              url.pathname,
            ),
          );

        case "WEBHOOK_SIGNATURE_INVALID":
          return toProblemResponse(
            fromAppError(
              {
                code: "WEBHOOK_SIGNATURE_INVALID",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

        case "MALFORMED_EVENT":
          return toProblemResponse(
            fromAppError(
              {
                code: "VALIDATION_FAILED",
                message: result.error.message,
              },
              url.pathname,
            ),
          );

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
        event: "webhook.success",
        eventId: result.value.eventId,
        eventType: result.value.eventType,
        status: result.value.status,
      },
      "Webhook handled successfully",
    );

    return Response.json(
      {
        eventId: result.value.eventId,
        eventType: result.value.eventType,
        status: result.value.status,
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
    log.error({ error, event: "webhook.exception" }, "Unhandled exception in webhook endpoint");
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
