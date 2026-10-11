// Layer: domain
// Rule: pure TypeScript only. No I/O, no framework, no env, no clock calls, no randomness.
// Allowed imports: domain, node:crypto (hashing only), zod — see .dependency-cruiser.cjs allowlist.
export * from "./result.js";
export * from "./brand.js";
export * from "./clock.js";
export * from "./invariant.js";
export * from "./reason-codes.js";
export * from "./errors.js";
