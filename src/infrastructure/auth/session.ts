/**
 * Signed Session JWT Helper.
 *
 * Provides tamper-proof, lightweight session tokens using HMAC-SHA256 via node:crypto.
 *
 * Tokens:
 *   - Header: {"alg":"HS256","typ":"JWT"}
 *   - Payload: {"sub": principalId, "iat": number, "exp": number}
 *   - Signature: HMAC-SHA256(header.payload, SESSION_SECRET)
 *
 * ARCHITECTURE.md §13, §15, INVARIANTS.md I-12.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { type Result, ok, err } from "../../domain/shared/result.js";

export interface SessionPayload {
  readonly sub: string; // principalId
  readonly iat: number;
  readonly exp: number;
}

export interface SessionError {
  readonly kind: "INVALID_TOKEN" | "EXPIRED_TOKEN" | "SIGNATURE_MISMATCH" | "MALFORMED_TOKEN";
  readonly message: string;
}

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export class SessionService {
  constructor(private readonly secret: string) {
    if (!secret || secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters long");
    }
  }

  /**
   * Issue a signed JWT session token for a principal.
   */
  sign(principalId: string, ttlSeconds: number = DEFAULT_TTL_SECONDS, nowSeconds?: number): string {
    const iat = nowSeconds ?? Math.floor(Date.now() / 1000);
    const exp = iat + ttlSeconds;

    const header = { alg: "HS256", typ: "JWT" };
    const payload: SessionPayload = { sub: principalId, iat, exp };

    const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const data = `${encodedHeader}.${encodedPayload}`;

    const signature = createHmac("sha256", this.secret).update(data).digest("base64url");

    return `${data}.${signature}`;
  }

  /**
   * Verify a signed JWT session token.
   */
  verify(token: string, nowSeconds?: number): Result<SessionPayload, SessionError> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return err({ kind: "MALFORMED_TOKEN", message: "Token must consist of 3 parts" });
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    if (!encodedHeader || !encodedPayload || !signature) {
      return err({ kind: "MALFORMED_TOKEN", message: "Token parts cannot be empty" });
    }

    const data = `${encodedHeader}.${encodedPayload}`;
    const expectedSig = createHmac("sha256", this.secret).update(data).digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expectedSigBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedSigBuf.length || !timingSafeEqual(sigBuf, expectedSigBuf)) {
      return err({ kind: "SIGNATURE_MISMATCH", message: "Session token signature is invalid" });
    }

    let payload: SessionPayload;
    try {
      const decodedJson = Buffer.from(encodedPayload, "base64url").toString("utf8");
      payload = JSON.parse(decodedJson);
    } catch {
      return err({ kind: "MALFORMED_TOKEN", message: "Session payload is not valid JSON" });
    }

    if (!payload.sub || typeof payload.sub !== "string") {
      return err({ kind: "INVALID_TOKEN", message: "Session payload missing 'sub'" });
    }

    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) {
      return err({ kind: "EXPIRED_TOKEN", message: "Session token has expired" });
    }

    return ok(payload);
  }
}
