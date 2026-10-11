/**
 * FixedClock — a Clock fake for deterministic tests.
 *
 * Returns the same Timestamp on every call. Construct with a known instant
 * so tests never have a hidden dependency on wall-clock time.
 *
 * Example:
 *   const clock = new FixedClock("2026-10-11T14:00:00.000Z");
 *   expect(clock.now()).toBe("2026-10-11T14:00:00.000Z");
 */

import type { Clock, Timestamp } from "../../src/domain/shared/clock.js";

export class FixedClock implements Clock {
  private readonly _timestamp: Timestamp;

  constructor(iso: string = "2026-01-01T00:00:00.000Z") {
    // We cast once here: the fake lives in tests/ where the lint rule doesn't apply.
    this._timestamp = iso as Timestamp;
  }

  now(): Timestamp {
    return this._timestamp;
  }
}
