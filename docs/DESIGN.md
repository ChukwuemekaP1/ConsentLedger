# Design

Goal: this must not look like a template. It should feel like a **forensic instrument**: calm, exact, trustworthy. A judge should understand the product from a screenshot.

The UI serves the product. We do not bend it to fit any sponsor's component library.

## 1. Concept

**A paper mandate on a dark workbench.**

- The workbench (app chrome, ledger, lab) is dark and quiet.
- The **Mandate** is the one bright object: a paper-coloured card with fine rules, a signature block and a **seal**. The eye goes to it first.
- The **seal** is the signature interaction. It is a ring that fills as checks pass, and it turns green only when verification actually succeeds. On failure it breaks and shows the reason code.

## 2. Surfaces

| Surface | Purpose | Key components |
|---|---|---|
| **Agent** | Talk to the agent, review the mandate, sign | Chat, Mandate Card, Passkey sheet, PayPal approval step, Budget ring (intent) |
| **Ledger** | Evidence console | Case table (AG Grid Community), Timeline drawer, Chain and checkpoint status, Reconcile button, Operator panel, Bundle download |
| **Lab** | Prove it holds | Attack cards with expected vs actual reason code, live event feed, "verify bundle" terminal view |

Three screens. Resist adding more.

## 3. Tokens

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0B0D10` | App background |
| `--panel` | `#12161B` | Panels |
| `--panel-2` | `#181D24` | Raised panels |
| `--line` | `#232A33` | Hairlines |
| `--text` | `#E7ECF2` | Primary text |
| `--text-dim` | `#8C97A6` | Secondary text |
| `--paper` | `#F3EFE6` | Mandate Card |
| `--paper-ink` | `#1B1A17` | Text on paper |
| `--seal` | `#3DDC97` | Verified |
| `--breach` | `#FF5C5C` | Rejected, broken |
| `--amber` | `#F5B544` | Pending, UNKNOWN, simulated |
| `--link` | `#5AA9FF` | Provider and webhook events |

Contrast: all text pairs meet WCAG AA. Check with a tool, not by eye. Status is never colour-only.

**Type:** UI in a clean grotesque (Geist or Inter). Hashes, IDs, JSON in a mono (JetBrains Mono or IBM Plex Mono). Money uses `font-variant-numeric: tabular-nums`. Scale: 12, 13, 14, 16, 20, 28.

**Spacing:** 4-point grid. **Radius:** 6 for controls, 10 for cards. **Elevation:** hairline borders, not shadows, on the dark side. One soft shadow under the paper card.

## 4. Components that carry the product

**Mandate Card (paper)**
- Header: kind (CART or INTENT), policy badge, expiry countdown.
- Body: payee, amount (large, tabular), items, `promptPlayback` quoted in the agent's words, so the human sees what the agent understood.
- Footer: truncated hash (`a3f9…c21e`, click to copy full), signature block.
- Signature block states: **Unsigned** (dashed line, "Sign with passkey"), **Signing** (spinner, "Touch your authenticator"), **Signed** (device name, time, seal filled).

**Seal:** an SVG ring with segments for the checks in order (hash, authority, consent, policy, budget). Each segment fills as that check passes. Unknown is amber. Failure is red with the reason code beneath.

**Budget ring (intent):** spent, reserved, remaining as three arcs. Animates on spend. Always shows numbers, not only the ring.

**Timeline (ledger):** a vertical "tape". Each event: time, actor chip, type, short hash, expandable JSON. Rejections are red. Provider events are blue. Success is green. Duplicates are dim with a "ignored" tag.

**Attack card (lab):** name, one-line story, **Run** button, then expected code vs actual code with a pass or fail mark and a link to the resulting event.

**Terminal view:** shows `verify:bundle` output as plain mono text. The demo ends here.

## 5. Interaction principles

1. **Show the exact thing being approved.** Never summarise a mandate on the signing screen.
2. **Make the secure path the obvious path.** One primary action per step.
3. **Name failures.** A reason code and one human sentence, never "Something went wrong".
4. **Honest labels.** `SIMULATED SETTLEMENT`, `SANDBOX`, `DEMO ATTACK` are always visible when true.
5. **Motion explains state.** The seal fills, the ring moves. No decorative animation. Respect `prefers-reduced-motion`.

## 6. States and quality bar

Every view ships with **empty, loading, error and success** states. Keyboard navigable with visible focus. Screen-reader labels on the seal and rings (`aria-label` states the result in words). Responsive from 360px up, with the ledger table collapsing to cards.

## 7. Implementation notes

- Tailwind with CSS variables for the tokens above. Add shadcn/ui primitives only when needed (dialog, sheet, tabs, tooltip) and restyle them to this system.
- AG Grid Community for the case table, themed to the tokens. Custom cell renderers for status chips and money.
- PayPal's buttons render inside a neutral container. We do not restyle PayPal marks.
- Icons: `lucide-react`. No emoji in the UI.
