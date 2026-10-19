/**
 * POST /api/v1/proposals
 *
 * Runs the AI proposal loop to generate a structured purchase proposal and issued Cart Mandate.
 *
 * ARCHITECTURE.md §13, §14, INVARIANTS I-07, I-11, I-12.
 */

import { z } from "zod";
import { container } from "../../../../container.js";
import { getOrCreateRequestId } from "../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../interface/http/problem.js";

const ProposalRequestBodySchema = z
  .object({
    prompt: z.string().min(1, "Prompt is required"),
    correlationId: z.string().uuid().optional(),
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
      log.warn({ event: "proposals.unauthenticated" }, "Missing or invalid session cookie");
      return toProblemResponse(
        fromAppError(
          {
            code: "UNAUTHENTICATED",
            message: "Authentication required to generate purchase proposals",
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

    const parseResult = ProposalRequestBodySchema.safeParse(body);
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

    const { prompt, correlationId } = parseResult.data;

    // 3. Execute ProposeCart use case
    const proposeCart = container.getProposeCart();
    const result = await proposeCart.execute({
      principalId: authenticatedPrincipalId,
      prompt,
      ...(correlationId !== undefined ? { correlationId } : {}),
    });

    if (!result.ok) {
      log.warn({ event: "proposals.failed", errorKind: result.error.kind }, result.error.message);

      if (result.error.kind === "POLICY_DENIED") {
        return Response.json(
          {
            type: "https://consentledger.dev/problems/policy-denied",
            title: "Policy Denied",
            status: 422,
            detail: result.error.message,
            reasons: result.error.reasons,
            proposal: result.error.proposal,
          },
          {
            status: 422,
            headers: {
              "Content-Type": "application/problem+json",
              "x-request-id": requestId,
            },
          },
        );
      }

      if (result.error.kind === "LLM_ERROR") {
        const llmErr = result.error.details as { kind?: string } | undefined;
        if (llmErr?.kind === "RATE_LIMITED") {
          return Response.json(
            {
              type: "https://consentledger.dev/problems/rate-limited",
              title: "Rate Limited",
              status: 429,
              detail: result.error.message,
            },
            {
              status: 429,
              headers: {
                "Content-Type": "application/problem+json",
                "x-request-id": requestId,
                "Retry-After": "10",
              },
            },
          );
        }

        return Response.json(
          {
            type: "https://consentledger.dev/problems/llm-error",
            title: "AI Proposal Generation Error",
            status: 502,
            detail: result.error.message,
          },
          {
            status: 502,
            headers: {
              "Content-Type": "application/problem+json",
              "x-request-id": requestId,
            },
          },
        );
      }

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

    log.info(
      {
        event: "proposals.created",
        mandateId: result.value.mandate.terms.id,
        mandateHash: result.value.mandate.hash,
      },
      "Purchase proposal and mandate created",
    );

    return Response.json(
      {
        mandate: result.value.mandate,
        proposal: result.value.proposal,
        evaluation: result.value.evaluation,
      },
      {
        status: 201,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  } catch (err: unknown) {
    log.error({ err }, "Unhandled error in POST /api/v1/proposals");
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
