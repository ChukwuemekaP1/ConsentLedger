/**
 * SequentialIdGenerator — an IdGenerator fake for deterministic tests.
 *
 * Returns predictable UUIDs ("00000000-0000-0000-0000-000000000001", …002, …)
 * and predictable nonces ("aa".repeat(bytes)).
 *
 * Predictable IDs make test assertions simple and diffs readable.
 */

import type { IdGenerator, Uuid } from "../../src/domain/shared/clock.js";

export class SequentialIdGenerator implements IdGenerator {
  private _counter = 0;
  private readonly _nonceChar: string;

  constructor(nonceChar = "a") {
    this._nonceChar = nonceChar;
  }

  uuid(): Uuid {
    this._counter += 1;
    const hex = this._counter.toString(16).padStart(12, "0");
    return `00000000-0000-0000-0000-${hex}` as Uuid;
  }

  nonceHex(bytes: number): string {
    // Two hex chars per byte, all the same char for easy assertion
    return this._nonceChar.repeat(bytes * 2);
  }
}
