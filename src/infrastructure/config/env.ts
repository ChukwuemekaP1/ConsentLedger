/**
 * Environment configuration — the ONLY place that reads process.env.
 *
 * Validates all variables at boot with Zod. If validation fails, the error
 * message lists variable NAMES and problems only — never values.
 * This prevents secrets from appearing in logs or crash reports.
 *
 * Variables are split into two groups:
 *   required-now:  must be present for the app to start (this issue, #1).
 *   optional-now:  absent values are safe defaults; later issues will promote
 *                  them to required when the feature that needs them is built.
 *
 * ARCHITECTURE.md §17, INVARIANTS.md I-12.
 */

import { z } from "zod";

// ─── Schemas ─────────────────────────────────────────────────────────────────

/**
 * Required-now: every variable the app needs to boot correctly in issue #1.
 * Zod will throw at module load if any of these are missing or invalid.
 */
const requiredNowSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  // SETTLEMENT_MODE: switches between the real PayPal adapter and the simulator.
  SETTLEMENT_MODE: z.enum(["paypal", "simulated"]).default("simulated"),
  // LLM_MODE: "mock" replays fixtures so CI never depends on Gemini quota.
  LLM_MODE: z.enum(["live", "mock"]).default("mock"),
  // LAB_ENABLED: exposes /lab/* attack routes. Must be false in production.
  LAB_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .pipe(z.boolean())
    .default(false),
  // COMMIT: the git SHA injected at build time, used in the health endpoint.
  COMMIT: z.string().default("unknown"),
});

/**
 * Optional-now: variables that later issues will promote to required.
 * Each is optional here with a note about which issue promotes it.
 */
const optionalNowSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  DATABASE_ADMIN_URL: z.string().url().optional(),

  // ── Issue #4: WebAuthn ─────────────────────────────────────────────────
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().url().optional(),

  // ── Issue #4: Sessions ─────────────────────────────────────────────────
  SESSION_SECRET: z.string().min(32).optional(),

  // ── Issue #5: Gemini ───────────────────────────────────────────────────
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-1.5-pro"),

  // ── Issue #5: Channel3 product catalog ────────────────────────────────
  CHANNEL3_API_KEY: z.string().optional(),
  CATALOG_MODE: z.enum(["channel3", "fixture"]).default("fixture"),

  // ── Issue #6: PayPal ───────────────────────────────────────────────────
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),

  // ── Issue #4/#6: Authority signing keys ───────────────────────────────
  AUTHORITY_PRIVATE_KEY_B64: z.string().optional(),
  AUTHORITY_PUBLIC_KEY_B64: z.string().optional(),

  // ── Issue #16: Merchant signing keys ──────────────────────────────────
  MERCHANT_PRIVATE_KEY_B64: z.string().optional(),
  MERCHANT_PUBLIC_KEY_B64: z.string().optional(),
});

const envSchema = requiredNowSchema.merge(optionalNowSchema);

// ─── Parse ───────────────────────────────────────────────────────────────────

function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Format errors: show field names and messages, never values.
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")} — ${issue.message}`,
    );
    throw new Error(
      `[config] Environment validation failed:\n${lines.join("\n")}\n` +
        `Check .env.example for required variables.`,
    );
  }

  return Object.freeze(result.data);
}

// Parsed once at module load. Any downstream import gets the same frozen object.
export const config = parseEnv();

// ─── Types ────────────────────────────────────────────────────────────────────

export type Config = typeof config;
