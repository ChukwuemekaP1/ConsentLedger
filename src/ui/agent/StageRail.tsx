import type { Flow } from "./checkout-machine.js";

const STEPS = [
  "Request",
  "Review mandate",
  "Passkey consent",
  "PayPal order",
  "PayPal approval",
] as const;

/** Index of the current step for each stage; STEPS.length means everything is done. */
export function currentStep(flow: Flow): number {
  switch (flow.stage) {
    case "compose":
    case "registering":
    case "auth_required":
    case "proposing":
    case "denied":
      return 0;
    case "review":
    case "expired":
      return 1;
    case "signing":
    case "consented":
      return 2;
    case "ordering":
      return 3;
    case "checkout":
      return 4;
    case "settled":
      return STEPS.length;
    case "failed":
      return currentStep(flow.resume);
    default: {
      const unreachable: never = flow;
      return unreachable;
    }
  }
}

export function StageRail({ flow }: { readonly flow: Flow }) {
  const current = currentStep(flow);
  return (
    <ol className="rail" aria-label="Progress">
      {STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li
            key={label}
            className="rail__item"
            data-state={state}
            {...(state === "current" ? { "aria-current": "step" as const } : {})}
          >
            <span className="rail__label">{label}</span>
            <span className="sr-only">
              {state === "done"
                ? " (done)"
                : state === "current"
                  ? " (current step)"
                  : " (not started)"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
