/**
 * Branded types for domain primitives.
 *
 * A Brand prevents accidental mix-ups between structurally identical types:
 *   type UserId = Brand<string, "UserId">
 *   type OrderId = Brand<string, "OrderId">
 *   const uid: UserId = orderId  // TS error
 *
 * Branded values are created only through validating constructors that live
 * beside each domain concept (e.g. Money.fromMinorUnits).
 *
 * CODING.md §1: "Branded types for domain primitives."
 */

declare const __brand: unique symbol;

/**
 * Brand<T, Name> — attach a phantom type tag to T.
 * The tag is compile-time only; the runtime value is just T.
 */
export type Brand<T, Name extends string> = T & { readonly [__brand]: Name };

/**
 * Unsafe cast to a branded type. Use ONLY inside validating constructors
 * that have already checked the value. Name it `asBrand` locally, not publicly.
 *
 * Example:
 *   function makeUuid(raw: string): Result<Uuid, AppError> {
 *     if (!UUID_RE.test(raw)) return err(...)
 *     return ok(raw as Uuid)   // safe: value was validated above
 *   }
 */
export function unsafeCast<B extends Brand<unknown, string>>(
  value: B extends Brand<infer T, string> ? T : never,
): B {
  return value as B;
}
