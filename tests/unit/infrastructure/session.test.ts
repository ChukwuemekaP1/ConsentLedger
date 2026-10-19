import { describe, it, expect } from "vitest";
import { SessionService } from "../../../src/infrastructure/auth/session.js";

describe("SessionService", () => {
  const secret = "a-very-long-and-secure-session-secret-key-32-chars";
  const service = new SessionService(secret);

  it("fails construction if secret is too short", () => {
    expect(() => new SessionService("too-short")).toThrow(
      "SESSION_SECRET must be at least 32 characters long",
    );
  });

  it("signs and verifies a valid token", () => {
    const principalId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const token = service.sign(principalId, 3600, 1000);

    const result = service.verify(token, 1050);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sub).toBe(principalId);
      expect(result.value.iat).toBe(1000);
      expect(result.value.exp).toBe(4600);
    }
  });

  it("rejects token with signature mismatch / tampering", () => {
    const token = service.sign("user-1", 3600, 1000);
    const parts = token.split(".");
    // Tamper with payload
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "user-2", iat: 1000, exp: 4600 }),
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const result = service.verify(tamperedToken, 1050);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("SIGNATURE_MISMATCH");
    }
  });

  it("rejects expired token", () => {
    const token = service.sign("user-1", 300, 1000); // expires at 1300
    const result = service.verify(token, 1301); // verified at 1301

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("EXPIRED_TOKEN");
    }
  });

  it("rejects malformed token", () => {
    const result = service.verify("not-a-valid-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("MALFORMED_TOKEN");
    }
  });
});
