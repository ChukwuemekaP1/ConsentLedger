/**
 * Fitness function for Invariant I-09:
 * "Evidence verifies offline. Verifying a bundle needs no network and no database,
 * in the CLI and in the public browser page."
 *
 * Stubs all network facilities (fetch, http, https, net) to throw an error if called.
 */

import { describe, it, expect } from "vitest";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { verifyEvidenceBundle } from "../../../src/domain/evidence/verifier.js";
import { createValidBundleFixture } from "./evidence-fixture.js";

describe("Invariant I-09: Offline Verification Fitness Test", () => {
  it("proves verifyEvidenceBundle runs completely offline with zero network access", () => {
    // 1. Stub network primitives to throw immediately if touched
    const originalFetch = globalThis.fetch;
    const originalHttpRequest = http.request;
    const originalHttpsRequest = https.request;
    const originalNetConnect = net.connect;

    const networkThrew = () => {
      throw new Error(
        "NETWORK_CALL_DETECTED: Offline verifier attempted network I/O (Violates I-09)!",
      );
    };

    globalThis.fetch = networkThrew as unknown as typeof fetch;
    http.request = networkThrew as unknown as typeof http.request;
    https.request = networkThrew as unknown as typeof https.request;
    net.connect = networkThrew as unknown as typeof net.connect;

    try {
      const { bundle, trustStore } = createValidBundleFixture();
      const result = verifyEvidenceBundle(bundle, trustStore);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.valid).toBe(true);
      expect(result.value.checks.length).toBeGreaterThanOrEqual(8);
    } finally {
      // Restore network primitives
      globalThis.fetch = originalFetch;
      http.request = originalHttpRequest;
      https.request = originalHttpsRequest;
      net.connect = originalNetConnect;
    }
  });
});
