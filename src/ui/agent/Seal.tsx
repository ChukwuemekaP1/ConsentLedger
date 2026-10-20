/**
 * Verification seal (docs/DESIGN.md §1, §4).
 *
 * An SVG ring with one segment per check, in order. A segment is filled only for a
 * check the server has confirmed. The seal looks "verified" only when every check
 * passed. The aria-label states the result in words and the checks are listed as
 * text beside it, so nothing relies on colour alone.
 */

export type SealCheckState = "pass" | "pending" | "fail";

export interface SealCheck {
  readonly id: string;
  readonly label: string;
  readonly state: SealCheckState;
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 4;

const WORD: Record<SealCheckState, string> = {
  pass: "passed",
  pending: "pending",
  fail: "failed",
};

export function sealSummary(checks: readonly SealCheck[]): string {
  const passed = checks.filter((c) => c.state === "pass").length;
  const failed = checks.some((c) => c.state === "fail");
  const headline = failed
    ? "Seal broken"
    : passed === checks.length
      ? "Seal verified"
      : "Seal incomplete";
  const detail = checks.map((c) => `${c.label} ${WORD[c.state]}`).join("; ");
  return `${headline}: ${passed} of ${checks.length} checks passed. ${detail}.`;
}

export function Seal({ checks }: { readonly checks: readonly SealCheck[] }) {
  const segment = CIRCUMFERENCE / checks.length;
  return (
    <svg
      className="seal"
      width="64"
      height="64"
      viewBox="0 0 64 64"
      role="img"
      aria-label={sealSummary(checks)}
    >
      <circle className="seal__track" cx="32" cy="32" r={RADIUS} fill="none" strokeWidth="6" />
      {checks.map((check, index) => (
        <circle
          key={check.id}
          className="seal__arc"
          data-state={check.state}
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          strokeLinecap="butt"
          strokeDasharray={`${segment - GAP} ${CIRCUMFERENCE - (segment - GAP)}`}
          strokeDashoffset={check.state === "pending" ? segment - GAP : 0}
          transform={`rotate(${-90 + (360 / checks.length) * index} 32 32)`}
        />
      ))}
    </svg>
  );
}
