/**
 * CryptoIdGenerator — production IdGenerator adapter.
 *
 * Uses node:crypto for cryptographically random IDs. Infrastructure is
 * the only layer allowed to call crypto.randomUUID() and randomBytes().
 */

import { randomBytes, randomUUID } from "node:crypto";
import type { IdGenerator, Uuid } from "../../domain/shared/clock.js";

export class CryptoIdGenerator implements IdGenerator {
  uuid(): Uuid {
    return randomUUID() as Uuid;
  }

  nonceHex(bytes: number): string {
    return randomBytes(bytes).toString("hex");
  }
}
