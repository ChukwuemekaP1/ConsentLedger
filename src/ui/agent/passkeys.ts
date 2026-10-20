/**
 * Browser passkey adapter.
 *
 * Wraps @simplewebauthn/browser behind a small port so components and tests do
 * not depend on `navigator.credentials` directly. The adapter only runs the
 * authenticator ceremony; whether the resulting assertion is valid is decided by
 * the server (I-05). Cancellation, unsupported environments and authenticator
 * errors are mapped to named failures, never to success.
 */

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { Failure } from "./failure.js";

export type PasskeyResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

export interface PasskeyPort {
  isSupported(): boolean;
  register(
    optionsJSON: PublicKeyCredentialCreationOptionsJSON,
  ): Promise<PasskeyResult<RegistrationResponseJSON>>;
  authenticate(
    optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  ): Promise<PasskeyResult<AuthenticationResponseJSON>>;
}

function passkeyFailure(code: string, detail: string, retryable: boolean): Failure {
  return { category: "passkey", code, detail, retryable };
}

export function unsupportedPasskeyFailure(): Failure {
  return passkeyFailure(
    "PASSKEY_UNSUPPORTED",
    "This browser or device does not support passkeys (WebAuthn). Use a current browser with a platform or security-key authenticator.",
    false,
  );
}

interface ErrorLike {
  readonly name?: unknown;
  readonly code?: unknown;
}

/** Maps a thrown WebAuthn ceremony error to a named failure. Exported for tests. */
export function classifyPasskeyError(error: unknown): Failure {
  const { name, code } = (typeof error === "object" && error !== null ? error : {}) as ErrorLike;

  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return passkeyFailure(
      "PASSKEY_ALREADY_REGISTERED",
      "This authenticator already holds a ConsentLedger passkey.",
      false,
    );
  }
  if (
    code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT" ||
    code === "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG" ||
    code === "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT" ||
    name === "NotSupportedError"
  ) {
    return passkeyFailure(
      "PASSKEY_AUTHENTICATOR_UNSUPPORTED",
      "This authenticator cannot satisfy the required passkey and user-verification settings.",
      false,
    );
  }
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") {
    return passkeyFailure(
      "PASSKEY_CANCELLED",
      "The passkey prompt was cancelled or timed out. Nothing was signed.",
      true,
    );
  }
  if (
    name === "SecurityError" ||
    code === "ERROR_INVALID_DOMAIN" ||
    code === "ERROR_INVALID_RP_ID"
  ) {
    return passkeyFailure(
      "PASSKEY_ORIGIN_INVALID",
      "The passkey could not be used on this origin. Open ConsentLedger on its configured address.",
      false,
    );
  }
  return passkeyFailure(
    "PASSKEY_FAILED",
    "The authenticator could not complete the request. Nothing was signed.",
    true,
  );
}

export const browserPasskeys: PasskeyPort = {
  isSupported: () => browserSupportsWebAuthn(),

  async register(optionsJSON) {
    if (!browserSupportsWebAuthn()) {
      return { ok: false, failure: unsupportedPasskeyFailure() };
    }
    try {
      return { ok: true, value: await startRegistration({ optionsJSON }) };
    } catch (error) {
      return { ok: false, failure: classifyPasskeyError(error) };
    }
  },

  async authenticate(optionsJSON) {
    if (!browserSupportsWebAuthn()) {
      return { ok: false, failure: unsupportedPasskeyFailure() };
    }
    try {
      return { ok: true, value: await startAuthentication({ optionsJSON }) };
    } catch (error) {
      return { ok: false, failure: classifyPasskeyError(error) };
    }
  },
};
