/**
 * Central redaction list for pino.
 *
 * Every field name that might carry a secret goes here.
 * Adding a new secret to the app means adding it here in the same PR.
 *
 * Paths use pino's fast-redact syntax:
 *   "fieldName"         — top-level key
 *   "obj.field"         — nested key
 *   "*.field"           — field under any top-level key
 *   "arr[*].field"      — field in every element of an array
 *
 * INVARIANTS.md I-12: "Secrets stay server-side. Never logged."
 * ARCHITECTURE.md §15: "Secrets — read only by infrastructure/config."
 */

export const REDACT_PATHS: readonly string[] = [
  // PayPal credentials
  "PAYPAL_CLIENT_SECRET",
  "paypalClientSecret",
  "client_secret",
  "access_token",
  "refresh_token",

  // Authority and merchant signing keys
  "AUTHORITY_PRIVATE_KEY_B64",
  "authorityPrivateKeyB64",
  "MERCHANT_PRIVATE_KEY_B64",
  "merchantPrivateKeyB64",
  "privateKey",
  "private_key",

  // API keys
  "GEMINI_API_KEY",
  "geminiApiKey",
  "CHANNEL3_API_KEY",
  "channel3ApiKey",
  "apiKey",
  "api_key",

  // Session and auth
  "SESSION_SECRET",
  "sessionSecret",
  "password",
  "secret",
  "token",

  // HTTP headers that carry credentials
  "authorization",
  "Authorization",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.authorization",
  "*.Authorization",
  "*.cookie",
  "*.Cookie",
  "headers.authorization",
  "headers.cookie",
];
