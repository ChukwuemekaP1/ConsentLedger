/**
 * invariant() — programmer error assertion.
 *
 * Throws when a condition that must always be true is false. This is for
 * bugs, not for expected failures. Domain functions return Result<T, E>
 * for expected failures; they call invariant() for impossible states.
 *
 * Never catch the thrown error to hide it.
 *
 * CODING.md §2: "Programmer errors throw."
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}
