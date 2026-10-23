import { describe, expect, it } from "vitest";
import { formatMinorUnits } from "../../../src/ui/agent/format-money.js";
import { failureFromProblem } from "../../../src/ui/agent/failure.js";
import { classifyPasskeyError } from "../../../src/ui/agent/passkeys.js";
import { sealSummary } from "../../../src/ui/agent/Seal.js";
import { currentStep } from "../../../src/ui/agent/StageRail.js";
import { formatCountdown, shortHash } from "../../../src/ui/agent/MandateCard.js";

describe("formatMinorUnits (I-10: integer minor units, ISO code always shown)", () => {
  it.each([
    [8500, "USD", "$85.00 USD"],
    [5, "USD", "$0.05 USD"],
    [0, "EUR", "€0.00 EUR"],
    [123456789, "GBP", "£1,234,567.89 GBP"],
    [500, "JPY", "¥500 JPY"],
  ])("formats %i %s as %s", (minor, currency, expected) => {
    expect(formatMinorUnits(minor, currency)).toBe(expected);
  });

  it("rejects non-integers, negatives and unknown currencies instead of guessing", () => {
    expect(formatMinorUnits(85.5, "USD")).toBe("Invalid amount");
    expect(formatMinorUnits(-1, "USD")).toBe("Invalid amount");
    expect(formatMinorUnits(Number.NaN, "USD")).toBe("Invalid amount");
    expect(formatMinorUnits(100, "BTC")).toBe("Unsupported currency");
  });
});

describe("failureFromProblem", () => {
  const f = (code: string | undefined, status: number, extra: object = {}) =>
    failureFromProblem({ code, status, ...extra });

  it("maps authentication, expiry and denial codes to distinct categories", () => {
    expect(f("UNAUTHENTICATED", 401).category).toBe("auth");
    expect(f("MANDATE_EXPIRED", 422).category).toBe("expired");
    expect(f("POLICY_DRIFT", 403).category).toBe("denied");
    expect(f("MERCHANT_NOT_ALLOWED", 422).category).toBe("denied");
    expect(f("HASH_MISMATCH", 403).category).toBe("denied");
  });

  it("treats provider and 5xx failures as retryable, denials as not", () => {
    expect(f("PROVIDER_ERROR", 500).retryable).toBe(true);
    expect(f("INTERNAL", 500).category).toBe("provider");
    expect(f(undefined, 503).category).toBe("provider");
    expect(f("POLICY_DENIED", 422).retryable).toBe(false);
  });

  it("infers policy denial and rate limiting from code-less proposal problems", () => {
    const denied = f(undefined, 422, { reasons: ["MERCHANT_NOT_ALLOWED"] });
    expect(denied).toMatchObject({ category: "denied", code: "POLICY_DENIED" });
    expect(denied.reasons).toEqual(["MERCHANT_NOT_ALLOWED"]);
    // An AI rate limit is not a payment-provider failure; the user must not be told PayPal failed.
    expect(f(undefined, 429)).toMatchObject({
      category: "assistant",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("maps AI and store-search failures to their own non-payment categories", () => {
    expect(f("AI_QUOTA_EXHAUSTED", 429)).toMatchObject({ category: "assistant", retryable: false });
    expect(f("AI_PROPOSAL_FAILED", 502)).toMatchObject({ category: "assistant", retryable: true });
    expect(f("CATALOG_UNAVAILABLE", 503)).toMatchObject({ category: "stores", retryable: true });
  });

  it("falls back to unexpected (never success) for unknown codes", () => {
    expect(f("SOMETHING_NEW", 418)).toMatchObject({ category: "unexpected", retryable: false });
  });
});

describe("classifyPasskeyError", () => {
  it("treats a dismissed or timed-out prompt as a retryable cancellation", () => {
    expect(classifyPasskeyError({ name: "NotAllowedError" })).toMatchObject({
      code: "PASSKEY_CANCELLED",
      retryable: true,
    });
    expect(classifyPasskeyError({ name: "AbortError", code: "ERROR_CEREMONY_ABORTED" }).code).toBe(
      "PASSKEY_CANCELLED",
    );
  });

  it("names unsupported authenticators and origin problems as non-retryable", () => {
    expect(
      classifyPasskeyError({ code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" }),
    ).toMatchObject({ code: "PASSKEY_AUTHENTICATOR_UNSUPPORTED", retryable: false });
    expect(classifyPasskeyError({ name: "SecurityError" })).toMatchObject({
      code: "PASSKEY_ORIGIN_INVALID",
      retryable: false,
    });
    expect(classifyPasskeyError({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" }).code).toBe(
      "PASSKEY_ALREADY_REGISTERED",
    );
  });

  it("maps anything else, including non-error values, to a generic failure", () => {
    expect(classifyPasskeyError(new Error("boom")).code).toBe("PASSKEY_FAILED");
    expect(classifyPasskeyError(undefined).code).toBe("PASSKEY_FAILED");
    expect(classifyPasskeyError("nope").category).toBe("passkey");
  });
});

describe("Seal and stage rail", () => {
  it("only reports 'Seal verified' when every check passed, and 'broken' on failure", () => {
    const pass = { id: "a", label: "A", state: "pass" } as const;
    const pending = { id: "b", label: "B", state: "pending" } as const;
    const fail = { id: "c", label: "C", state: "fail" } as const;
    expect(sealSummary([pass, pass])).toMatch(/^Seal verified: 2 of 2/);
    expect(sealSummary([pass, pending])).toMatch(/^Seal incomplete: 1 of 2/);
    expect(sealSummary([pass, fail])).toMatch(/^Seal broken: 1 of 2/);
  });

  it("maps each stage to its step", () => {
    expect(currentStep({ stage: "compose", prompt: "" })).toBe(0);
    expect(currentStep({ stage: "auth_required", prompt: "" })).toBe(0);
  });
});

describe("MandateCard helpers", () => {
  it("truncates hashes and formats a countdown", () => {
    expect(shortHash("a3f9c0ffee0123456789c21e")).toBe("a3f9c0…c21e");
    expect(shortHash("short")).toBe("short");
    expect(formatCountdown(125_000)).toBe("2:05 left");
    expect(formatCountdown(0)).toBe("Expired");
    expect(formatCountdown(-5)).toBe("Expired");
  });
});
