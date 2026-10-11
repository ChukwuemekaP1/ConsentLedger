/**
 * Composition root — the ONLY place that wires adapters to use cases.
 *
 * Rules:
 *   - This file may import infrastructure (it is the wiring point).
 *   - No other file outside infrastructure/ may import infrastructure directly.
 *   - Use cases and route handlers receive their dependencies through this module.
 *   - The container is a plain object, not a class or DI framework.
 *
 * ARCHITECTURE.md §3: "container.ts is the only allowed bridge."
 * ADR-0001: hexagonal architecture with enforced boundaries.
 */

import { config } from "./infrastructure/config/env.js";
import { logger, childLogger } from "./infrastructure/logging/logger.js";
import { SystemClock } from "./infrastructure/clock/system-clock.js";
import { CryptoIdGenerator } from "./infrastructure/clock/crypto-id-generator.js";

// ─── Singleton adapters ───────────────────────────────────────────────────────

const clock = new SystemClock();
const idGenerator = new CryptoIdGenerator();

// ─── Container ────────────────────────────────────────────────────────────────

/**
 * The application container. Import from here in route handlers and use cases.
 * Never construct adapters anywhere else.
 */
export const container = {
  config,
  logger,
  childLogger,
  clock,
  idGenerator,
} as const;

export type Container = typeof container;
