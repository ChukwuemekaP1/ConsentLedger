/**
 * canonicalize — RFC 8785 JCS (JSON Canonicalization Scheme) subset.
 *
 * Produces a deterministic UTF-8 string from a value for hashing and signing.
 * Only a safe subset of JSON is supported; anything that can't be represented
 * exactly (floats, undefined, symbols, bigint, Date, class instances, cycles)
 * is rejected with a typed error.
 *
 * Supported types:
 *   - string    (RFC 8259 / 8785 string escaping)
 *   - boolean   (true / false)
 *   - null
 *   - safe integer (Number.isSafeInteger — no floats, no NaN, no Infinity)
 *   - plain Array (no sparse arrays — no holes)
 *   - plain Object (Object.getPrototypeOf === Object.prototype or null)
 *
 * Rejected types:
 *   - float, NaN, Infinity, -Infinity
 *   - undefined, function, symbol, bigint
 *   - Date instances, class instances, RegExp, Map, Set, ...
 *   - sparse arrays (holes)
 *   - circular references
 *
 * Key ordering: UTF-16 code unit order (native JS string comparison: a < b).
 * This matches RFC 8785 §3.2.3.
 *
 * INVARIANT: I-04 — ledger hashes are always over canonical bytes.
 * CODING.md §7: "Always hash canonical bytes. Never hash JSON.stringify output."
 */

import { type Result, ok, err } from "../shared/result.js";

export type CanonicalError =
  | { readonly kind: "UNSUPPORTED_TYPE"; readonly path: string; readonly type: string }
  | { readonly kind: "FLOAT"; readonly path: string; readonly value: number }
  | { readonly kind: "SPARSE_ARRAY"; readonly path: string }
  | { readonly kind: "CYCLE"; readonly path: string };

/**
 * Canonicalize a value per RFC 8785 JCS (restricted subset).
 * Returns the canonical UTF-8 string, or an error if the value
 * contains unsupported types.
 */
export function canonicalize(value: unknown): Result<string, CanonicalError> {
  const seen = new WeakSet<object>();
  return canonicalizeInner(value, "", seen);
}

function canonicalizeInner(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): Result<string, CanonicalError> {
  // null — must check before typeof "object"
  if (value === null) {
    return ok("null");
  }

  const t = typeof value;

  if (t === "boolean") {
    return ok(value ? "true" : "false");
  }

  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n) || Number.isNaN(n)) {
      return err({ kind: "FLOAT", path, value: n });
    }
    if (!Number.isInteger(n)) {
      return err({ kind: "FLOAT", path, value: n });
    }
    if (!Number.isSafeInteger(n)) {
      // Unsafe integers cannot be round-tripped through JSON
      return err({ kind: "FLOAT", path, value: n });
    }
    // Integers: no decimal point in canonical form per RFC 8785 §3.2.2
    return ok(n.toString());
  }

  if (t === "string") {
    return ok(canonicalizeString(value as string));
  }

  if (t === "undefined" || t === "function" || t === "symbol") {
    return err({ kind: "UNSUPPORTED_TYPE", path, type: t });
  }

  if (t === "bigint") {
    return err({ kind: "UNSUPPORTED_TYPE", path, type: "bigint" });
  }

  // At this point typeof value === "object" (we've excluded all other types above).
  // The cast is safe.
  {
    const obj = value as object;

    // Cycle detection
    if (seen.has(obj)) {
      return err({ kind: "CYCLE", path });
    }
    seen.add(obj);

    try {
      if (Array.isArray(obj)) {
        return canonicalizeArray(obj, path, seen);
      }

      // Reject class instances (Date, RegExp, Map, Set, etc.)
      const proto = Object.getPrototypeOf(obj) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        // constructor.name may be undefined on Object.create(null) objects,
        // but we already handled null proto above.
        const ctorName = (obj as { constructor?: { name?: string } }).constructor?.name ?? "object";
        return err({ kind: "UNSUPPORTED_TYPE", path, type: ctorName });
      }

      return canonicalizeObject(obj as Record<string, unknown>, path, seen);
    } finally {
      // Remove from seen after processing (allows the same object to appear in
      // different branches, but still catches cycles)
      seen.delete(obj);
    }
  }
}

function canonicalizeArray(
  arr: unknown[],
  path: string,
  seen: WeakSet<object>,
): Result<string, CanonicalError> {
  // Reject sparse arrays (holes)
  for (let i = 0; i < arr.length; i++) {
    if (!(i in arr)) {
      return err({ kind: "SPARSE_ARRAY", path: `${path}[${i}]` });
    }
  }

  const parts: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    const r = canonicalizeInner(arr[i], `${path}[${i}]`, seen);
    if (!r.ok) return r;
    parts.push(r.value);
  }
  return ok(`[${parts.join(",")}]`);
}

function canonicalizeObject(
  obj: Record<string, unknown>,
  path: string,
  seen: WeakSet<object>,
): Result<string, CanonicalError> {
  // RFC 8785 §3.2.3: keys sorted by UTF-16 code unit order (JS default)
  const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const parts: string[] = [];
  for (const key of keys) {
    const childPath = path === "" ? key : `${path}.${key}`;
    const valueResult = canonicalizeInner(obj[key], childPath, seen);
    if (!valueResult.ok) return valueResult;
    parts.push(`${canonicalizeString(key)}:${valueResult.value}`);
  }
  return ok(`{${parts.join(",")}}`);
}

/**
 * RFC 8259 / RFC 8785 string serialisation.
 * Escape: " \ and control characters U+0000–U+001F.
 * Use \uXXXX for all control chars; \n, \r, \t, \b, \f for named escapes.
 */
function canonicalizeString(s: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    switch (code) {
      case 0x22:
        result += '\\"';
        break; // "
      case 0x5c:
        result += "\\\\";
        break; // \
      case 0x08:
        result += "\\b";
        break;
      case 0x09:
        result += "\\t";
        break;
      case 0x0a:
        result += "\\n";
        break;
      case 0x0c:
        result += "\\f";
        break;
      case 0x0d:
        result += "\\r";
        break;
      default:
        if (code < 0x20) {
          // Other control characters: \uXXXX
          result += `\\u${code.toString(16).padStart(4, "0")}`;
        } else {
          result += s[i];
        }
    }
  }
  result += '"';
  return result;
}
