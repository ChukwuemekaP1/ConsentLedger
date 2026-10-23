/**
 * POST /api/v1/lab/scenarios/run
 *
 * Dispatches reproducible adversarial attacks against the real Gate and application logic.
 *
 * ARCHITECTURE.md §5, §8.1
 * INVARIANTS: I-01, I-02, I-03, I-04, I-05, I-07, I-09, I-11.
 */

import { z } from "zod";
import { container } from "../../../../../../container.js";
import { getOrCreateRequestId } from "../../../../../../interface/http/request-id.js";
import {
  toProblemResponse,
  fromAppError,
  fromUnknown,
} from "../../../../../../interface/http/problem.js";
import type {
  SecurityScenarioId,
  ScenarioResult,
} from "../../../../../../application/lab/types.js";
import { labDisabledResponse } from "../../../../../../interface/http/lab-guard.js";

const RunScenarioBodySchema = z
  .object({
    scenarioId: z
      .enum([
        "all",
        "control-valid-purchase",
        "amount-manipulation",
        "merchant-substitution",
        "currency-substitution",
        "prompt-injection",
        "reuse-consumed-approval",
        "expired-mandate",
        "changed-mandate-consent",
        "evidence-bundle-tampering",
      ])
      .optional()
      .default("all"),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  if (!container.isLabEnabled()) return labDisabledResponse();
  const url = new URL(request.url);
  const requestId = getOrCreateRequestId(request, container.idGenerator);
  const log = container.childLogger({ requestId });

  try {
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch {
      return toProblemResponse(
        fromAppError(
          { code: "VALIDATION_FAILED", message: "Request body must be valid JSON" },
          url.pathname,
        ),
      );
    }

    const parseResult = RunScenarioBodySchema.safeParse(body);
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

    const { scenarioId } = parseResult.data;
    const runner = container.getSecurityLabRunner();
    const labContext = container.createLabContext();

    let results: readonly ScenarioResult[];

    if (scenarioId === "all") {
      log.info({ event: "lab.run_all.start" }, "Running all 9 security lab scenarios");
      results = await runner.runAll(labContext);
    } else {
      log.info({ event: "lab.run_scenario.start", scenarioId }, "Running single security scenario");
      const single = await runner.runScenario(scenarioId as SecurityScenarioId, labContext);
      results = [single];
    }

    // Verify zero-capture invariant (I-01): every blocked scenario MUST have 0 captures attempted
    const violations = results.filter((r) => r.decision === "BLOCKED" && r.captureCallCount > 0);
    if (violations.length > 0) {
      log.error(
        { event: "lab.zero_capture_violation", violations },
        "CRITICAL INVARIANT VIOLATION: Capture attempted on blocked request!",
      );
    }

    return Response.json(
      {
        totalExecuted: results.length,
        allPassed: results.every((r) => r.runStatus === "PASSED"),
        zeroCaptureEnforced: violations.length === 0,
        results,
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
      },
    );
  } catch (err: unknown) {
    log.error({ event: "lab.scenarios.run.error", err }, "Unexpected error executing scenario");
    return toProblemResponse(fromUnknown(url.pathname));
  }
}
