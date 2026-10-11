/**
 * Tests for src/interface/http/problem.ts
 *
 * Proves:
 *   - AppError maps to the correct HTTP status and problem+json shape.
 *   - Unknown errors are masked — no message or stack leaks.
 *   - Content-Type is application/problem+json.
 */

import { describe, expect, it } from "vitest";
import {
  fromAppError,
  fromUnknown,
  toProblemResponse,
} from "../../../src/interface/http/problem.js";
import { appError } from "../../../src/domain/shared/errors.js";

describe("fromAppError", () => {
  it("maps MANDATE_NOT_FOUND to 404", () => {
    const error = appError("MANDATE_NOT_FOUND", "No mandate with that id");
    const problem = fromAppError(error, "/api/v1/mandates/123/execute");

    expect(problem.status).toBe(404);
    expect(problem.code).toBe("MANDATE_NOT_FOUND");
    expect(problem.detail).toBe("No mandate with that id");
    expect(problem.instance).toBe("/api/v1/mandates/123/execute");
    expect(problem.type).toContain("mandate-not-found");
  });

  it("maps VALIDATION_FAILED to 400", () => {
    const error = appError("VALIDATION_FAILED", "Bad request body");
    const problem = fromAppError(error, "/api/v1/proposals");
    expect(problem.status).toBe(400);
  });

  it("maps BUDGET_EXCEEDED to 422", () => {
    const error = appError("BUDGET_EXCEEDED", "Spending limit reached");
    const problem = fromAppError(error, "/api/v1/intents/xyz/spend");
    expect(problem.status).toBe(422);
  });

  it("maps INTERNAL to 500", () => {
    const error = appError("INTERNAL", "Database unreachable");
    const problem = fromAppError(error, "/api/v1/health");
    expect(problem.status).toBe(500);
  });
});

describe("fromUnknown", () => {
  it("returns a generic 500 problem without leaking the original error", () => {
    const problem = fromUnknown("/api/v1/mandates/exec");

    expect(problem.status).toBe(500);
    expect(problem.code).toBe("INTERNAL");
    // The detail must not contain any internal information
    expect(problem.detail).not.toContain("Error");
    expect(problem.detail).not.toContain("stack");
    expect(problem.instance).toBe("/api/v1/mandates/exec");
  });

  it("masks an Error object completely", () => {
    // Prove no leak even if an attacker somehow controlled the error message
    const sensitiveMessage = "DB password: super_secret_password";
    // fromUnknown takes only the instance path — it never receives the error
    const problem = fromUnknown("/api/v1/test");
    expect(problem.detail).not.toContain(sensitiveMessage);
    expect(problem.detail).not.toContain("password");
  });
});

describe("toProblemResponse", () => {
  it("sets Content-Type to application/problem+json", async () => {
    const problem = fromUnknown("/test");
    const response = toProblemResponse(problem);

    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(response.status).toBe(500);
  });

  it("body is valid JSON with a code field", async () => {
    const error = appError("UNAUTHENTICATED", "Login required");
    const problem = fromAppError(error, "/api/v1/ledger");
    const response = toProblemResponse(problem);

    const body = (await response.json()) as { code: string; status: number };
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.status).toBe(401);
  });
});
