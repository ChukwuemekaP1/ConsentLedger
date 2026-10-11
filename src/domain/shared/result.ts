/**
 * Result<T, E> — discriminated union for expected failures.
 *
 * Domain and application functions return Result instead of throwing for
 * denials, validation errors, and illegal state transitions. Only programmer
 * errors (bugs) throw; use invariant() for those.
 *
 * CODING.md §2: "Expected failures are values."
 */

export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** Construct a successful result. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Construct a failed result. */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Transform the value inside an Ok, leaving Err unchanged.
 * Like Array.prototype.map but for Result.
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Transform the error inside an Err, leaving Ok unchanged.
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chain a Result-producing function over an Ok.
 * Short-circuits on the first Err (like Promise.then).
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Unwrap the value or throw a programmer error.
 *
 * ONLY use this at:
 *   1. Test assertions (prefer expect(result.ok).toBe(true) instead where possible).
 *   2. Infrastructure boundaries where a Result must become an exception for a caller
 *      that cannot handle the Result type (e.g. Next.js route handlers).
 *
 * Never catch the thrown error to hide it — that defeats the purpose.
 */
export function unwrapOrThrow<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrapOrThrow called on Err: ${JSON.stringify(result.error)}`);
}
