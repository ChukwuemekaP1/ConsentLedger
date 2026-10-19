/**
 * Tests for src/domain/shared — result utilities, brand, invariant, reason-codes.
 *
 * These modules were implemented in issue #1. We add targeted coverage tests
 * here to reach the domain coverage threshold (≥95% lines, ≥90% branches).
 */

import { describe, expect, it } from "vitest";
import { ok, err, map, mapErr, andThen, unwrapOrThrow } from "../../../src/domain/shared/result.js";
import { unsafeCast, type Brand } from "../../../src/domain/shared/brand.js";
import { invariant } from "../../../src/domain/shared/invariant.js";
import { isReasonCode, REASON_CODES } from "../../../src/domain/shared/reason-codes.js";
import { appError } from "../../../src/domain/shared/errors.js";

// ─── Result ───────────────────────────────────────────────────────────────────

describe("Result utilities", () => {
  it("ok() creates an Ok result", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err() creates an Err result", () => {
    const r = err("bad");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("bad");
  });

  it("map() transforms Ok value", () => {
    const r = map(ok(5), (x) => x * 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(10);
  });

  it("map() leaves Err unchanged", () => {
    const r = map(err("e"), (x: number) => x * 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("e");
  });

  it("mapErr() transforms Err", () => {
    const r = mapErr(err("e"), (e) => e + "!!");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("e!!");
  });

  it("mapErr() leaves Ok unchanged", () => {
    const r = mapErr(ok(1), (e: string) => e + "!!");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1);
  });

  it("andThen() chains Ok results", () => {
    const r = andThen(ok(5), (x) => ok(x + 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(6);
  });

  it("andThen() short-circuits on Err", () => {
    const r = andThen(err("e"), (x: number) => ok(x + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("e");
  });

  it("andThen() returns Err from chained function", () => {
    const r = andThen(ok(5), (_x) => err("chained error"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("chained error");
  });

  it("unwrapOrThrow() returns value from Ok", () => {
    expect(unwrapOrThrow(ok("hello"))).toBe("hello");
  });

  it("unwrapOrThrow() throws on Err", () => {
    expect(() => unwrapOrThrow(err("bad"))).toThrow();
  });
});

// ─── Brand ────────────────────────────────────────────────────────────────────

describe("unsafeCast()", () => {
  it("passes through the value", () => {
    // unsafeCast is a compile-time type assertion — at runtime it's identity
    type MyBrand = Brand<number, "MyBrand">;
    const result = unsafeCast<MyBrand>(42);
    expect(result).toBe(42);
  });
});

// ─── invariant ────────────────────────────────────────────────────────────────

describe("invariant()", () => {
  it("does not throw when condition is truthy", () => {
    expect(() => invariant(true, "ok")).not.toThrow();
    expect(() => invariant(1, "ok")).not.toThrow();
    expect(() => invariant("ok", "ok")).not.toThrow();
  });

  it("throws when condition is falsy", () => {
    expect(() => invariant(false, "bad")).toThrow("Invariant violation: bad");
  });

  it("throws when condition is null", () => {
    expect(() => invariant(null, "null condition")).toThrow();
  });

  it("throws when condition is 0", () => {
    expect(() => invariant(0, "zero")).toThrow();
  });
});

// ─── reason-codes ─────────────────────────────────────────────────────────────

describe("isReasonCode()", () => {
  it("returns true for known codes", () => {
    expect(isReasonCode("MANDATE_NOT_FOUND")).toBe(true);
    expect(isReasonCode("HASH_MISMATCH")).toBe(true);
    expect(isReasonCode("INTERNAL")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isReasonCode("NOT_A_CODE")).toBe(false);
    expect(isReasonCode("")).toBe(false);
  });

  it("returns false for non-strings", () => {
    expect(isReasonCode(42)).toBe(false);
    expect(isReasonCode(null)).toBe(false);
    expect(isReasonCode(undefined)).toBe(false);
  });

  it("all REASON_CODES are recognised", () => {
    for (const code of REASON_CODES) {
      expect(isReasonCode(code)).toBe(true);
    }
  });
});

// ─── errors ───────────────────────────────────────────────────────────────────

describe("appError()", () => {
  it("creates an AppError without details", () => {
    const e = appError("INTERNAL", "something broke");
    expect(e.code).toBe("INTERNAL");
    expect(e.message).toBe("something broke");
    expect(e.details).toBeUndefined();
  });

  it("creates an AppError with details", () => {
    const e = appError("HASH_MISMATCH", "hash wrong", { expected: "aaa", got: "bbb" });
    expect(e.code).toBe("HASH_MISMATCH");
    expect(e.details).toEqual({ expected: "aaa", got: "bbb" });
  });
});
