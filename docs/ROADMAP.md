# Roadmap

Updated Oct 10, 2026. Submission deadline: **Nov 12, 12:00pm PT** (20:00 UTC; 21:00 in Lagos).
**Feature freeze Nov 7. Submit by Nov 10.** The last days are for the video, the README and fixes only.

Issue numbers are creation order (they match the files in `issues/`). The table below is **execution order**.

## Execution order

| Order | Issue | Milestone | Priority | Target | Depends on |
|---|---|---|---|---|---|
| 1 | #1 Foundation and guardrails | M1 Foundation | P0 | Oct 10–11 | none |
| 2 | #2 Domain kernel | M1 Foundation | P0 | Oct 12–14 | 1 |
| 3 | #3 Evidence ledger (Postgres) | M1 Foundation | P0 | Oct 15–16 | 2 |
| 4 | #4 Passkey identity and mandate consent | M2 Consent | P0 | Oct 17–19 | 3 |
| 5 | #5 Agent to Cart Mandate (Gemini) | M2 Consent | P0 | Oct 20–22 | 4 |
| 6 | #17 Real product data (Channel3) | M2 Consent | P1 | Oct 22–23 | 5 |
| 7 | #16 Merchant Agent counter-signature | M2 Consent | P1 | Oct 23–24 | 2, 5 |
| 8 | #6 PayPal settlement gateway (human-present) | M3 Settlement | P0 | Oct 25–27 | 7 |
| 9 | #8 Spike S1: unattended payment (Vault) | M3 Settlement | P1 | Oct 25, 3h time-box | 6 |
| 10 | #7 Webhooks and reconciliation | M3 Settlement | P0 | Oct 28–30 | 6 |
| 11 | #9 Intent mandates, budgets, step-up | M4 Differentiators | P1 | Oct 31–Nov 2 | 7 (8 informs settlement) |
| 12 | #10 Adversarial Lab | M4 Differentiators | P0 | Nov 2 | 7 |
| 13 | #11 Ledger console UI | M4 Differentiators | P0 | Nov 2–4 | 7 |
| 14 | #12 Evidence bundle, checkpoints, offline verifier, dispute packet | M4 Differentiators | P1 | Nov 4–6 | 7 |
| 15 | #18 Public verify page | M4 Differentiators | P1 | Nov 6 | 12 |
| 16 | #13 Operator AI (grounded, cited) | M4 Differentiators | P1 | Nov 6–7 | 11 |
| 17 | #15 Ship: deploy, README, demo video | M5 Ship | P0 | Nov 7–10 | all P0 |
| stretch | #20 Agent spend analytics | M4 Differentiators | P2 | only if ahead | 9, 11 |
| stretch | #19 OpenAPI contract and SDK (APIMatic) | M5 Ship | P2 | only if ahead | 7 |
| stretch | #21 Policy copilot | M5 Ship | P2 | only if ahead | 4, 5 |
| stretch | #14 MCP server | M5 Ship | P2 | only if ahead | 5 |

**Demo-ready gate: Oct 30.** By then `main` must run the golden path end to end (propose, merchant quote, passkey signature, real sandbox payment, verified webhook, reconciliation) and be recordable. Everything after is differentiation on top of a working product.

## Cut line (decide honestly on Oct 30)

Cut in this order if behind: #21, #19, #20, #14, then shrink #13 to fixed questions, then run #9 settlement on the simulator and label it, then drop #18's browser fallbacks (keep the CLI verifier).

**Never cut:** #1 to #7, #16, #10, #11, the offline verifier in #12, #15.

## Risk register

| ID | Risk | Likelihood | Impact | Response |
|---|---|---|---|---|
| R1 | Sandbox cannot capture unattended (Vault unavailable or needs approval) | Medium | Medium | Spike S1 on Oct 25, 3h hard stop. Fallback: `SimulatedPaymentProvider`, labelled everywhere. |
| R2 | PayPal front-end SDK differs from older examples (the hackathon resources list JS SDK v6) | Medium | Medium | Issue 6 reads current docs first. Keep the SDK inside `ui` and the adapter. |
| R3 | Gemini free-tier limits or model availability change | Medium | Low | `GEMINI_MODEL` env, `LLM_MODE=mock`, recorded fixtures, backoff. |
| R4 | Passkeys fail on a judge's machine or browser | Low | High | Test Chrome, Safari, Edge. Document the Chrome virtual-authenticator fallback. Hosted demo plus a video that does not depend on judges. |
| R5 | Scope creep. This plan is deliberately ambitious. | High | High | The cut line. One issue per PR. Demo-ready gate on Oct 30. |
| R6 | Webhook verification cannot run on simulator events | Known | Low | Recorded real sandbox events for tests. Dev-bypass flag outside production only. |
| R7 | Free hosting sleeps | Known | Low | Wake before demos. PayPal retries webhooks. |
| R8 | Channel3 API shape or quota differs from expectations | Low | Low | Port plus fixture fallback with a visible notice. |
| R9 | Browser Ed25519 support is uneven (issue 18) | Medium | Low | `CryptoProvider` with a vetted pure-JS fallback. Record support per browser. |
| R10 | Registrations passed 10,000, so the field is large | Known | Medium | Differentiate on proof, design and presentation, not on having an agent and a checkout. |

## Working agreement

- One issue, one branch, one PR, one written PR description.
- `main` is always green. From Oct 30 it is always demoable.
- Post a build-in-public update after each milestone.

## Social proof plan

| When | Post |
|---|---|
| Oct 11 | Architecture and threat model: "How I would let an AI agent spend money, safely" |
| Oct 19 | A passkey signs a mandate hash. Short clip. |
| Oct 27 | First real sandbox payment, with the ledger |
| Nov 3 | Lab: injection and tamper blocked, with reason codes |
| Nov 6 | The public verify page. "Verify it yourself." |
| Nov 8 | Offline verifier going green then red. Demo video |

Publish the latest checkpoint root in each post. It anchors the ledger in public.
