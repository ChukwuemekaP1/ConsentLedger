/**
 * GET /api/v1/lab/scenarios
 *
 * Lists all registered reproducible adversarial scenarios in the Security Lab suite.
 *
 * ARCHITECTURE.md §5, §8.1
 * INVARIANTS: I-01, I-02, I-03, I-04, I-05, I-07, I-09, I-11.
 */

import { container } from "../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../interface/http/request-id.js";
import { toProblemResponse, fromUnknown } from "../../../../../interface/http/problem.js";
import { labDisabledResponse } from "../../../../../interface/http/lab-guard.js";

export async function GET(request: Request): Promise<Response> {
  if (!container.isLabEnabled()) return labDisabledResponse();
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);

  try {
    const runner = container.getSecurityLabRunner();
    const scenarios = runner.listScenarios().map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      description: s.description,
      targetInvariant: s.targetInvariant,
      expectedDecision: s.expectedDecision,
      expectedReasonCode: s.expectedReasonCode,
    }));

    return Response.json(
      {
        totalScenarios: scenarios.length,
        scenarios,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  } catch {
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
