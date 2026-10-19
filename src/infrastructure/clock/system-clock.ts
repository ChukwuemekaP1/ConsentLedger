/**
 * SystemClock — production Clock adapter.
 *
 * Wraps Date.now() behind the Clock port so domain and application code
 * never call it directly. This is the only place Date.now() is allowed
 * in production code; infrastructure is exempt from the lint rule.
 */

import type { Clock, Timestamp } from "../../domain/shared/clock.js";

export class SystemClock implements Clock {
  now(): Timestamp {
    return new Date().toISOString() as Timestamp;
  }

  offsetSeconds(seconds: number): Timestamp {
    return new Date(Date.now() + seconds * 1000).toISOString() as Timestamp;
  }
}
