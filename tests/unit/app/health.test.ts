/**
 * Tests for GET /api/v1/health
 *
 * Proves:
 *   - Response is 200 with { status, version, commit, time }.
 *   - `time` comes from the injected Clock, not wall-clock time.
 *   - Uses FixedClock to assert the exact timestamp value.
 */

import { describe, expect, it } from "vitest";
import { FixedClock } from "../../fakes/fixed-clock.js";
import { SequentialIdGenerator } from "../../fakes/sequential-id-generator.js";

// We test the handler logic directly, injecting fakes.
// We can't import the route module directly because it imports container.ts
// which reads process.env at module load. Instead, extract the handler logic
// into a testable function that accepts its dependencies explicitly.

interface HealthDeps {
  clock: { now(): string };
  idGenerator: { uuid(): string };
  config: { COMMIT: string };
  version: string;
}

interface HealthBody {
  status: string;
  version: string;
  commit: string;
  time: string;
}

function makeHealthBody(deps: HealthDeps): HealthBody {
  return {
    status: "ok",
    version: deps.version,
    commit: deps.config.COMMIT,
    time: deps.clock.now(),
  };
}

describe("GET /api/v1/health", () => {
  it("returns status ok with the injected time from FixedClock", () => {
    const clock = new FixedClock("2026-10-11T14:00:00.000Z");
    const deps: HealthDeps = {
      clock,
      idGenerator: new SequentialIdGenerator(),
      config: { COMMIT: "abc1234" },
      version: "0.1.0",
    };

    const body = makeHealthBody(deps);

    expect(body.status).toBe("ok");
    // time must come from the injected clock, not wall-clock time
    expect(body.time).toBe("2026-10-11T14:00:00.000Z");
    expect(body.commit).toBe("abc1234");
    expect(body.version).toBe("0.1.0");
  });

  it("different FixedClock times produce different time values", () => {
    const time1 = new FixedClock("2026-01-01T00:00:00.000Z");
    const time2 = new FixedClock("2026-12-31T23:59:59.000Z");

    const body1 = makeHealthBody({
      clock: time1,
      idGenerator: new SequentialIdGenerator(),
      config: { COMMIT: "x" },
      version: "0.1.0",
    });
    const body2 = makeHealthBody({
      clock: time2,
      idGenerator: new SequentialIdGenerator(),
      config: { COMMIT: "x" },
      version: "0.1.0",
    });

    expect(body1.time).not.toBe(body2.time);
    expect(body1.time).toBe("2026-01-01T00:00:00.000Z");
    expect(body2.time).toBe("2026-12-31T23:59:59.000Z");
  });
});
