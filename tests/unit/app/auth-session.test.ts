/**
 * Unit tests for /api/v1/auth/session endpoint.
 *
 * Verifies session issuance, verification, and termination for the single executive persona.
 */

import { describe, expect, it } from "vitest";
import {
  GET,
  POST,
  DELETE,
  DEFAULT_PRINCIPAL_ID,
  DEFAULT_DISPLAY_NAME,
} from "../../../src/app/api/v1/auth/session/route.js";
import { container } from "../../../src/container.js";

describe("Auth Session Route (/api/v1/auth/session)", () => {
  it("returns unauthenticated when no session cookie is provided", async () => {
    const request = new Request("http://localhost:3000/api/v1/auth/session");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.authenticated).toBe(false);
    expect(body.principalId).toBeNull();
  });

  it("issues signed cl_session cookie on POST and verifies on GET", async () => {
    // 1. Issue session
    const postReq = new Request("http://localhost:3000/api/v1/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalId: DEFAULT_PRINCIPAL_ID,
        displayName: DEFAULT_DISPLAY_NAME,
      }),
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const cookieHeader = postRes.headers.get("set-cookie");
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain("cl_session=");

    const match = cookieHeader?.match(/cl_session=([^;]+)/);
    expect(match).not.toBeNull();
    const token = match?.[1] ?? "";
    expect(token).toBeTruthy();

    // Verify token validity with container session service
    const verifyResult = container.getSessionService().verify(token);
    expect(verifyResult.ok).toBe(true);
    if (verifyResult.ok) {
      expect(verifyResult.value.sub).toBe(DEFAULT_PRINCIPAL_ID);
    }

    // 2. Pass cookie to GET
    const getReq = new Request("http://localhost:3000/api/v1/auth/session", {
      headers: { cookie: `cl_session=${token}` },
    });
    const getRes = await GET(getReq);
    expect(getRes.status).toBe(200);

    const getBody = await getRes.json();
    expect(getBody.authenticated).toBe(true);
    expect(getBody.principalId).toBe(DEFAULT_PRINCIPAL_ID);
  });

  it("clears cl_session cookie on DELETE", async () => {
    const deleteReq = new Request("http://localhost:3000/api/v1/auth/session", {
      method: "DELETE",
    });
    const deleteRes = await DELETE(deleteReq);
    expect(deleteRes.status).toBe(200);

    const cookieHeader = deleteRes.headers.get("set-cookie");
    expect(cookieHeader).toContain("cl_session=;");
    expect(cookieHeader).toContain("Max-Age=0");
  });
});
